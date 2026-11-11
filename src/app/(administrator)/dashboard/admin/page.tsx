import { redirect } from "next/navigation";
import { viewerIsAdmin } from "@/lib/admin-action";
import AdminDashboardClient from "./AdminDashboardClient";

// D07-c: the admin page is checked on the server in both modes (Clerk's admin
// email, or users.role under the Better Auth switch), not only by the proxy.
// A page, not a layout: layouts aren't re-rendered on client navigation.
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  if (!(await viewerIsAdmin())) redirect("/dashboard");
  return <AdminDashboardClient />;
}
