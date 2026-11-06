// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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

  it("still types with reduced motion off", () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { container } = render(<TextTypingEffectAnimation text="abc" speed={10} />);
    expect(container.textContent).toBe("");
    act(() => { vi.advanceTimersByTime(40); });
    expect(container.textContent).toBe("abc");
  });
});
