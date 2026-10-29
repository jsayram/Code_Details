"use client";

// The signed-in user's display fields (D08g3b): name, email, picture, and
// whether auth has loaded. With Clerk (the default) these are exactly what
// useUser() gives; with the development Better Auth switch on they come from
// the Better Auth session (whose single name is split into first/last).
// Only for showing who is signed in, never as an identity for data.
import { useUser } from "@clerk/nextjs";
import { useAuthBackend } from "@/backend/auth/context";
import { useBetterAuthSession } from "@/lib/auth-session";

export interface DisplayUser {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  imageUrl: string | null;
}

export function useDisplayUser(): { isLoaded: boolean; user: DisplayUser | null } {
  const backend = useAuthBackend();
  const { user, isLoaded } = useUser();
  const session = useBetterAuthSession(backend === "better-auth");
  if (backend === "clerk") {
    return {
      isLoaded,
      user: user
        ? {
            fullName: user.fullName,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.primaryEmailAddress?.emailAddress ?? null,
            imageUrl: user.imageUrl,
          }
        : null,
    };
  }
  if (session.status === "loading") return { isLoaded: false, user: null };
  const u = session.user;
  if (!u) return { isLoaded: true, user: null };
  const [first, ...rest] = (u.name ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    isLoaded: true,
    user: { fullName: u.name || null, firstName: first ?? null, lastName: rest.length ? rest.join(" ") : null, email: u.email, imageUrl: u.image },
  };
}
