import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_CATEGORIES } from "@/constants/project-categories";

// UI06: every category has its own chip color, as tokens in the foundations
// stylesheet. Jose's rule: distinct hues, none purple, text at least 4.5:1 on
// the chip in both themes.
const css = fs.readFileSync(path.resolve(__dirname, "../../src/styles/foundations.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
};
const read = (selector: string) => {
  const out: Record<string, string> = {};
  for (const [, name, value] of block(selector).matchAll(/(--cd-cat-[a-z0-9-]+):\s*(#[0-9a-f]{6});/g)) out[name] = value;
  return out;
};
const light = read(".cd-foundations");
const dark = { ...light, ...read(".dark .cd-foundations") };

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hueSat = (hex: string) => {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return { hue: 0, sat: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, sat: d / (1 - Math.abs(max + min - 1)) };
};
const keys = Object.keys(PROJECT_CATEGORIES);

describe.each([["light", light], ["dark", dark]] as const)("%s category chips", (_, t) => {
  it.each(keys)("%s: text reaches 4.5:1 on its chip", (key) => {
    const fg = t[`--cd-cat-${key}-fg`], bg = t[`--cd-cat-${key}-bg`];
    expect(fg, key).toBeDefined();
    expect(bg, key).toBeDefined();
    expect(t[`--cd-cat-${key}-border`], key).toBeDefined();
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("has no purple", () => {
    const purple = Object.entries(t).filter(([, hex]) => {
      const { hue, sat } = hueSat(hex);
      return sat > 0.15 && hue >= 245 && hue <= 340;
    });
    expect(purple).toEqual([]);
  });

  it("gives each category its own text color", () => {
    const fgs = keys.map((k) => t[`--cd-cat-${k}-fg`]);
    expect(new Set(fgs).size).toBe(keys.length);
  });
});

it("maps every category to its tokens", () => {
  for (const key of keys) expect(css).toContain(`.cd-cat[data-category="${key}"] { --cd-cat-bg: var(--cd-cat-${key}-bg);`);
});
