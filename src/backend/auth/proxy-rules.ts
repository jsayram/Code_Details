// What src/proxy.ts does with a request while the development Better Auth
// switch is on (D08g1, g1). Pure, so the whole table is unit-tested; the
// proxy only supplies the route classes and the viewer.

export type ProxyViewer = { role: "user" | "admin" } | null;

export type ProxyDecision =
  | { kind: "next" }
  | { kind: "redirect"; location: string }
  | { kind: "unauthorized" };

export const isApiPath = (pathname: string) => /^\/(api|trpc)(\/|$)/.test(pathname);

/** /sign-in, coming back to this page (path and query only) once signed in. */
export function signInLocation(pathname: string, search: string): string {
  return `/sign-in?redirect_url=${encodeURIComponent(`${pathname}${search}`)}`;
}

export function betterAuthDecision(req: {
  pathname: string;
  search: string;
  isPublic: boolean;
  isAdmin: boolean;
  viewer: ProxyViewer;
}): ProxyDecision {
  if (req.isPublic) return { kind: "next" };
  if (!req.viewer) return isApiPath(req.pathname) ? { kind: "unauthorized" } : { kind: "redirect", location: signInLocation(req.pathname, req.search) };
  // As the Clerk branch does: a signed-in non-admin goes to the regular dashboard.
  if (req.isAdmin && req.viewer.role !== "admin") return { kind: "redirect", location: "/dashboard" };
  return { kind: "next" };
}

/** Whether the request carries a Better Auth session cookie at all (plain or __Secure-). */
export const hasSessionCookie = (cookie: string | null) => !!cookie && /(^|;\s*)(__Secure-)?better-auth\.session_token=/.test(cookie);
