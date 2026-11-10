"use client";
import * as React from "react";
import { SignedIn, SignedOut } from "@/components/auth/AuthGate";
import { AccountSignOutButton } from "@/components/auth/AccountButton";
import {
  Code,
  Database,
  FileCode,
  LifeBuoy,
  LogIn,
  Map,
  PieChart,
  Smartphone,
  BrainCircuit,
  SquareTerminal,
  BookOpen,
  Bot,
  Send,
  Folder,
  Search,
  FolderGit2,
} from "lucide-react";

import { NavMain } from "@/components/sidebar/nav-main";
import { NavSecondary } from "@/components/sidebar/nav-secondary";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "@/styles/shell-foundations";
import { Logo } from "../CodeDetailsLogoComponent";
import { SignInButtonComponent } from "../auth/SignInButtonComponent";

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: PieChart,
      isActive: true,
      signedInOnly: true,
    },
    {
      title: "Search",
      url: "/search",
      icon: Search,
      items: [
        {
          title: "Categories",
          url: "/categories",
        },
        {
          title: "Tags",
          url: "/tags",
        },
        {
          title: "Users",
          url: "/users",
        },
      ],
    },
    {
      title: "Projects",
      url: "/projects",
      icon: Folder,
      items: [
        {
          title: "Community Projects",
          url: "/projects",
        },
        {
          title: "My Projects Portfolio",
          url: "/projects/projects-portfolio",
          signedInOnly: true,
        },
        {
          title: "My Favorites",
          url: "/projects/favorites",
          signedInOnly: true,
        },
        {
          title: "Graveyard",
          url: "/projects/deleted",
          signedInOnly: true,
        },
      ],
    },
    {
      title: "GitHub Scraper",
      url: "/github-scrapper",
      icon: FolderGit2,
      signedInOnly: true,
      items: [
        {
          title: "Generate Docs",
          url: "/github-scrapper",
        },
        {
          title: "My Generated Docs",
          url: "/github-scrapper/my-docs",
        },
      ],
    },
    // ====================================================================
    // COMMENTED OUT: Future Features - Pages not yet implemented
    // ====================================================================
    // {
    //   title: "Documentation",
    //   url: "/docs",
    //   icon: BookOpen,
    //   items: [
    //     {
    //       title: "API Reference",
    //       url: "/docs/api",
    //     },
    //     {
    //       title: "Guides",
    //       url: "/docs/guides",
    //     },
    //     {
    //       title: "Examples",
    //       url: "/docs/examples",
    //     },
    //   ],
    // },
    // {
    //   title: "AI Assistant",
    //   url: "/ai",
    //   icon: Bot,
    //   items: [
    //     {
    //       title: "Code Generation",
    //       url: "/ai/generate",
    //     },
    //     {
    //       title: "Refactoring",
    //       url: "/ai/refactor",
    //     },
    //     {
    //       title: "Explanations",
    //       url: "/ai/explain",
    //     },
    //     {
    //       title: "History",
    //       url: "/ai/history",
    //     },
    //   ],
    // },
    // {
    //   title: "Collaboration",
    //   url: "/collaborate",
    //   icon: Send,
    //   items: [
    //     {
    //       title: "Team Projects",
    //       url: "/collaborate/teams",
    //     },
    //     {
    //       title: "Shared Code",
    //       url: "/collaborate/shared",
    //     },
    //     {
    //       title: "Pull Requests",
    //       url: "/collaborate/pull-requests",
    //     },
    //     {
    //       title: "Comments",
    //       url: "/collaborate/comments",
    //     },
    //   ],
    // },
  ],
  navSecondary: [
    {
      title: "About Developer",
      url: "/about",
      icon: BrainCircuit,
    },
    {
      title: "Help & Support",
      url: "/support",
      icon: LifeBuoy,
    },
    {
      title: "Developer Community",
      url: "/community",
      icon: Map,
    },
  ],
  // ====================================================================
  // COMMENTED OUT: Sample Projects - Not actual project routes
  // These are placeholder projects, not real pages. Remove or replace with dynamic user projects.
  // ====================================================================
  // projects: [
  //   {
  //     title: "React Portfolio",
  //     name: "React Portfolio",
  //     owner: "Personal",
  //     lastUpdated: "Today",
  //     isNew: true,
  //     url: "/projects/react-portfolio",
  //     icon: Code,
  //   },
  //   {
  //     title: "TypeScript API",
  //     name: "TypeScript API",
  //     owner: "Work Team",
  //     lastUpdated: "Yesterday",
  //     url: "/projects/typescript-api",
  //     icon: FileCode,
  //   },
  //   {
  //     title: "E-Commerce Backend",
  //     name: "E-Commerce Backend",
  //     owner: "Client Project",
  //     lastUpdated: "2 days ago",
  //     url: "/projects/ecommerce-backend",
  //     icon: Database,
  //   },
  //   {
  //     title: "Mobile App",
  //     name: "Mobile App",
  //     owner: "Collaboration",
  //     lastUpdated: "Last week",
  //     url: "/projects/mobile-app",
  //     icon: Smartphone,
  //   },
  // ],
};

/** The main navigation entries, exported for tests. */
export const NAV_MAIN = data.navMain;

export function AppSidebar({ className, ...props }: React.ComponentProps<typeof Sidebar>) {
  // UI05: the sidebar scopes only itself (desktop panel and phone sheet), so
  // page content keeps its own look until it adopts the foundations.
  return (
    <>
      <a href="#main-content" className="cd-foundations cd-skip-link" data-shell="skip">
        Skip to content
      </a>
      <Sidebar variant="inset" className={cn("cd-foundations cd-shell-sidebar", className)} {...props}>
        <SidebarHeader>
          <div className="cd-shell-sidebar-logo">
            <Logo size="md" showTagline={false} />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <NavMain items={data.navMain} />
          <NavSecondary items={data.navSecondary} className="mt-auto" />
        </SidebarContent>
        <SidebarFooter className="cd-shell-sidebar-footer">
          <SignedIn>
            <AccountSignOutButton>
              <Button variant="outline" className="w-full">
                Sign out
              </Button>
            </AccountSignOutButton>
          </SignedIn>
          <SignedOut>
            <SignInButtonComponent text="Sign In" useTypingEffect={false} variant="plain" />
          </SignedOut>
        </SidebarFooter>
      </Sidebar>
    </>
  );
}
