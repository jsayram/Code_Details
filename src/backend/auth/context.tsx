"use client";

// Which login the app is using (D08f3a), decided on the server by
// chooseAuthBackend() (src/backend/auth/index.ts) and handed down by the
// root layout. Clerk unless the development-only switch is on. Renders only
// its children, so the HTML is the same either way.
import { createContext, useContext, type ReactNode } from "react";

export type AuthBackend = "clerk" | "better-auth";

const AuthBackendContext = createContext<AuthBackend>("clerk");

export function AuthBackendProvider({ backend, children }: { backend: AuthBackend; children: ReactNode }) {
  return <AuthBackendContext.Provider value={backend}>{children}</AuthBackendContext.Provider>;
}

export const useAuthBackend = () => useContext(AuthBackendContext);
