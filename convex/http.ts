// HTTP routes on the deployment's site URL (D08a): Better Auth's /api/auth/*
// endpoints and the JWKS Convex uses to check its tokens. Browsers reach them
// through the Next.js /api/auth route at D08b; until then only the tests call
// them, on the task-owned test backend.
import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

export default http;
