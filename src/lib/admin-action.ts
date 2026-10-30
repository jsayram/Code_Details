// The admin check for server actions and server components (moved here from
// src/app/actions/advanced-analytics.ts in D04e so other admin reads use the
// same one). Clerk mode: the session user's Clerk email against the admin
// list, as before. Under the Better Auth switch: users.role (D08g1).
// Signed out throws; signed in but not an admin redirects to /dashboard.
// Server-side only; not a "use server" module.
import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { chooseAuthBackend } from "@/backend/auth";
import { isAdmin } from "@/lib/admin-utils";
import { routeViewer } from "@/lib/auth-server";

export async function requireAdminForAction(): Promise<void> {
  if (chooseAuthBackend().backend === "better-auth") {
    if (!(await routeViewer())?.isAdmin) redirect("/dashboard");
    return;
  }
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized: User not logged in");
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const userEmail = user.emailAddresses[0]?.emailAddress;

  if (!isAdmin(userEmail)) {
    redirect("/dashboard");
  }
}
