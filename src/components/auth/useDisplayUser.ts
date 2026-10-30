"use client";

// The signed-in user's display fields (D08g3b): name, email, picture, and
// whether auth has loaded, from the Better Auth session (whose single name is
// split into first/last). D08g4f2: the Clerk branch is gone. Only for showing
// who is signed in, never as an identity for data.
//
// FLAKE-HYD-HOME: until hydration has finished it reports "still loading, no
// user", as the server render does. The home page and HeroSection choose
// between the hero and its loading skeleton on isLoaded, so the first client
// render must match the server HTML. The same race D08f2 fixed for
// SignedIn/SignedOut (AuthGate).
import { useBetterAuthSession } from "@/lib/auth-session";
import { useHydrated } from "./AuthGate";

export interface DisplayUser {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  imageUrl: string | null;
  /** Clerk's handle once; always null with Better Auth (its session has none). D08g4e3. */
  username: string | null;
}

export function useDisplayUser(): { isLoaded: boolean; user: DisplayUser | null } {
  const session = useBetterAuthSession(true);
  const hydrated = useHydrated();
  if (!hydrated) return { isLoaded: false, user: null };
  if (session.status === "loading") return { isLoaded: false, user: null };
  const u = session.user;
  if (!u) return { isLoaded: true, user: null };
  const [first, ...rest] = (u.name ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    isLoaded: true,
    user: { fullName: u.name || null, firstName: first ?? null, lastName: rest.length ? rest.join(" ") : null, email: u.email, imageUrl: u.image, username: null },
  };
}
