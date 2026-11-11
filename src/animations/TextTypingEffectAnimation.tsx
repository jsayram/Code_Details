"use client";

import React, { useEffect } from "react";
import { TEXT_TYPING_SPEED_MS } from "@/constants/project-limits";
import { prefersReducedMotion } from "@/lib/reduced-motion";

// UI10: the terminal's typed labels. The whole text is in the page from the
// first render, so a link has its name and full size straight away; a CSS
// `steps()` clip reveals it one character at a time (globals.css .cd-typing).
// No timer or re-render per character. The reveal takes at most
// `maxDurationMs`, so a label is readable within a second. With reduced
// motion the text simply shows.
export function TextTypingEffectAnimation({
  text,
  speed = TEXT_TYPING_SPEED_MS,
  className = "",
  onComplete,
  maxDurationMs = 1000,
}: {
  text: string;
  /** Milliseconds per character, before the cap. */
  speed?: number;
  className?: string;
  onComplete?: () => void; // for stuff to show up after typing
  maxDurationMs?: number;
  /** Kept for callers; the reveal already runs once per mount. */
  skipOnRerender?: boolean;
}) {
  const steps = Math.max(1, Array.from(text).length);
  const duration = Math.min(steps * speed, maxDurationMs);

  // With reduced motion no animation runs, so animationend never fires.
  useEffect(() => {
    if (prefersReducedMotion()) onComplete?.();
  }, [text, onComplete]);

  return (
    <span
      className={`cd-typing ${className}`}
      style={{ "--cd-type-steps": steps, animationDuration: `${duration}ms` } as React.CSSProperties}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) onComplete?.();
      }}
    >
      {text}
    </span>
  );
}
