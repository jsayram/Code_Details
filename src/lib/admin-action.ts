// The admin check for server actions and server components (moved here from
// src/app/actions/advanced-analytics.ts in D04e so other admin reads use the
// same one): users.role (D08g1), read with identity:whoami (D07-c; no
// Clerk-era link needed). D08g4f2: Clerk's email check is gone; with Better
// Auth off nobody is an admin.
// Signed out throws (as the Clerk check did); signed in but not an admin
// redirects to /dashboard.
// D07: admin-dashboard.ts and user-management.ts use these too.
// Server-side only; not a "use server" module.
import { redirect } from "next/navigation";
import { betterAuthRole, betterAuthSignedIn } from "@/lib/auth-server";

export async function requireAdminForAction(): Promise<void> {
  if (!(await betterAuthSignedIn())) throw new Error("Unauthorized: User not logged in");
  if ((await betterAuthRole()) !== "admin") redirect("/dashboard");
}

/** The same check as a boolean: false when signed out, not an admin, or on any error. */
export async function viewerIsAdmin(): Promise<boolean> {
  try {
    return (await betterAuthRole()) === "admin";
  } catch {
    return false;
  }
}
