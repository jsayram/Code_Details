import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_CATEGORIES } from "@/constants/project-categories";

// UI06: every category has its own chip color, as tokens in the foundations
// stylesheet. Jose's rules: clearly distinct in both themes, no purple or
// violet (OKLCH hue 258-330; pink and rose are fine), text at least 4.5:1 on
// the chip, Other the only neutral, and four pairs he named well apart. Three
// keys belong to categories a later phase adds; their tokens are here already.
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
const UPCOMING = ["ai-agents", "generative-ai", "libraries-frameworks"];
const keys = [...Object.keys(PROJECT_CATEGORIES), ...UPCOMING];

// OKLab distance, the measure the palette was built with.
const oklab = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const dist = (a: string, b: string) => {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

describe.each([["light", light], ["dark", dark]] as const)("%s category chips", (_, t) => {
  it.each(keys)("%s: text reaches 4.5:1 on its chip", (key) => {
    const fg = t[`--cd-cat-${key}-fg`], bg = t[`--cd-cat-${key}-bg`];
    expect(fg, key).toBeDefined();
    expect(bg, key).toBeDefined();
    expect(t[`--cd-cat-${key}-border`], key).toBeDefined();
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("has no purple or violet (OKLCH hue 258-330)", () => {
    const purple = Object.entries(t).filter(([, hex]) => {
      const [, a, b] = oklab(hex);
      const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
      return Math.hypot(a, b) > 0.03 && hue > 258 && hue < 330;
    });
    expect(purple).toEqual([]);
  });

  it.each([
    ["testing-qa", "security"],
    ["ai-ml", "cloud-devops"],
    ["data-engineering", "desktop"],
    ["embedded-iot", "dev-tools"],
  ])("keeps %s and %s clearly apart", (a, b) => {
    const d = (dist(t[`--cd-cat-${a}-fg`], t[`--cd-cat-${b}-fg`]) + dist(t[`--cd-cat-${a}-bg`], t[`--cd-cat-${b}-bg`])) / 2;
    expect(d).toBeGreaterThanOrEqual(0.1);
  });

  it("keeps every pair of chips apart (text and fill together)", () => {
    const close: string[] = [];
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const [a, b] = [keys[i], keys[j]];
        const d = (dist(t[`--cd-cat-${a}-fg`], t[`--cd-cat-${b}-fg`]) + dist(t[`--cd-cat-${a}-bg`], t[`--cd-cat-${b}-bg`])) / 2;
        if (d < 0.024) close.push(`${a}/${b} ${d.toFixed(3)}`);
      }
    expect(close).toEqual([]);
  });

  it("has Other as the only neutral chip", () => {
    const neutral = keys.filter((k) => hueSat(t[`--cd-cat-${k}-bg`]).sat < 0.1 && hueSat(t[`--cd-cat-${k}-fg`]).sat < 0.1);
    expect(neutral).toEqual(["other"]);
  });
});

it("maps every category to its tokens", () => {
  for (const key of keys) expect(css).toContain(`.cd-cat[data-category="${key}"] { --cd-cat-bg: var(--cd-cat-${key}-bg);`);
});
