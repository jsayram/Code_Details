// For motion CSS can't reach. Read it when the motion starts, not during
// render, so server and client markup stay the same.
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** The `behavior` for scrollTo and scrollIntoView. */
export function scrollMotion(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
