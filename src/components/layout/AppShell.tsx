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
      <SidebarInset>
        <HeaderSection />
        {children}
        <FooterSection />
      </SidebarInset>
    </SidebarProvider>
  );
}
