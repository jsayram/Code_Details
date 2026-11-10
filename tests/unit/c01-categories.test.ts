import { describe, expect, it } from "vitest";
import { PROJECT_CATEGORIES } from "@/constants/project-categories";
import { CATEGORY_FIELDS, COMMON_FIELDS, categoryDataFor, getCategoryFields, getCategorySpecificFields } from "@/constants/project-category-fields";
import { createProjectSchema, projectQuerySchema, updateProjectSchema } from "@/types/schemas/project";
import { checkCategoryData, isKnownCategory, normalizeProjectPatch } from "@/backend/projects/project-update-rules";

// C01 (Jose, 2026-11-09): 19 categories become 22. Keys stay stable, three are
// new, three get new labels, and existing ai-ml projects keep their fields.
const NEW = ["ai-agents", "generative-ai", "libraries-frameworks"] as const;
const keys = Object.keys(PROJECT_CATEGORIES);

describe("C01 category list", () => {
  it("has 22 categories with unique labels", () => {
    expect(keys).toHaveLength(22);
    const labels = Object.values(PROJECT_CATEGORIES).map((c) => c.label);
    expect(new Set(labels).size).toBe(22);
  });

  it("has Jose's labels", () => {
    expect(PROJECT_CATEGORIES["ai-agents"].label).toBe("AI Agents & Assistants");
    expect(PROJECT_CATEGORIES["generative-ai"].label).toBe("Generative AI Apps");
    expect(PROJECT_CATEGORIES["libraries-frameworks"].label).toBe("Libraries & Frameworks");
    expect(PROJECT_CATEGORIES["ai-ml"].label).toBe("ML Models & Research");
    expect(PROJECT_CATEGORIES["automation-scripting"].label).toBe("Automation & Workflows");
    expect(PROJECT_CATEGORIES["data-engineering"].label).toBe("Data & Analytics");
  });

  it("keeps every old key", () => {
    for (const key of ["web", "mobile", "desktop", "backend", "cloud-devops", "data-engineering", "ai-ml", "dev-tools", "integration", "embedded-iot", "gaming-graphics", "security", "blockchain-web3", "ar-vr-xr", "multimedia", "automation-scripting", "database-storage", "testing-qa", "other"]) {
      expect(keys).toContain(key);
    }
  });

  it("puts the filing lines in the descriptions", () => {
    const d = (k: keyof typeof PROJECT_CATEGORIES) => PROJECT_CATEGORIES[k].description;
    expect(d("automation-scripting")).toMatch(/n8n/);
    expect(d("automation-scripting")).toMatch(/ai-agent/);
    expect(d("ai-agents")).toMatch(/file by platform and tag it/);
    expect(d("generative-ai")).toMatch(/file by platform and tag it/);
    expect(d("dev-tools")).toMatch(/Testing & QA/);
    expect(d("dev-tools")).toMatch(/Libraries & Frameworks/);
    expect(d("database-storage")).toMatch(/Data & Analytics/);
    expect(d("backend")).toMatch(/Databases & Storage/);
    expect(d("gaming-graphics")).toMatch(/Multimedia & Streaming/);
    expect(d("multimedia")).toMatch(/Gaming & Graphics/);
  });
});

describe("C01 validation accepts the same 22 keys everywhere", () => {
  it.each(keys)("%s: zod create, update and query schemas", (category) => {
    expect(createProjectSchema.shape.category.safeParse(category).success).toBe(true);
    expect(updateProjectSchema.shape.category.safeParse(category).success).toBe(true);
    expect(projectQuerySchema.shape.category.safeParse(category).success).toBe(true);
  });

  it.each(keys)("%s: the server rule (Convex create, update, search)", (category) => {
    expect(isKnownCategory(category)).toBe(true);
    expect(normalizeProjectPatch({ category }, "other").issues).toEqual([]);
  });

  it("still refuses an unknown key", () => {
    expect(createProjectSchema.shape.category.safeParse("ai").success).toBe(false);
    expect(isKnownCategory("ai")).toBe(false);
    expect(normalizeProjectPatch({ category: "ai" }, "other").issues).toEqual([{ field: "category", message: "Unknown category" }]);
  });
});

