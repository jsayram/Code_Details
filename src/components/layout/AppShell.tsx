"use client";

import type { ReactNode } from "react";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { HeaderSection } from "@/components/layout/HeaderSection";
import { FooterSection } from "@/components/layout/FooterSection";

/**
 * UI05.3: the shared page shell (sidebar, header, page, footer) in one place.
 * It renders exactly what pages assembled by hand before, so a page moved
 * onto it looks and behaves the same. Adopted so far: /categories, /tags and
 * /users (UI05), /projects/<slug>, /shared-projects/<name> and /users/<name>
 * (UI06), with their loading screens. Other pages move as their phase comes.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      {/* UI09: min-w-0 so wide content (the admin charts) can't push the
          inset, header included, past the viewport; it's what the admin
          page set by hand before it moved onto the shell. */}
      <SidebarInset className="min-w-0">
        <HeaderSection />
        {children}
        <FooterSection />
      </SidebarInset>
    </SidebarProvider>
  );
}
