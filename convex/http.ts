// HTTP routes on the deployment's site URL (D08a): Better Auth's /api/auth/*
// endpoints and the JWKS Convex uses to check its tokens. Browsers reach them
// through the Next.js /api/auth route at D08b; until then only the tests call
// them, on the task-owned test backend. The D08d Clerk-session handover route
// was removed in D08g4b.
import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { EMAIL_LINK_PATH, emailLinkHttp } from "./emailLinks";

const http = httpRouter();
// D08f1 (f5): opaque email-verification links. An exact path, so it wins over
// the /api/auth/ prefix Better Auth registers below.
http.route({ path: EMAIL_LINK_PATH, method: "GET", handler: emailLinkHttp });
authComponent.registerRoutes(http, createAuth);

export default http;
