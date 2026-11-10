// C01: proposes re-filings for projects into the 22-category list. It only
// reads a JSON export of projects and prints proposals; it has no database or
// network access and writes nothing back. Applying a proposal is a data change
// on Jose's databases and needs his explicit go, project by project.
//
// Usage (Node 23+ runs the TypeScript directly):
//   node --no-warnings scripts/c01-refile/propose.ts <projects.json> [--json]
// The input is an array of { slug, title, description?, category, tags?,
// categoryData? }. Output: a Markdown table (or JSON with --json) of the
// projects whose category the rules would change, plus the ones to review by
// hand, each with the words that decided it.
//
// The rules follow Jose's filing rule: file by how it's built, then by what it
// does. AI at the core goes in an AI category whatever the platform; AI as one
// feature stays on its platform with a tag; anything built in an automation
// platform (n8n, Zapier, Make, Power Automate) goes in Automation & Workflows
// with an `ai-agent` tag suggestion.
import fs from "node:fs";
import path from "node:path";

export interface RefileInput {
  slug: string;
  title: string;
  description?: string | null;
  category: string;
  tags?: string[];
  categoryData?: Record<string, unknown> | null;
}

export interface RefileProposal {
  slug: string;
  title: string;
  from: string;
  to: string;
  /** "propose" when one signal group clearly wins, "review" when it's close or the move is from a platform category. */
  confidence: "propose" | "review";
  addTags: string[];
  because: string[];
}

const SIGNALS = {
  automationPlatform: [/\bn8n\b/, /\bzapier\b/, /\bmake\.com\b/, /\bpower automate\b/, /\bpower-automate\b/, /\bifttt\b/],
  agents: [/\bagents?\b/, /\bagentic\b/, /\bassistants?\b/, /\bchat ?bots?\b/, /\bcopilot\b/, /\bmcp\b/, /model context protocol/, /\blanggraph\b/, /\bcrewai\b/, /\bautogen\b/, /tool[- ]calling/, /function[- ]calling/, /coding assistant/],
  generative: [/\brag\b/, /retrieval[- ]augmented/, /\bllms?\b/, /\bgpt[- ]?\d?\b/, /\bclaude\b/, /\bgemini\b/, /\bopenai\b/, /generat(e|es|ed|ing|ive|or)\b/, /stable diffusion/, /text[- ]to[- ](speech|image|video)/, /\bembeddings?\b/, /vector (store|db|database)/, /\bprompts?\b/, /summari[sz]/],
  models: [/\btrain(ing|ed)?\b/, /fine[- ]?tun/, /\bdatasets?\b/, /classif(y|ier|ication)/, /regression/, /computer vision/, /object detection/, /segmentation/, /\bbenchmark/, /\bevaluation/, /\bpytorch\b/, /\btensorflow\b/, /\bkeras\b/, /scikit/, /neural network/, /\bcnn\b/, /\blstm\b/, /speech recognition/],
  library: [/\blibrary\b/, /\bsdk\b/, /\bframework\b/, /npm package/, /\bpypi\b/, /\bcrates?\.io\b/, /npm (i|install) (?!-g)/, /pip install/, /\bwrapper\b/, /api client/, /component library/],
} as const;

type Group = keyof typeof SIGNALS;

function textOf(p: RefileInput): string {
  const data = Object.values(p.categoryData ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v])).map(String);
  return [p.title, p.description ?? "", ...(p.tags ?? []), ...data].join(" \n ").toLowerCase();
}

function hits(text: string, group: Group): string[] {
  const out: string[] = [];
  for (const re of SIGNALS[group]) {
    const m = text.match(re);
    if (m) out.push(m[0].trim());
  }
  return [...new Set(out)];
}

/** The proposal for one project, or null when the rules keep its category. */
export function proposeOne(p: RefileInput): RefileProposal | null {
  const text = textOf(p);
  const h = Object.fromEntries((Object.keys(SIGNALS) as Group[]).map((g) => [g, hits(text, g)])) as Record<Group, string[]>;
  const tags = new Set((p.tags ?? []).map((t) => t.toLowerCase()));
  const make = (to: string, confidence: RefileProposal["confidence"], because: string[], addTags: string[] = []): RefileProposal | null =>
    to === p.category ? null : { slug: p.slug, title: p.title, from: p.category, to, confidence, addTags: addTags.filter((t) => !tags.has(t)), because };

  // Built in an automation platform: Automation & Workflows, whatever else it does.
  if (h.automationPlatform.length) {
    const ai = h.agents.length + h.generative.length > 0;
    return make("automation-scripting", "propose", h.automationPlatform, ai ? ["ai-agent"] : []);
  }

  if (p.category === "ai-ml") {
    // ai-ml's old "Generative AI" model type is a strong hint on its own.
    const genHint = p.categoryData?.modelType === "generative" ? ["model type: generative"] : [];
    const score = { agents: h.agents.length * 2, generative: h.generative.length + genHint.length * 2, models: h.models.length };
    const ranked = (Object.entries(score) as [keyof typeof score, number][]).sort((a, b) => b[1] - a[1]);
    const [[top, best], [, second]] = ranked;
    if (best === 0 || top === "models") return null;
    const to = top === "agents" ? "ai-agents" : "generative-ai";
    const because = top === "agents" ? h.agents : [...genHint, ...h.generative];
    return make(to, best >= second + 2 ? "propose" : "review", because);
  }

  if (p.category === "dev-tools" || p.category === "other") {
    const typeHint = p.categoryData?.toolType === "library" ? ["tool type: library/SDK"] : [];
    const lib = [...typeHint, ...h.library];
    if (lib.length >= 2 || typeHint.length) return make("libraries-frameworks", typeHint.length ? "propose" : "review", lib);
  }

  // AI at the core of a project filed on a platform: only ever "review",
  // because AI as one feature stays on its platform with a tag.
  if (["web", "mobile", "desktop", "backend", "other"].includes(p.category)) {
    if (h.agents.length >= 2) return make("ai-agents", "review", h.agents, []);
    if (h.generative.length >= 3) return make("generative-ai", "review", h.generative, []);
  }
  return null;
}

export function proposeRefiling(projects: RefileInput[]): RefileProposal[] {
  return projects.map(proposeOne).filter((x): x is RefileProposal => x !== null);
}

export function toMarkdown(proposals: RefileProposal[], total: number): string {
  const rows = proposals.map((r) => `| ${r.slug} | ${r.from} | ${r.to} | ${r.confidence} | ${r.addTags.join(", ")} | ${r.because.join(", ").replace(/\|/g, "\\|")} |`);
  return [
    `Re-filing proposals (dry run, nothing written): ${proposals.length} of ${total} projects.`,
    "",
    "| Project | From | To | Confidence | Add tags | Because |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

if (process.argv[1] && path.basename(process.argv[1]) === "propose.ts") {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/c01-refile/propose.ts <projects.json> [--json]");
    process.exit(2);
  }
  const projects = JSON.parse(fs.readFileSync(file, "utf8")) as RefileInput[];
  const proposals = proposeRefiling(projects);
  console.log(process.argv.includes("--json") ? JSON.stringify(proposals, null, 2) : toMarkdown(proposals, projects.length));
}
