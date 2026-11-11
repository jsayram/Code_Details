"use client";

// UI09.1: the frame the sign-in, sign-up and sign-out screens share, on the
// design foundations: the sidebar-less header, one main with the screen's
// card centered in it, and the footer. No particles (DESIGN.md keeps them for
// home); the card carries the page's one h1.
import "@/styles/foundations.css";
import type { ReactNode } from "react";
import { HeaderSectionNoSideBar } from "@/components/layout/HeaderSectionNoSideBar";
import { FooterSection } from "@/components/layout/FooterSection";

export function AuthPageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="cd-foundations cd-canvas cd-auth-page">
      <HeaderSectionNoSideBar showSignInButton={false} showMobileMenu={false} />
      <main className="cd-auth-main">
        <div className="cd-auth-column">{children}</div>
      </main>
      <FooterSection />
    </div>
  );
}

/** The greeting above a card ("Hopefully you are not lost."): words, not a heading. */
export function AuthGreeting({ title, subtitle }: { title?: string; subtitle?: string }) {
  if (!title && !subtitle) return null;
  return (
    <div className="cd-auth-greeting">
      {title ? <p className="cd-lead">{title}</p> : null}
      {subtitle ? <p className="cd-small cd-muted">{subtitle}</p> : null}
    </div>
  );
}
