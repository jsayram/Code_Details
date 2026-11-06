import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { viewerIsAdmin } from "@/lib/admin-action";
import { FoundationsGallery } from "./FoundationsGallery";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Design foundations",
  robots: { index: false, follow: false },
};

// UI03 preview. Development only: production answers 404, and the proxy and
// this page both limit it to admins. All content is synthetic and static.
export default async function DesignFoundationsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  if (!(await viewerIsAdmin())) redirect("/dashboard");
  return <FoundationsGallery />;
}
