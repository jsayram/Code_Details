import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// UI03.3: the foundations stylesheet's colors, read from the file itself so the
// numbers in docs/DESIGN.md can't drift from what ships.
const css = fs.readFileSync(path.resolve(__dirname, "../../src/styles/foundations.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

function tokens(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of block(selector).matchAll(/(--cd-[a-z0-9-]+):\s*(#[0-9a-f]{6});/g)) out[name] = value;
  return out;
}

const light = tokens(".cd-foundations");
const dark = { ...light, ...tokens(".dark .cd-foundations") };

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { hue: 0, saturation: 0 };
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const light = (max + min) / 2;
  return { hue: (hue * 60 + 360) % 360, saturation: d / (1 - Math.abs(2 * light - 1)) };
}

const backgrounds = ["--cd-bg", "--cd-surface", "--cd-raised"];
const TEXT_PAIRS: [string, string][] = [
  ...["--cd-text", "--cd-muted", "--cd-action", "--cd-success", "--cd-warning", "--cd-danger"].flatMap((fg) => backgrounds.map((bg): [string, string] => [fg, bg])),
  ["--cd-on-action", "--cd-action"],
  ["--cd-on-action", "--cd-action-hover"],
  ["--cd-on-selected", "--cd-selected"],
  ["--cd-success", "--cd-success-soft"],
  ["--cd-warning", "--cd-warning-soft"],
  ["--cd-danger", "--cd-danger-soft"],
  ["--cd-on-danger", "--cd-danger"],
];
const NON_TEXT_PAIRS: [string, string][] = [
  ["--cd-border-control", "--cd-bg"],
  ["--cd-border-control", "--cd-surface"],
  ["--cd-focus", "--cd-bg"],
  ["--cd-focus", "--cd-surface"],
  ["--cd-focus", "--cd-raised"],
];

describe.each([["light", light], ["dark", dark]] as const)("%s tokens", (_, t) => {
  it.each(TEXT_PAIRS)("%s on %s reaches 4.5:1", (fg, bg) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)("%s on %s reaches 3:1", (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
  });

  it("keeps disabled text readable, though WCAG exempts it", () => {
    expect(contrast(t["--cd-on-disabled"], t["--cd-disabled"])).toBeGreaterThanOrEqual(3.5);
  });

  it("has no purple (decision 4)", () => {
    // Category chips follow Jose's UI06 rule instead (pink and rose allowed,
    // OKLCH 258-330 out); tests/unit/ui06-category-tokens.test.ts checks them.
    const purple = Object.entries(t).filter(([name, hex]) => {
      if (name.startsWith("--cd-cat-")) return false;
      const { hue, saturation } = hueAndSaturation(hex);
      return saturation > 0.15 && hue >= 245 && hue <= 340;
    });
    expect(purple).toEqual([]);
  });
});

it("uses the brief's agreed values for background, text and action", () => {
  expect([light["--cd-bg"], light["--cd-text"], light["--cd-action"]]).toEqual(["#f5f6f7", "#202326", "#005fb8"]);
  expect([dark["--cd-bg"], dark["--cd-text"], dark["--cd-action"]]).toEqual(["#171b1f", "#f0f3f5", "#92caff"]);
});

it("loads no font file and no external asset", () => {
  expect(css).not.toMatch(/@font-face|@import|url\(/);
});

it("is imported only by the preview route and the screens that adopted it", () => {
  const root = path.resolve(__dirname, "../../src");
  const importers: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "output") walk(full);
      } else if (/\.(tsx?|css)$/.test(entry.name) && /foundations\.css/.test(fs.readFileSync(full, "utf8"))) {
        importers.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  expect(importers.sort()).toEqual([
    path.join("app", "(administrator)", "dashboard", "admin", "design-foundations", "layout.tsx"),
    // UI04: the first adopted screen, its page and its loading screen.
    path.join("app", "categories", "loading.tsx"),
    path.join("app", "categories", "page.tsx"),
    // UI05: the shared shell, through one module its components import.
    path.join("styles", "shell-foundations.ts"),
    // UI06: the showcase. The project card and list placeholders carry their
    // own scope wherever they appear.
    path.join("components", "Projects", "ProjectComponents", "ProjectCardComponent.tsx"),
    path.join("components", "LoadingState", "ProjectListLoadingState.tsx"),
    // UI06.2: the public project page (view mode), its placeholder and error screen.
    path.join("app", "projects", "[slug]", "page.tsx"),
    path.join("app", "projects", "[slug]", "error.tsx"),
    path.join("app", "projects", "[slug]", "project-page-skeleton.tsx"),
    path.join("components", "Projects", "ProjectComponents", "ProjectContent.tsx"),
    // UI06.3: the public profile (shared projects) and the member profile.
    path.join("app", "shared-projects", "[username]", "page.tsx"),
    path.join("app", "users", "[username]", "page.tsx"),
    path.join("app", "users", "[username]", "loading.tsx"),
  ].sort());
});

it("paints the shell frame with the page color it stands in for (UI05)", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../../src/styles/foundations.css"), "utf8");
  const scope = (sel: string) => css.slice(css.indexOf(`${sel} {`)).split("}")[0];
  const bg = (block: string) => /--cd-bg:\s*(#[0-9a-f]{6})/i.exec(block)![1];
  const frame = (block: string) => /background:\s*(#[0-9a-f]{6})/i.exec(block)![1];
  expect(frame(scope(".cd-shell-frame"))).toBe(bg(scope(".cd-foundations")));
  expect(frame(scope(".dark .cd-shell-frame"))).toBe(bg(scope(".dark .cd-foundations")));
});
