import { describe, expect, it } from "vitest";
import { validateProjectForm, type ProjectFormData } from "@/utils/formValidation";
import { MAX_PROJECT_TAGS, PROJECT_TEXT_LIMITS } from "@/constants/project-limits";

// Characterizes the current create/edit form rules. D02 reuses these as the
// baseline the Convex mutation's validation has to match.
const valid: ProjectFormData = {
  title: "Synthetic project",
  slug: "synthetic-project",
  description: "",
  category: "web",
};

describe("validateProjectForm", () => {
  it("accepts a valid project", () => {
    expect(validateProjectForm(valid)).toEqual({});
  });

  it("requires a non-blank title", () => {
    expect(validateProjectForm({ ...valid, title: "   " }).title).toBe("Title is required");
  });

  it("rejects a title over the limit", () => {
    const title = "a".repeat(PROJECT_TEXT_LIMITS.MAX_TITLE_LENGTH + 1);
    expect(validateProjectForm({ ...valid, title }).title).toMatch(/less than/);
    expect(validateProjectForm({ ...valid, title: title.slice(1) }).title).toBeUndefined();
  });

  it.each(["Upper-Case", "trailing-", "-leading", "double--dash", "spa ce", "ünicode"])(
    "rejects slug %j",
    (slug) => {
      expect(validateProjectForm({ ...valid, slug }).slug).toMatch(/lowercase letters/);
    },
  );

  it("rejects an unknown category", () => {
    const data = { ...valid, category: "not-a-category" } as unknown as ProjectFormData;
    expect(validateProjectForm(data).category).toBe("Please select a valid category");
  });

  it("rejects a description over the limit", () => {
    const description = "d".repeat(PROJECT_TEXT_LIMITS.MAX_DESCRIPTION_LENGTH + 1);
    expect(validateProjectForm({ ...valid, description }).description).toMatch(/less than/);
  });

  it("allows exactly the tag limit and rejects one more", () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `tag-${i}` }));
    expect(validateProjectForm(valid, tags(MAX_PROJECT_TAGS) as never).server).toBeUndefined();
    expect(validateProjectForm(valid, tags(MAX_PROJECT_TAGS + 1) as never).server).toMatch(
      String(MAX_PROJECT_TAGS),
    );
  });
});
