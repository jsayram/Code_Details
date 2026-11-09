"use client";

import React from "react";
import { SignedIn, SignedOut } from "@/components/auth/AuthGate";
import { DarkModeButton } from "@/components/DarkModeButtonComponent";
import { Logo } from "@/components/CodeDetailsLogoComponent";
import { Menu } from "lucide-react";
import { UserProfileButton } from "@/components/UserProfileButton";
import { SidebarTrigger, useSidebarOptional } from "../ui/sidebar";
import { DynamicBreadcrumbs } from "../navigation/BreadCrumbsComponent";
import { SignInButtonComponent } from "../auth/SignInButtonComponent";
import "@/styles/shell-foundations";

// Define the breadcrumb item interface
interface BreadcrumbItemData {
  label: string;
  href?: string;
  isCurrentPage?: boolean;
}

interface HeaderSectionProps {
  isSticky?: boolean; // Control sticky behavior
  showDarkModeButton?: boolean; // Control dark mode button visibility
  showLogo?: boolean; // Control logo visibility
  showMobileMenu?: boolean; // Enable responsive mobile menu
  className?: string; // Additional classes
  breadcrumbs?: BreadcrumbItemData[]; // Dynamic breadcrumbs
}

/**
 * UI05: the shared header, on the design foundations. It's solid, so content
 * no longer scrolls under it with nothing behind. It scopes only itself;
 * the page below keeps its own look until it adopts the foundations.
 *
 * Signed out, when the sidebar is a sheet (below 1024px), the header shows
 * the logo and a menu button that opens that same sheet: the signed-out
 * entries with Sign In in its footer (Jose, option A). On wider screens the
 * sidebar is visible and carries the only logo.
 */
export function HeaderSection({
  showDarkModeButton = true,
  showLogo = true,
  showMobileMenu = true,
}: HeaderSectionProps) {
  const sidebar = useSidebarOptional();
  const sidebarIsSheet = sidebar?.isMobile ?? false;
  const menuButton = showMobileMenu && sidebar && sidebarIsSheet;

  return (
    <>
      <header className="cd-foundations cd-shell-header" data-shell="header">
        <SignedIn>
          {sidebar && <SidebarTrigger />}
          {sidebar && <span className="cd-shell-divider" aria-hidden="true" />}
          <div className="cd-shell-crumbs">
            <DynamicBreadcrumbs />
          </div>
          <div className="cd-shell-actions">
            <DarkModeButton />
            <UserProfileButton />
          </div>
        </SignedIn>

        <SignedOut>
          {showLogo && (!sidebar || sidebarIsSheet) ? (
            <Logo size="md" showTagline={false} href="/" />
          ) : null}
          <div className="cd-shell-actions">
            {showDarkModeButton && <DarkModeButton />}
            <div className={menuButton ? "hidden sm:block" : "block"}>
              <SignInButtonComponent text="Sign In" useTypingEffect={false} variant="plain" />
            </div>
            {menuButton && (
              <button
                type="button"
                className="cd-shell-icon-button"
                onClick={() => sidebar.setOpenMobile(true)}
                aria-label="Open menu"
                aria-haspopup="dialog"
                aria-expanded={sidebar.openMobile}
              >
                <Menu aria-hidden="true" className="h-5 w-5" />
              </button>
            )}
          </div>
        </SignedOut>
      </header>
      {/* The skip link in the sidebar lands here, past the sidebar and header. */}
      <span id="main-content" tabIndex={-1} data-shell="skip-target" className="cd-skip-target" />
    </>
  );
}
