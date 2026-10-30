// The admin check for server actions and server components (moved here from
// src/app/actions/advanced-analytics.ts in D04e so other admin reads use the
// same one). Clerk mode: the session user's Clerk email against the admin
// list, as before. Under the Better Auth switch: users.role (D08g1), read
// with identity:whoami (D07-c).
// Signed out throws; signed in but not an admin redirects to /dashboard.
// D07: admin-dashboard.ts and user-management.ts use these too, so this is
// the one place the default path reads Clerk for the admin check.
// Server-side only; not a "use server" module.
import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { chooseAuthBackend } from "@/backend/auth";
import { isAdmin } from "@/lib/admin-utils";
import { betterAuthRole } from "@/lib/auth-server";

async function clerkUserEmail(userId: string): Promise<string | undefined> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return user.emailAddresses[0]?.emailAddress;
}

export async function requireAdminForAction(): Promise<void> {
  if (chooseAuthBackend().backend === "better-auth") {
    // users.role from the session (D07-c: no Clerk-era link needed).
    if ((await betterAuthRole()) !== "admin") redirect("/dashboard");
    return;
  }
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized: User not logged in");
  }

  if (!isAdmin(await clerkUserEmail(userId))) {
    redirect("/dashboard");
  }
}

/** The same check as a boolean: false when signed out, not an admin, or on any error. */
export async function viewerIsAdmin(): Promise<boolean> {
  try {
    if (chooseAuthBackend().backend === "better-auth") {
      return (await betterAuthRole()) === "admin";
    }
    const { userId } = await auth();
    if (!userId) return false;
    return isAdmin(await clerkUserEmail(userId));
  } catch {
    return false;
  }
}
