// For motion CSS can't reach. Read it when the motion starts, not during
// render, so server and client markup stay the same.
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** The `behavior` for scrollTo and scrollIntoView. */
export function scrollMotion(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/**
 * UI10: after a scripted jump, move keyboard focus to where the view went,
 * so the next Tab continues there instead of back at the control that was
 * pressed. `preventScroll` leaves the (possibly smooth) scroll alone.
 */
export function moveFocusTo(el: HTMLElement | null): void {
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}
