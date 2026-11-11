// D10 day one: the Next.js side of search analytics. Off unless
// CODEDETAILS_SEARCH_ANALYTICS=on (development switch, off by default), and the
// Convex deployment must also allow collection (convex/searchAnalytics.ts), so
// real collection needs both. Every call here is after the response and
// swallows its own errors: analytics never blocks or breaks search.
import { after } from "next/server";
import { makeFunctionReference } from "convex/server";
import { fetchMutation } from "convex/nextjs";
import { RECEIPT_TTL_MS, optedOut, validVisitToken } from "./analytics-rules";

export const VISIT_HEADER = "x-search-visit";

const recordSearchRef = makeFunctionReference<"mutation", Record<string, unknown>, { stored: boolean; receipt: boolean }>("searchAnalytics:recordSearch");
const recordEventsRef = makeFunctionReference<"mutation", Record<string, unknown>, { accepted: number; dropped: number }>("searchAnalytics:recordClientEvents");

export function analyticsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.CODEDETAILS_SEARCH_ANALYTICS === "on";
}

export interface SearchAnalyticsContext {
  receiptId: string;
  /** Absent under GPC/DNT or without a valid token: no receipt, no client events. */
  visit?: string;
  interactionId?: string;
  /** The client marks a settled or submitted search with final=1 (S00.3 §7). */
  product: boolean;
}

export function analyticsContext(request: Request, params: URLSearchParams): SearchAnalyticsContext {
  const token = request.headers.get(VISIT_HEADER);
  const visit = !optedOut(request.headers) && validVisitToken(token) ? token : undefined;
  const interaction = params.get("interaction");
  return {
    receiptId: crypto.randomUUID(),
    ...(visit ? { visit } : {}),
    ...(interaction && /^[A-Za-z0-9_-]{8,64}$/.test(interaction) ? { interactionId: interaction } : {}),
    product: params.get("final") === "1",
  };
}

export const receiptFor = (ctx: SearchAnalyticsContext, hits: number, now = Date.now()) =>
  ctx.visit && hits > 0 ? { id: ctx.receiptId, expiresAt: now + RECEIPT_TTL_MS } : null;

/** Runs fn after the response when Next can; outside a request (tests) it just starts it. Never throws. */
export function afterResponse(fn: () => Promise<unknown>): void {
  const safe = () => fn().catch(() => undefined);
  try {
    after(safe);
  } catch {
    void safe();
  }
}

export function recordSearch(url: string, args: Record<string, unknown>): Promise<unknown> {
  const serverSecret = process.env.CODEDETAILS_INTERNAL_AUTH_SECRET;
  if (!serverSecret) return Promise.resolve(null);
  return fetchMutation(recordSearchRef, { ...args, serverSecret }, { url });
}

export function recordClientEvents(url: string, visit: string, events: unknown[]): Promise<{ accepted: number; dropped: number }> {
  return fetchMutation(recordEventsRef, { visit, events }, { url });
}
