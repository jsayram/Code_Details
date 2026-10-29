// D02: the shared project update rules (src/backend/projects/project-update-rules.ts).
import { describe, expect, it } from "vitest";
import {
  MAX_CATEGORY_DATA_CHARS,
  checkCategoryData,
  checkLinks,
  dedupeTags,
  isHttpUrl,
  normalizeProjectPatch,
  tagNameKey,
} from "@/backend/projects/project-update-rules";
import { projectLinkSchema, updateProjectSchema } from "@/types/schemas/project";

describe("isHttpUrl", () => {
  it.each(["https://a.invalid/", "http://a.invalid/x?y=1"])("accepts %s", (u) => expect(isHttpUrl(u)).toBe(true));
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "file:///etc/passwd",
    "ftp://a.invalid/",
    "/relative",
    "//a.invalid/",
    "",
    `https://a.invalid/${"x".repeat(2048)}`,
  ])("refuses %s", (u) => expect(isHttpUrl(u)).toBe(false));
});

describe("tags", () => {
  it("nameKey: trim, NFKC, lowercase, collapse spaces; punctuation stays", () => {
    expect(tagNameKey("  React   19 ")).toBe("react 19");
    expect(tagNameKey("Ｃ＃")).toBe("c#");
    expect(tagNameKey("C++")).not.toBe(tagNameKey("C#"));
  });

  it("dedupes by nameKey, first spelling wins, limit checked after the dedupe", () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => `t${i}`);
    expect(dedupeTags([...fifteen, "T0", "t1 "]).issues).toEqual([]);
    expect(dedupeTags(["React", "react", "REACT"]).tags).toEqual([{ name: "React", nameKey: "react" }]);
    expect(dedupeTags([...fifteen, "t15"]).issues).toHaveLength(1);
    expect(dedupeTags(["", "x".repeat(51)]).issues).toHaveLength(2);
  });
});

describe("links", () => {
  it("http(s) only, known types, at most 10, label within the limit", () => {
    expect(checkLinks([{ url: "https://a.invalid/", type: "demo", label: "Demo" }])).toEqual([]);
    expect(checkLinks([{ url: "javascript:alert(1)" }])).toHaveLength(1);
    expect(checkLinks([{ url: "https://a.invalid/", type: "evil" }])).toHaveLength(1);
    expect(checkLinks([{ url: "https://a.invalid/", label: "x".repeat(101) }])).toHaveLength(1);
    expect(checkLinks(Array.from({ length: 11 }, () => ({ url: "https://a.invalid/" })))).toHaveLength(1);
  });

  it("the zod link schema (create and the Supabase update) refuses javascript: too", () => {
    expect(projectLinkSchema.safeParse({ type: "demo", url: "javascript:alert(1)" }).success).toBe(false);
    expect(projectLinkSchema.safeParse({ type: "demo", url: "https://a.invalid/" }).success).toBe(true);
  });
});

describe("categoryData", () => {
  it("strict keys for Convex, lenient for Supabase; types and url fields checked either way", () => {
    expect(checkCategoryData("web", { notAField: "x" }, null, { strictKeys: true })).toHaveLength(1);
    expect(checkCategoryData("web", { notAField: "x" }, null, { strictKeys: false })).toEqual([]);
    expect(checkCategoryData("web", { techStack: "react" }, null, { strictKeys: false })).toHaveLength(1);
    expect(checkCategoryData("mobile", { appStoreUrl: "javascript:alert(1)" }, null, { strictKeys: false })).toHaveLength(1);
    expect(checkCategoryData("mobile", { appStoreUrl: "https://apps.invalid/x" }, null, { strictKeys: true })).toEqual([]);
    expect(checkCategoryData("web", { techStack: ["react"], targetAudience: "devs" }, ["techStack", "targetAudience"], { strictKeys: true })).toEqual([]);
  });

  it("size cap, list length, per-field maxLength, field order", () => {
    expect(checkCategoryData("web", { notes: "x".repeat(MAX_CATEGORY_DATA_CHARS) }, null, { strictKeys: false })).toHaveLength(1);
    expect(checkCategoryData("web", { techStack: Array.from({ length: 51 }, (_, i) => `${i}`) }, null, { strictKeys: true })).toHaveLength(1);
    expect(checkCategoryData("web", { targetAudience: "x".repeat(201) }, null, { strictKeys: true })).toHaveLength(1);
    expect(checkCategoryData("web", null, ["techStack", "techStack"], { strictKeys: true })).toHaveLength(1);
    expect(checkCategoryData("web", null, ["nope"], { strictKeys: true })).toHaveLength(1);
  });

  it("the zod details schema caps the size", () => {
    expect(updateProjectSchema.safeParse({ category_data: { a: "x".repeat(MAX_CATEGORY_DATA_CHARS) } }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ field_order: Array.from({ length: 101 }, (_, i) => `f${i}`) }).success).toBe(false);
  });
});

describe("normalizeProjectPatch", () => {
  it("trims, clears empty descriptions, and checks details against the new category", () => {
    const { value, issues } = normalizeProjectPatch(
      { title: "  T  ", description: "   ", category: "mobile", categoryData: { appStoreUrl: "https://a.invalid/" } },
      "web",
    );
    expect(issues).toEqual([]);
    expect(value).toMatchObject({ title: "T", description: null, category: "mobile" });
    expect(normalizeProjectPatch({ categoryData: { appStoreUrl: "https://a.invalid/" } }, "web").issues).toHaveLength(1);
  });

  it("refuses bad title, slug and category", () => {
    const { issues } = normalizeProjectPatch({ title: "", slug: "Bad Slug", category: "nope" }, "web");
    expect(issues.map((i) => i.field).sort()).toEqual(["category", "slug", "title"]);
  });
});
