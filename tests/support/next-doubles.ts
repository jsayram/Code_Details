// Test doubles for running server actions and route handlers outside Next
// (Phase B, B13). Clerk is replaced by a synthetic session the test sets; no
// Clerk network call is possible. next/cache's revalidation needs Next's
// request store, so it becomes a no-op and unstable_cache a pass-through.
import { vi } from "vitest";

let currentSubject: string | null = null;

/** Who the mocked Clerk `auth()` says is signed in; null means signed out. */
export function signInAs(subject: string | null) {
  currentSubject = subject;
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
  auth: vi.fn(async () => ({ userId: currentSubject })),
  currentUser: vi.fn(async () => (currentSubject ? syntheticClerkUser(currentSubject) : null)),
  clerkClient: vi.fn(async () => ({ users: { getUser: clerkGetUser } })),
};

export const nextCacheDouble = {
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
};
