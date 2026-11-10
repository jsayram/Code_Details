// D08 /api/llm gate (Jose, 2026-10-30: "Yes, gate it"), shared by every route
// that reaches a model provider: /api/llm, /api/llm-test and /api/generate-docs.
// - Admins only: users.role from the session (never a request field).
// - Every provider call first takes one unit of the per-user and global daily
//   caps in Convex (llmUsage:reserve; persistent, serializable), and is closed
//   with its outcome (llmUsage:finish). Never the prompt or the answer.
// - A caller-supplied base URL must be on CODEDETAILS_LLM_BASE_URL_ALLOWLIST,
//   or (outside production only) point at this machine (a local model server
//   such as Ollama); anything else is refused, so the server can't be made to
//   send requests (with its keys) to an arbitrary host.
// Anything that can't be checked is refused. Server-side only.
import { makeFunctionReference } from "convex/server";
import { betterAuthRole, routeDocOwner, viewerMutation } from "@/lib/auth-server";

type Reservation =
  | { ok: true; callId: string; remainingToday: number }
  | { ok: false; code: "forbidden" | "user_cap" | "global_cap" };
const reserve = makeFunctionReference<"mutation", { provider: string; model?: string }, Reservation>("llmUsage:reserve");
const finish = makeFunctionReference<"mutation", { callId: string; ok: boolean; latencyMs: number; errorStatus?: number }, boolean>("llmUsage:finish");

export type GateRefusal = { ok: false; status: 401 | 403 | 429 | 503 | 400; slug: string; title: string; detail: string };

const refuse = (status: GateRefusal["status"], slug: string, title: string, detail: string): GateRefusal => ({ ok: false, status, slug, title, detail });
const NOT_ADMIN = refuse(403, "forbidden", "Forbidden", "The model API is limited to administrators");

/** The session's admin, by account ID; a refusal for anyone else. */
export async function requireLlmAdmin(): Promise<{ ok: true; accountId: string } | GateRefusal> {
  const role = await betterAuthRole();
  if (!role) return refuse(401, "unauthorized", "Unauthorized", "Authentication required");
  if (role !== "admin") return NOT_ADMIN;
  const accountId = (await routeDocOwner())?.writeKey ?? null;
  if (!accountId) return refuse(401, "unauthorized", "Unauthorized", "Authentication required");
  return { ok: true, accountId };
}

export type LlmTicket = { ok: true; finish: (ok: boolean, latencyMs: number, errorStatus?: number) => Promise<void> };

/** Takes one unit of today's caps for one provider call; a refusal when over a cap or unchecked. */
export async function reserveLlmCall(provider: unknown, model: unknown): Promise<LlmTicket | GateRefusal> {
  let reservation: Reservation | null = null;
  try {
    reservation =
      (await viewerMutation(reserve, { provider: String(provider ?? "openai"), ...(typeof model === "string" && model ? { model } : {}) }))?.result ?? null;
  } catch {
    reservation = null;
  }
  if (!reservation) return refuse(503, "usage-unavailable", "Usage Check Unavailable", "The usage limit could not be checked; try again later");
  if (!reservation.ok) {
    if (reservation.code === "forbidden") return NOT_ADMIN;
    return refuse(429, "daily-cap", "Daily Limit Reached", reservation.code === "user_cap" ? "Your daily model-call limit is used up" : "Today's model-call limit is used up");
  }
  const callId = reservation.callId;
  return {
    ok: true,
    finish: async (ok, latencyMs, errorStatus) => {
      await viewerMutation(finish, { callId, ok, latencyMs, ...(errorStatus === undefined ? {} : { errorStatus }) }).catch(() => null);
    },
  };
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Origins listed in CODEDETAILS_LLM_BASE_URL_ALLOWLIST (comma-separated); bad entries are ignored. */
function allowlistedOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const entry of (process.env.CODEDETAILS_LLM_BASE_URL_ALLOWLIST ?? "").split(",")) {
    try {
      if (entry.trim()) origins.add(new URL(entry.trim()).origin);
    } catch {
      /* ignore */
    }
  }
  return origins;
}

/**
 * Null when the caller's base URL is absent or allowed; else why it is refused.
 * Allowed (H1): an origin on CODEDETAILS_LLM_BASE_URL_ALLOWLIST, or, outside
 * production only, a model server on this machine's loopback. A hosted server
 * has no business calling its own loopback for a visitor, so production
 * refuses it unless that exact origin is listed.
 */
export function baseUrlProblem(value: unknown): GateRefusal | null {
  if (value === undefined || value === null || value === "") return null;
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    return refuse(400, "validation-error", "Validation Error", "The base URL is not a valid URL");
  }
  const refusal = refuse(400, "validation-error", "Validation Error", "This base URL is not on the server's list of allowed model servers");
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return refusal;
  if (allowlistedOrigins().has(url.origin)) return null;
  if (process.env.NODE_ENV !== "production" && LOOPBACK.has(url.hostname)) return null;
  return refusal;
}

/** The thrown form of a refusal, for code that reports errors by throwing (the docs flow). */
export class LlmGateError extends Error {
  constructor(readonly refusal: GateRefusal) {
    super(refusal.detail);
    this.name = "LlmGateError";
  }
}
