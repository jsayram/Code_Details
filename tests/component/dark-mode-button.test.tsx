// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@/providers/theme-provider";
import { DarkModeButton } from "@/components/DarkModeButtonComponent";

// jsdom has no matchMedia; next-themes and isSystemDarkMode both read it.
// The synthetic system preference is light.
function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderSwitch() {
  // Same provider props as src/app/layout.tsx.
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <DarkModeButton />
    </ThemeProvider>,
  );
}

describe("DarkModeButton", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts light when the system prefers light", async () => {
    renderSwitch();
    const toggle = await screen.findByRole("switch", { name: "Toggle theme" });
    expect(toggle).toHaveProperty("ariaChecked", "false");
    expect(toggle.getAttribute("title")).toBe("Switch to dark mode");
  });

  it("switches to dark and back on click, and persists the choice", async () => {
    const user = userEvent.setup();
    renderSwitch();
    const toggle = await screen.findByRole("switch", { name: "Toggle theme" });

    await user.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");

    await user.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("starts dark when dark was saved", async () => {
    localStorage.setItem("theme", "dark");
    renderSwitch();
    const toggle = await screen.findByRole("switch", { name: "Toggle theme" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  // UI05: the switch is a real button now (the preflight branch's d767a4b,
  // adapted), so Tab reaches it and Space and Enter flip it.
  it("is reachable with Tab and flips with Space and Enter", async () => {
    const user = userEvent.setup();
    renderSwitch();
    const toggle = await screen.findByRole("switch", { name: "Toggle theme" });
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard(" ");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});
