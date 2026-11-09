"use client";

import React from "react";
import { scrollMotion } from "@/lib/reduced-motion";
import { ArrowUp } from "lucide-react";
import "@/styles/shell-foundations";

// UI05: the shared footer on the design foundations. Back to top is a 44px
// pill with its name on screen; the copyright line keeps its wording.
// Legal pages (/terms, /privacy, /cookies) still need writing before
// production, and get their links here when they exist.
export const FooterSection = () => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: scrollMotion() });
  };

  return (
    <footer className="cd-foundations cd-shell-footer" data-shell="footer">
      <button type="button" onClick={scrollToTop} className="cd-shell-pill-button">
        <ArrowUp aria-hidden="true" className="h-4 w-4" />
        Back to top
      </button>
      <p className="cd-caption">&copy; {new Date().getFullYear()} Code Details. All rights reserved.</p>
    </footer>
  );
};
