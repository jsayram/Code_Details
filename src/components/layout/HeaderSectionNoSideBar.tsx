"use client";
import React, { useEffect, useId, useRef, useState } from "react";
import { AccountButton, AccountSignOutButton } from "@/components/auth/AccountButton";
import { SignedIn, SignedOut } from "@/components/auth/AuthGate";
import { Button } from "@/components/ui/button";
import { DarkModeButton } from "@/components/DarkModeButtonComponent";
import { Logo } from "@/components/CodeDetailsLogoComponent";
import { Menu, X } from "lucide-react";
import { SignInButtonComponent } from "../auth/SignInButtonComponent";
import { toast } from "sonner";
import Image from "next/image";
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
  showSignInButton?: boolean; // Control sign-in button visibility
  className?: string; // Additional classes
  breadcrumbs?: BreadcrumbItemData[]; // Dynamic breadcrumbs
}

/**
 * UI05: the header for pages without the sidebar (project, share and auth
 * pages), on the design foundations like the shared header. The logo keeps
 * its old behavior, a sign-in hint, but is now a button the keyboard reaches.
 * The phone menu is hidden from everyone while closed, says whether it's open,
 * and closes on Escape with focus back on its button.
 */
export function HeaderSectionNoSideBar({
  showDarkModeButton = true,
  showLogo = true,
  showMobileMenu = true, // Default to showing mobile menu on small screens
  showSignInButton = true, // Default to showing sign-in button
}: HeaderSectionProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  const handleLogoClick = () => {
    toast.dismiss();
    toast.info(
      <div className="relative flex flex-row items-center gap-2">
        <Image src="/images/mascot.png" alt="Code Minion" width={50} height={50} className="relative rounded-md" />
        <p>You should try to sign in to see all that Code Details has to offer</p>
      </div>,
      {
        duration: 4000,
      }
    );
  };

  return (
    <header className="cd-foundations cd-shell-header" data-shell="header" data-sidebar-less="true">
      {showLogo ? (
        <button type="button" className="cd-shell-logo-button" onClick={handleLogoClick}>
          <Logo size="md" showTagline={false} href="" />
        </button>
      ) : (
        <span className="w-8" />
      )}

      <div className="cd-shell-actions">
        {showDarkModeButton && <DarkModeButton />}
        <SignedIn>
          <AccountButton appearance={{ elements: { userButtonAvatarBox: "w-9 h-9" } }} />
        </SignedIn>
        <SignedOut>
          {showSignInButton && (
            <div className={showMobileMenu ? "hidden sm:block" : "block"}>
              <SignInButtonComponent text="Sign In" useTypingEffect={false} variant="plain" />
            </div>
          )}
        </SignedOut>
        {showMobileMenu && (
          <button
            ref={menuButton}
            type="button"
            className="cd-shell-icon-button sm:hidden"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls={menuId}
          >
            {mobileMenuOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
          </button>
        )}
      </div>

      {showMobileMenu && (
        <div id={menuId} className="cd-shell-menu-panel sm:hidden" hidden={!mobileMenuOpen}>
          <SignedIn>
            <AccountButton afterSignOutUrl="/" appearance={{ elements: { userButtonAvatarBox: "w-10 h-10" } }} />
            <AccountSignOutButton>
              <Button variant="outline" className="w-full">
                Sign Out
              </Button>
            </AccountSignOutButton>
          </SignedIn>
          <SignedOut>
            <SignInButtonComponent text="Sign In" useTypingEffect={false} variant="plain" />
          </SignedOut>
        </div>
      )}
    </header>
  );
}
