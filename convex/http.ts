// HTTP routes on the deployment's site URL (D08a): Better Auth's /api/auth/*
// endpoints and the JWKS Convex uses to check its tokens. Browsers reach them
// through the Next.js /api/auth route at D08b; until then only the tests call
// them, on the task-owned test backend. /account/handover is the D08d
// Clerk-session handover (convex/handover.ts).
import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { handoverHttp } from "./handover";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);
// D08d: Clerk-session handover, called only by the Next.js server.
http.route({ path: "/account/handover", method: "POST", handler: handoverHttp });

export default http;
