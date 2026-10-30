// Test doubles for running server actions and route handlers outside Next
// (Phase B, B13). The login is replaced by a synthetic session the test sets;
// no provider call is possible. D08g4f2: Clerk is gone from the server, so the
// session now stands in for src/lib/auth-server's session reads
// (sessionDouble); clerkServerDouble stays only for the Clerk-era fixtures. next/cache's revalidation needs Next's
// request store, so it becomes a no-op and unstable_cache a pass-through.
import { vi } from "vitest";

let currentSubject: string | null = null;
let currentEmail: string | undefined;

/**
 * Who the mocked session says is signed in (a Clerk-era subject, as the
 * Supabase rows are keyed); null means signed out. `email` decides the admin
 * role: the fixture admin's address (ADMIN_DASHBOARD_MODERATOR) is "admin".
 */
export function signInAs(subject: string | null, opts: { email?: string } = {}) {
  currentSubject = subject;
  currentEmail = subject ? opts.email : undefined;
}

export interface SyntheticClerkUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string | null;
  imageUrl: string;
  emailAddresses: { emailAddress: string }[];
  publicMetadata: Record<string, unknown>;
}

/** What Clerk's users.getUser would return for a fixture subject. */
export function syntheticClerkUser(subject: string): SyntheticClerkUser {
  const key = subject.replace(/^user_fixture_/, "");
  return {
    id: subject,
    firstName: "Synthetic",
    lastName: key,
    username: `clerk-${key}`,
    imageUrl: `https://img.synthetic.invalid/${key}.png`,
    emailAddresses: [{ emailAddress: `${key}@synthetic.invalid` }],
    publicMetadata: {},
  };
}

export const clerkGetUser = vi.fn(async (subject: string) => syntheticClerkUser(subject));

export const clerkServerDouble = {
  auth: vi.fn(async () => ({ userId: currentSubject, sessionClaims: currentEmail ? { email: currentEmail } : null })),
  currentUser: vi.fn(async () => (currentSubject ? syntheticClerkUser(currentSubject) : null)),
  clerkClient: vi.fn(async () => ({ users: { getUser: clerkGetUser } })),
};

/**
 * D08g4f2: src/lib/auth-server with its session reads answered from
 * signInAs(); everything else is the real module. Use as
 * vi.mock("@/lib/auth-server", sessionDouble). routeUserId is the session's
 * Clerk-era subject (what the Better Auth path returns for a linked account),
 * routeViewer adds users.role, betterAuthRole is that role.
 */
export async function sessionDouble(importOriginal: () => Promise<unknown>) {
  const real = (await importOriginal()) as typeof import("../../src/lib/auth-server.js");
  const { isAdmin } = await import("../../src/lib/admin-utils.js");
  const role = () => (currentSubject ? (isAdmin(currentEmail) ? "admin" : "user") : null);
  return {
    ...real,
    routeUserId: vi.fn(async () => currentSubject),
    routeViewer: vi.fn(async () => (currentSubject ? { userId: currentSubject, isAdmin: role() === "admin" } : null)),
    betterAuthRole: vi.fn(async () => role()),
    betterAuthSignedIn: vi.fn(async () => !!currentSubject),
  };
}

export const nextCacheDouble = {
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
};
