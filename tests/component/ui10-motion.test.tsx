// @vitest-environment jsdom
// UI10: home's particles stay inside the UI01 budget (18, code only, CSS
// driven, never in the way of the pointer) and say when they should pause;
// a scripted jump takes keyboard focus with it.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { CodeParticlesElement, PARTICLE_COUNT } from "@/components/Elements/CodeParticlesElement";
import { moveFocusTo } from "@/lib/reduced-motion";

let ioCallback: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
class FakeIntersectionObserver {
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
    ioCallback = cb;
  }
  observe() {}
  disconnect() {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  ioCallback = undefined;
});

const layer = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-decorative="code-particles"]')!;

describe("CodeParticlesElement", () => {
  it("draws 18 code symbols, no emoji, the same on every render", () => {
    const a = render(<CodeParticlesElement />);
    const first = [...layer(a.container).children].map((el) => `${el.textContent}|${(el as HTMLElement).style.cssText}`);
    cleanup();
    const b = render(<CodeParticlesElement />);
    const second = [...layer(b.container).children].map((el) => `${el.textContent}|${(el as HTMLElement).style.cssText}`);
    expect(PARTICLE_COUNT).toBe(18);
    expect(first).toHaveLength(18);
    expect(second).toEqual(first);
    expect(first.join("")).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("is hidden from assistive tech and ignores the pointer (F01-7)", () => {
    const { container } = render(<CodeParticlesElement />);
    const l = layer(container);
    expect(l.getAttribute("aria-hidden")).toBe("true");
    expect(l.className).toContain("pointer-events-none");
  });

  it("stops for the pause button, a hidden tab, offscreen and data saver", () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { container, rerender } = render(<CodeParticlesElement />);
    expect(layer(container).dataset.running).toBe("true");

    rerender(<CodeParticlesElement paused />);
    expect(layer(container).dataset.running).toBe("false");
    rerender(<CodeParticlesElement />);
    expect(layer(container).dataset.running).toBe("true");

    act(() => ioCallback!([{ isIntersecting: false }]));
    expect(layer(container).dataset.running).toBe("false");
    act(() => ioCallback!([{ isIntersecting: true }]));
    expect(layer(container).dataset.running).toBe("true");

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(layer(container).dataset.running).toBe("false");
    visibility.mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(layer(container).dataset.running).toBe("true");
    visibility.mockRestore();
  });

  it("starts paused when the browser asks to save data", () => {
    vi.stubGlobal("navigator", { ...navigator, connection: { saveData: true } });
    const { container } = render(<CodeParticlesElement />);
    expect(layer(container).dataset.running).toBe("false");
  });

  it("only animates without reduced motion, pauses through the attribute, and shows 10 on a phone", () => {
    const css = fs.readFileSync(path.join(__dirname, "../../src/styles/globals.css"), "utf8");
    const noPref = css.split("@media (prefers-reduced-motion: no-preference)").slice(1).join("");
    expect(noPref).toContain("animation-name: cd-particle-drift");
    expect(css.split("@media (prefers-reduced-motion: no-preference)")[0]).not.toContain("animation-name: cd-particle-drift");
    expect(noPref).toContain('.cd-particles[data-running="false"] .cd-particle');
    expect(css).toMatch(/\.cd-particle:nth-child\(n \+ 11\)\s*\{\s*display: none;/);
    // The drift moves transform and opacity only.
    const drift = css.slice(css.indexOf("@keyframes cd-particle-drift"), css.indexOf("@media (prefers-reduced-motion: no-preference)", css.indexOf("@keyframes cd-particle-drift")));
    const props = [...drift.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
    expect(new Set(props)).toEqual(new Set(["transform", "opacity"]));
  });
});

describe("overlay durations", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../src/styles/globals.css"), "utf8");
  // The first `--tw-duration` after the selector's line.
  const durationFor = (selector: string) => {
    const at = [`${selector}\n`, `${selector} {`].map((x) => css.indexOf(x)).find((x) => x >= 0) ?? -1;
    if (at < 0) return NaN;
    return Number(css.slice(at).match(/--tw-duration: (\d+)ms;/)?.[1]);
  };
  it("menus open in 180ms and dialogs and sheets in 240ms, exits about 20% shorter", () => {
    expect(durationFor('[data-slot="dropdown-menu-content"],')).toBe(180);
    expect(durationFor('[data-slot="dialog-content"],')).toBe(240);
    expect(durationFor('[data-slot="tooltip-content"][data-state="closed"]')).toBe(144);
    expect(durationFor('[data-slot="sidebar"][data-mobile="true"][data-state="closed"]')).toBe(192);
    expect(css).toContain("animation: fade-in var(--tw-duration, 150ms) ease-out;");
  });
});

describe("moveFocusTo", () => {
  it("focuses the target without scrolling, making it focusable if needed", () => {
    const section = document.createElement("section");
    document.body.append(section);
    const focus = vi.spyOn(section, "focus");
    moveFocusTo(section);
    expect(section.getAttribute("tabindex")).toBe("-1");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(section);
    section.remove();
  });

  it("keeps an element's own tabindex and ignores a missing target", () => {
    const button = document.createElement("button");
    button.tabIndex = 0;
    document.body.append(button);
    moveFocusTo(button);
    expect(button.getAttribute("tabindex")).toBe("0");
    expect(() => moveFocusTo(null)).not.toThrow();
    button.remove();
  });
});
