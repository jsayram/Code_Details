import { describe, expect, it } from "vitest";
import { proposeOne, proposeRefiling, toMarkdown } from "../../scripts/c01-refile/propose";

const p = (over: Partial<Parameters<typeof proposeOne>[0]>) => ({ slug: "s", title: "T", description: "", category: "ai-ml", tags: [], categoryData: null, ...over });

describe("C01 re-filing proposals (dry run)", () => {
  it("keeps model work in ML Models & Research", () => {
    expect(proposeOne(p({ title: "Plant disease classifier", description: "Training a CNN on a leaf dataset with PyTorch" }))).toBeNull();
  });

  it("moves an agent out of ai-ml", () => {
    expect(proposeOne(p({ title: "Repo helper", description: "A coding assistant agent with tool-calling and an MCP server" }))).toMatchObject({ to: "ai-agents", confidence: "propose" });
  });

  it("moves a RAG app out of ai-ml, and uses the old Generative model type", () => {
    expect(proposeOne(p({ title: "Docs Q&A", description: "RAG over our docs with embeddings and an LLM" }))).toMatchObject({ to: "generative-ai" });
    expect(proposeOne(p({ title: "Poster maker", categoryData: { modelType: "generative" } }))).toMatchObject({ to: "generative-ai", because: expect.arrayContaining(["model type: generative"]) });
  });

  it("sends anything built in n8n or Zapier to Automation & Workflows, with an ai-agent tag when it has AI", () => {
    expect(proposeOne(p({ category: "ai-ml", title: "Lead bot", description: "An n8n workflow with an LLM agent step" }))).toMatchObject({ to: "automation-scripting", addTags: ["ai-agent"] });
    expect(proposeOne(p({ category: "web", title: "Sheet sync", description: "Zapier flow that copies rows" }))).toMatchObject({ to: "automation-scripting", addTags: [] });
    expect(proposeOne(p({ category: "automation-scripting", title: "Make.com flow with GPT", tags: ["ai-agent"] }))).toBeNull();
  });

  it("proposes Libraries & Frameworks for a dev-tools library", () => {
    expect(proposeOne(p({ category: "dev-tools", title: "Date utils", categoryData: { toolType: "library" } }))).toMatchObject({ to: "libraries-frameworks", confidence: "propose" });
    expect(proposeOne(p({ category: "dev-tools", title: "Lint CLI", description: "A command-line linter, npm install -g lintx" }))).toBeNull();
  });

  it("only asks for review when a platform project has AI in it", () => {
    expect(proposeOne(p({ category: "web", title: "Shop", description: "A store with an AI chatbot assistant agent" }))).toMatchObject({ to: "ai-agents", confidence: "review" });
    expect(proposeOne(p({ category: "web", title: "Blog", description: "Posts with an LLM summary" }))).toBeNull();
  });

  it("prints a table and never proposes a no-op", () => {
    const out = proposeRefiling([p({ title: "Agent", description: "assistant agent with MCP" }), p({ category: "web", title: "Site" })]);
    expect(out).toHaveLength(1);
    expect(toMarkdown(out, 2)).toContain("| s | ai-ml | ai-agents | propose |");
  });
});
