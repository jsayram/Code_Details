"use client";

// App-owned SignedIn/SignedOut (D08f2). Same meaning as Clerk's: SignedIn
// shows its children once auth says there is a user, SignedOut once auth says
// there isn't, and neither while auth is still loading.
//
// The one difference: neither renders anything until hydration has finished.
// Clerk's versions read the client's auth state during hydration, and when
// clerk-js has loaded before React hydrates, SignedOut renders children the
// server HTML doesn't have ("Hydration failed" in the header, 1–2 of 8 runs).
// Waiting for hydration keeps the first client render identical to the
// server's. Clerk shows these only after it loads anyway, so nothing visible
// changes. D08f3 extends these to Better Auth behind the development switch.
import { useAuth } from "@clerk/nextjs";
import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => {};

/** False on the server and during hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function SignedIn({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const { userId } = useAuth();
  return hydrated && userId ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const { userId } = useAuth();
  return hydrated && userId === null ? <>{children}</> : null;
}
