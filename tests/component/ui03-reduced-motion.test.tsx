// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TextTypingEffectAnimation } from "@/animations/TextTypingEffectAnimation";
import { prefersReducedMotion, scrollMotion } from "@/lib/reduced-motion";

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: matches && query.includes("reduce"), media: query })));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("prefersReducedMotion", () => {
  it("follows the system setting", () => {
    stubReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollMotion()).toBe("auto");
    stubReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollMotion()).toBe("smooth");
  });

  it("treats a browser without matchMedia as no preference", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("TextTypingEffectAnimation", () => {
  it("shows the whole text at once with reduced motion on, and still completes", () => {
    stubReducedMotion(true);
    const onComplete = vi.fn();
    render(<TextTypingEffectAnimation text="Search Code Details" onComplete={onComplete} />);
    expect(screen.getByText("Search Code Details")).toBeTruthy();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // UI10: the text is whole from the first render (a link has its name at
  // once); a stepped CSS clip reveals it, capped at a second.
  it("still types with reduced motion off, without hiding the text", () => {
    stubReducedMotion(false);
    const onComplete = vi.fn();
    const { container } = render(<TextTypingEffectAnimation text="abc" speed={10} onComplete={onComplete} />);
    const span = container.querySelector<HTMLElement>(".cd-typing")!;
    expect(span.textContent).toBe("abc");
    expect(span.style.getPropertyValue("--cd-type-steps")).toBe("3");
    expect(span.style.animationDuration).toBe("30ms");
    expect(onComplete).not.toHaveBeenCalled();
    // jsdom has no AnimationEvent, so React listens for the prefixed name.
    fireEvent(span, new Event(typeof AnimationEvent === "undefined" ? "webkitAnimationEnd" : "animationend", { bubbles: true }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("caps a long label's reveal at a second", () => {
    stubReducedMotion(false);
    const { container } = render(<TextTypingEffectAnimation text="sudo --authenticate user" speed={120} />);
    expect(container.querySelector<HTMLElement>(".cd-typing")!.style.animationDuration).toBe("1000ms");
  });
});
