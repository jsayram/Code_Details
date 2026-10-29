"use client";

// The browser's Better Auth session (D08f3a), read from /api/auth/get-session
// on the app origin. A small store instead of better-auth/react: that package
// ships only ESM, which the root tsconfig (NodeNext, CommonJS) can't import,
// and the app needs only "who is signed in" and "sign out" here.
//
// It fetches only once something subscribes with the Better Auth switch on,
// refreshes when the window regains focus, and after signOut()/refresh().
// Nothing is kept anywhere but memory.
import { useEffect, useSyncExternalStore } from "react";

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

export type SessionState = { status: "loading" } | { status: "ready"; user: SessionUser | null };

let state: SessionState = { status: "loading" };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: SessionState) {
  state = next;
  listeners.forEach((l) => l());
}

export function refreshSession(): Promise<void> {
  inflight ??= fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" })
    .then(async (res) => {
      const body = res.ok ? ((await res.json()) as { user?: Partial<SessionUser> & { id: string } } | null) : null;
      const u = body?.user;
      set({ status: "ready", user: u ? { id: u.id, name: u.name ?? null, email: u.email ?? null, image: u.image ?? null } : null });
    })
    .catch(() => set({ status: "ready", user: null }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => undefined);
  await refreshSession();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const loading: SessionState = { status: "loading" };

/** The session when `enabled`; always "loading" otherwise (and on the server). */
export function useBetterAuthSession(enabled: boolean): SessionState {
  useEffect(() => {
    if (!enabled) return;
    if (state.status === "loading") void refreshSession();
    const onFocus = () => void refreshSession();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled]);
  const current = useSyncExternalStore(subscribe, () => state, () => loading);
  return enabled ? current : loading;
}

/** Test-only: start from a clean store. */
export function resetSessionForTests() {
  state = { status: "loading" };
  inflight = null;
}
