// X3: no server-only engine code in the browser bundle. Run after
// `npm run build:isolated`: `npm run test:bundle` (or pass another dist dir).
// Reads each scraper page's client chunks from its client reference manifest,
// then every client chunk in the build, and exits 1 on any marker below.
// UI09 found /github-scrapper answering 500 once a client page pulled in the
// server crawler; the `repo-docs` server entries are closed to browser
// bundles, and this checks the result in the real build output.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.resolve(root, process.argv[2] ?? ".next-test");

// Code or identifiers that only the server side of the engine or the app has.
const MARKERS = [
  "node:dns", "node:fs", "node:https", "node:net",
  "guardedLookup", "isPublicAddress", "UnsafeUrlError", "serverGithubCrawler",
  "api.github.com/repos", "GITHUB_TOKEN", "FileDocStore", "llmUsage:reserve", "pocketflow",
  // Provider SDKs (OpenAI, Anthropic, Google).
  "dangerouslyAllowBrowser", "OpenAI-Organization", "anthropic-version", "generativelanguage",
  // The repo-docs CLI (X4).
  "REPO_DOCS_LLM_BASE_URL_ALLOWLIST", "allow-loopback-llm", "LlmCallCapError",
];
// Reported, not failed: env var names in the provider list LLMProviderSelector shows (no values).
const INFO = ["OPENAI_API_KEY"];

const PAGES = {
  "/github-scrapper": "(sidebar-footer)/github-scrapper",
  "/github-scrapper/my-docs": "(sidebar-footer)/github-scrapper/my-docs",
  "/github-scrapper/docs/[slug]/[[...chapter]]": "(sidebar-footer)/github-scrapper/docs/[slug]/[[...chapter]]",
  "/scrapper-demo": "(administrator)/scrapper-demo",
  "/llm-test": "(administrator)/llm-test",
};

const chunksDir = path.join(dist, "static/chunks");
if (!fs.existsSync(chunksDir)) {
  console.error(`no build at ${path.relative(root, dist)}; run npm run build:isolated first`);
  process.exit(2);
}
const read = (rel) => fs.readFileSync(path.join(dist, rel), "utf8");
const markersIn = (text) => MARKERS.filter((m) => text.includes(m));

let failures = 0;
for (const [page, dir] of Object.entries(PAGES)) {
  const manifest = path.join("server/app", dir, "page_client-reference-manifest.js");
  if (!fs.existsSync(path.join(dist, manifest))) {
    console.error(`${page}: no client reference manifest (${manifest})`);
    failures++;
    continue;
  }
  const chunks = [...new Set([...read(manifest).matchAll(/static\/chunks\/[A-Za-z0-9._~-]+\.js/g)].map((m) => m[0]))];
  if (chunks.length === 0) {
    console.error(`${page}: the manifest lists no client chunks`);
    failures++;
    continue;
  }
  const hits = chunks.flatMap((c) => markersIn(read(c)).map((m) => `${c}: ${m}`));
  failures += hits.length;
  console.log(`${page}: ${chunks.length} client chunks, ${hits.length ? `FOUND ${hits.join(", ")}` : "none of the markers"}`);
}

const all = fs.readdirSync(chunksDir, { recursive: true }).map(String).filter((f) => f.endsWith(".js"));
const allHits = all.flatMap((f) => markersIn(fs.readFileSync(path.join(chunksDir, f), "utf8")).map((m) => `${f}: ${m}`));
failures += allHits.length;
console.log(`all ${all.length} client chunks: ${allHits.length ? `FOUND ${allHits.join(", ")}` : "none of the markers"}`);
for (const m of INFO) {
  const n = all.filter((f) => fs.readFileSync(path.join(chunksDir, f), "utf8").includes(m)).length;
  console.log(`info: "${m}" in ${n} client chunk(s) (provider list env var names, no values)`);
}
console.log(`markers: ${MARKERS.join(", ")}`);
process.exit(failures ? 1 : 0);
