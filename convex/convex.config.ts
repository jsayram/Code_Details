// Components mounted on this deployment (D08a). Better Auth's tables (user,
// session, account, verification, jwks) live in the component's own namespace;
// app tables never hold an email (P07 §5.5).
import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";

const app = defineApp();
app.use(betterAuth);

export default app;