describe("C01 field sets", () => {
  it("every category has its own fields, with unique ids", () => {
    expect(Object.keys(CATEGORY_FIELDS).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const ids = getCategoryFields(key as keyof typeof PROJECT_CATEGORIES).map((f) => f.id);
      expect(new Set(ids).size, key).toBe(ids.length);
    }
  });

  it.each(NEW)("%s has at least five specific fields, each with options where needed", (key) => {
    const own = getCategorySpecificFields(key);
    expect(own.length).toBeGreaterThanOrEqual(5);
    for (const f of own) {
      expect(f.isCommon).toBe(false);
      if (f.type === "select" || f.type === "multi-select") expect(f.options?.length, f.id).toBeGreaterThan(1);
      expect(COMMON_FIELDS.some((c) => c.id === f.id)).toBe(false);
    }
  });

  it("leaves the ai-ml fields as they were, so saved data still renders", () => {
    expect(getCategorySpecificFields("ai-ml").map((f) => f.id)).toEqual(["modelType", "modelArchitecture", "trainingDataSize", "accuracy", "inferenceLatency", "deployment"]);
  });

  it("shares a few ids so a later re-filing keeps saved values", () => {
    const ids = (k: (typeof NEW)[number]) => getCategorySpecificFields(k).map((f) => f.id);
    expect(ids("ai-agents")).toContain("modelArchitecture");
    expect(ids("generative-ai")).toEqual(expect.arrayContaining(["modelArchitecture", "inferenceLatency"]));
    expect(ids("libraries-frameworks")).toEqual(expect.arrayContaining(["packageManager", "installCommand", "weeklyDownloads"]));
    // A shared id keeps its stored type.
    const ml = getCategoryFields("ai-ml").find((f) => f.id === "modelArchitecture")!;
    const gen = getCategoryFields("generative-ai").find((f) => f.id === "modelArchitecture")!;
    expect(gen.type).toBe(ml.type);
    expect(gen.label).toBe("Models Used");
  });

  it("a saved ai-ml project's data still passes the strict server check", () => {
    const data = { modelType: "generative", modelArchitecture: "GPT-4", accuracy: "F1 0.9", techStack: ["PyTorch"] };
    expect(checkCategoryData("ai-ml", data, Object.keys(data), { strictKeys: true })).toEqual([]);
  });

  it.each(NEW)("%s accepts data for its own fields and refuses another category's", (key) => {
    const own = getCategorySpecificFields(key);
    const data: Record<string, string | number | string[]> = {};
    for (const f of own) {
      data[f.id] = f.type === "multi-select" ? [f.options![0].value] : f.type === "number" ? 10 : f.type === "select" ? f.options![0].value : "value";
    }
    expect(checkCategoryData(key, data, Object.keys(data), { strictKeys: true })).toEqual([]);
    expect(checkCategoryData(key, { browserSupport: ["chrome"] }, null, { strictKeys: true })).toEqual([{ field: "category_data", message: "Unknown field for this category: browserSupport" }]);
  });

  it("categoryDataFor keeps common and shared fields and drops the rest (the save path)", () => {
    const data = { techStack: ["Node"], agentType: "mcp-server", modelArchitecture: "Claude" };
    expect(categoryDataFor("generative-ai", data)).toEqual({ techStack: ["Node"], modelArchitecture: "Claude" });
    expect(categoryDataFor("ai-agents", data)).toEqual(data);
    // What it keeps always passes the server's strict check.
    const kept = categoryDataFor("web", data);
    expect(checkCategoryData("web", kept, Object.keys(kept), { strictKeys: true })).toEqual([]);
  });
});
