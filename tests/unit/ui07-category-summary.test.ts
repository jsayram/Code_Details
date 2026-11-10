// UI07 (Jose's decision): cards and tiles show the short form of a category's
// description; the full wording stays on the category page and in the picker.
import { describe, expect, it } from "vitest";
import { PROJECT_CATEGORIES, categorySummary } from "@/constants/project-categories";

describe("categorySummary", () => {
  it("stops at the first sentence end or colon", () => {
    expect(categorySummary("Server-side applications, APIs and services. Database engines go in Databases & Storage")).toBe("Server-side applications, APIs and services");
    expect(categorySummary("Games, game engines and rendered graphics: 3D, shaders, simulations. Audio and video tools go in Multimedia & Streaming")).toBe("Games, game engines and rendered graphics");
    expect(categorySummary("Browser-based applications and websites")).toBe("Browser-based applications and websites");
    expect(categorySummary("Ends with a period.")).toBe("Ends with a period");
  });

  it("keeps a version number or a dotted name whole", () => {
    expect(categorySummary("Node.js tools and Python 3.13 scripts")).toBe("Node.js tools and Python 3.13 scripts");
  });

  it("gives every category a non-empty summary that starts its description", () => {
    for (const [key, { description }] of Object.entries(PROJECT_CATEGORIES)) {
      const s = categorySummary(description);
      expect(s.length, key).toBeGreaterThan(10);
      expect(description.startsWith(s), key).toBe(true);
    }
  });

  it("drops the tie-break wording from the long ones", () => {
    for (const key of ["backend", "database-storage", "dev-tools", "gaming-graphics", "multimedia", "ai-ml", "data-engineering"] as const) {
      expect(categorySummary(PROJECT_CATEGORIES[key].description), key).not.toMatch(/ go(es)? in /);
    }
  });
});
