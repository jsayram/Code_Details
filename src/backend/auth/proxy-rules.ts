// What src/proxy.ts does with a request (D08g1). Pure, so the whole table is
// unit-tested; the proxy only supplies the path and the viewer. D08g4f2: this
// is the only proxy path. With Better Auth off there is no login, so the
// viewer is always null and every protected route is refused.

export type ProxyViewer = { role: "user" | "admin" } | null;

export type ProxyDecision =
  | { kind: "next" }
  | { kind: "redirect"; location: string }
  | { kind: "unauthorized" };

/**
 * D08g4f2: the route classes, as Clerk's createRouteMatcher matched them
 * (whole path, case-insensitive, an optional trailing slash). The Clerk
 * webhook and sync-user entries are gone with those routes.
 */
const route = (pattern: string) => new RegExp(`^${pattern}/?$`, "i");
const PUBLIC_ROUTES = [
  route("/"),
  route("/sign-in.*"),
  route("/sign-up.*"),
  route("/shared-projects/.*"),
  route("/projects/[^/]+"),
  route("/api/shared-projects/.*"),
  // D09 S02b (Jose's decision 3): search returns listed projects only, to anyone.
  route("/api/search(/facets|/events)?"),
  // D09 S02c (decision 3 and the master's scope answer): the search page, the
  // tag list, the community list and the per-tag and per-category lists are
  // public. Their data routes answer the public variants to anyone and refuse
  // the personal ones (mine, favorites, deleted) without a session; the user
  // directory (/users, /api/profiles) stays signed-in.
  route("/search"),
  route("/tags"),
  route("/tags/[^/]+"),
  // The categories index (master, under Jose's delegation): the same public counts.
  route("/categories"),
  route("/categories/[^/]+"),
  route("/projects"),
  route("/api/projects"),
  route("/api/categories/counts"),
];
// Better Auth's own endpoints and the dev viewer check: public only while Better Auth is on.
const BETTER_AUTH_ROUTES = [route("/api/auth/.*"), route("/api/dev/viewer")];
const ADMIN_ROUTES = [
  route("/dashboard/admin.*"),
  route("/dashboard/tag-submissions.*"), // D07 (P08 R04): its read was admin-checked; now the route is too
  route("/api/projects/test.*"),
  route("/api/darkmodetest.*"),
  route("/api/toasttest.*"),
];
const matches = (routes: RegExp[], pathname: string) => routes.some((r) => r.test(pathname));
export const isPublicPath = (pathname: string) => matches(PUBLIC_ROUTES, pathname);
export const isBetterAuthPath = (pathname: string) => matches(BETTER_AUTH_ROUTES, pathname);
export const isAdminPath = (pathname: string) => matches(ADMIN_ROUTES, pathname);

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
