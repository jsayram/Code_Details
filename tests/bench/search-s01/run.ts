// D09 S01: native Convex search feasibility, on a throwaway local backend.
//
//   CODEDETAILS_TEST_SLOT=3 npx tsx tests/bench/search-s01/run.ts [--out <file>]
//
// Starts the slot's pinned convex-local-backend binary on the slot's own
// ports with a separate state folder (.test-runtime/slot-<n>/convex-bench),
// so the app's test backend must be stopped first (tests/convex/down.sh). It
// deploys tests/bench/search-s01/convex, loads the synthetic corpus (the
// S00.2 fixtures plus seeded filler), runs the measurements, writes JSON and
// stops and wipes the bench backend. Synthetic data only; loopback only;
// refuses slot 0 and every port in NEVER_TEST_PORTS (slot.cjs).

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { isSearchEligible, toPublicSearchDoc } from "../../../src/backend/search/public-search-doc";
import { RELEVANCE_CASES, SEARCH_CORPUS, type RelevanceCase } from "../../fixtures/search/relevance";
import { SEARCH_VOCABULARY } from "../../fixtures/search/vocabulary";
import { buildDictionary, extendText, rewriteQuery } from "./vocab-layer";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const slotLib = require("../../support/slot.cjs");

const slot = slotLib.ACTIVE as { slot: number; convexPort: number; convexSitePort: number; runtimeDir: string; convexInstance: string };
if (slot.slot === 0) throw new Error("run the bench on your own test slot, never slot 0");
const root = path.resolve(__dirname, "../../..");
const benchDir = path.resolve(__dirname);
const state = path.resolve(root, slot.runtimeDir, "convex-bench");
const BIN = path.join(process.env.HOME!, ".cache/convex/binaries/precompiled-2026-10-22-1447815/convex-local-backend");
const url = `http://127.0.0.1:${slot.convexPort}`;
const outFlag = process.argv.indexOf("--out");
const outFile = outFlag === -1 ? path.join(state, "..", "s01-results.json") : path.resolve(process.argv[outFlag + 1]);

function portFree(port: number) {
  return spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim() === "";
}

async function startBackend() {
  for (const p of [slot.convexPort, slot.convexSitePort]) {
    if (!portFree(p)) throw new Error(`port ${p} is in use: stop the slot's app backend first (tests/convex/down.sh)`);
  }
  fs.rmSync(state, { recursive: true, force: true });
  fs.mkdirSync(path.join(state, "storage"), { recursive: true, mode: 0o700 });
  const name = `${slot.convexInstance}-bench`;
  const secret = spawnSync("openssl", ["rand", "-hex", "32"], { encoding: "utf8" }).stdout.trim();
  const key = spawnSync(BIN, ["keygen", "admin-key", "--instance-name", name, "--instance-secret", secret], { encoding: "utf8" }).stdout.trim();
  const log = fs.openSync(path.join(state, "backend.log"), "w");
  const child = spawn(
    BIN,
    [
      "--interface", "127.0.0.1", "--port", String(slot.convexPort), "--site-proxy-port", String(slot.convexSitePort),
      "--convex-origin", url, "--convex-site", `http://127.0.0.1:${slot.convexSitePort}`,
      "--instance-name", name, "--instance-secret", secret,
      "--local-storage", path.join(state, "storage"), "--disable-beacon", path.join(state, "backend.sqlite3"),
    ],
    { stdio: ["ignore", log, log] },
  );
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${url}/version`)).ok) return { child, key };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("bench backend did not start");
}

function deploy(key: string) {
  const res = spawnSync(path.join(root, "node_modules/.bin/convex"), ["deploy", "--yes", "--typecheck", "disable", "--codegen", "disable"], {
    cwd: benchDir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, CONVEX_SELF_HOSTED_URL: url, CONVEX_SELF_HOSTED_ADMIN_KEY: key } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`deploy failed:\n${res.stdout}\n${res.stderr}`);
}

// ---------------------------------------------------------------------------
// Corpus

type BenchDoc = {
  entityId: string; corpus: string; title: string; category: string; owner: string; tagNames: string[];
  searchText: string; searchTextExt: string; eligible: boolean; favorites: number; createdAt: number; updatedAt: number;
};

function fixtureDocs(): BenchDoc[] {
  return SEARCH_CORPUS.map(({ project, owner, tags }) => {
    // Ineligible projects get no projection; the bench stores them anyway,
    // flagged ineligible, to check the eligible filter as defence in depth.
    const doc = toPublicSearchDoc({ ...project, listed: true, status: "active", visibility: "public" }, owner, tags)!;
    return {
      entityId: project.id, corpus: "fixture", title: project.title, category: project.category, owner: owner?.username ?? "",
      tagNames: doc.tags.map((t) => t.name), searchText: doc.searchText, searchTextExt: extendText(doc.searchText),
      eligible: isSearchEligible(project), favorites: project.rankingFavoriteCount, createdAt: project.createdAt, updatedAt: project.updatedAt,
    };
  });
}

// Seeded filler. The word lists avoid the non-technology words the relevance
// queries use (auth, dashboard, game, engine, app, notes, ...), so filler
// competes on technology terms the way real projects would, without making
// every labeled phrase unreachable.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ADJ = ["tiny", "async", "fast", "minimal", "modular", "simple", "secure", "offline", "realtime", "typed", "lazy", "cozy", "bright", "quiet", "solid"];
const NOUN = ["ledger", "tracker", "planner", "parser", "toolkit", "library", "service", "scheduler", "uploader", "monitor", "catalog", "gallery", "wiki", "timer", "bot"];
const FILL = ["with", "for", "and", "small", "teams", "built", "using", "clean", "tests", "docs", "sync", "cache", "queue", "forms", "charts", "maps", "search", "upload", "export", "import", "config", "plugins", "themes", "metrics", "logs", "hooks", "routing", "storage", "jobs", "events"];
const CATS = ["web", "mobile", "desktop", "backend", "cloud-devops"];

function fillerDocs(n: number, seed = 42): BenchDoc[] {
  const rnd = mulberry32(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const labels = SEARCH_VOCABULARY.map((v) => v.label);
  const out: BenchDoc[] = [];
  for (let i = 0; i < n; i++) {
    const tagNames = [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(labels)))];
    const title = `${pick(ADJ)} ${pick(NOUN)} ${i}`;
    const description = Array.from({ length: 15 + Math.floor(rnd() * 15) }, () => pick(FILL)).join(" ") + ` ${tagNames[0]}`;
    const owner = `dev-${String(Math.floor(rnd() * 200)).padStart(4, "0")}`;
    const category = pick(CATS);
    const project = {
      id: `f-${i}`, slug: `f-${i}`, title, description, category, categoryData: null, fieldOrder: null,
      visibility: "public" as const, status: "active" as const, listed: rnd() > 0.05,
      favoriteCount: Math.floor(rnd() * 40), rankingFavoriteCount: Math.floor(rnd() * 35), contentVersion: 1,
      createdAt: Date.UTC(2025, 0, 1) + i * 3_600_000, updatedAt: Date.UTC(2025, 0, 1) + i * 3_600_000,
    };
    const doc = toPublicSearchDoc({ ...project, listed: true }, { username: owner, fullName: null }, tagNames.map((name) => ({ id: name, name, status: "active" as const })))!;
    out.push({
      entityId: project.id, corpus: "filler", title, category, owner, tagNames, searchText: doc.searchText,
      searchTextExt: extendText(doc.searchText), eligible: project.listed, favorites: project.rankingFavoriteCount,
      createdAt: project.createdAt, updatedAt: project.updatedAt,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Measurements

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10 : 0;
};

type CaseResult = {
  id: string; kind: string; query: string; sent: string; ids: string[];
  strongAt10: number; strongTotal: number; mrr: number; forbiddenHits: string[]; pass: boolean;
  corrected?: { from: string; to: string }[];
};

async function runCase(client: ConvexHttpClient, index: "raw" | "ext", r: RelevanceCase, dict: Set<string>, ineligible: Set<string>): Promise<CaseResult> {
  const rw = index === "ext" ? rewriteQuery(r.query, dict) : { q: r.query, corrected: [], expanded: [] };
  let ids: string[];
  if (r.query.trim() === "") {
    // Browsing: no search index. Tags (AND) and category on the sorted list.
    const page = await client.query(anyApi.bench.browse, { category: r.filters?.category, paginationOpts: { numItems: 1024, cursor: null } });
    const all = new Map(fixtureDocs().map((d) => [d.entityId, d]));
    ids = (page.ids as string[]).filter((id) => {
      const d = all.get(id);
      return !r.filters?.tags || (d && r.filters.tags.every((t) => d.tagNames.includes(t)));
    }).slice(0, 48);
  } else {
    const res = await client.query(anyApi.bench.search, {
      index, q: rw.q, category: r.filters?.category, owner: r.scope?.handle, tags: r.filters?.tags, limit: 48,
    });
    ids = res.ids;
  }
  const top10 = ids.slice(0, 10);
  const strongAt10 = r.strong.filter((id) => top10.includes(id)).length;
  const firstStrong = ids.findIndex((id) => r.strong.includes(id));
  const forbidden = new Set([...(r.forbidden ?? []), ...ineligible]);
  const forbiddenHits = ids.filter((id) => forbidden.has(id));
  const fixtureHits = ids.filter((id) => !id.startsWith("f-"));
  const noResultsOk = r.kind !== "no-results" || fixtureHits.length === 0;
  return {
    id: r.id, kind: r.kind, query: r.query, sent: rw.q, ids: ids.slice(0, 10), strongAt10, strongTotal: r.strong.length,
    mrr: firstStrong === -1 ? 0 : 1 / (firstStrong + 1), forbiddenHits,
    pass: strongAt10 === r.strong.length && forbiddenHits.length === 0 && noResultsOk,
    ...(rw.corrected.length ? { corrected: rw.corrected } : {}),
  };
}

let nonce = 0;
/** Times fn(nonce): `cached` repeats one nonce (Convex's query cache answers), `uncached` uses a fresh one each call. */
async function timeQuery(fn: (nonce?: number) => Promise<unknown>, runs: number) {
  const cached: number[] = [];
  const uncached: number[] = [];
  await fn(); await fn();
  for (let i = 0; i < runs; i++) {
    let t = performance.now();
    await fn();
    cached.push(performance.now() - t);
    t = performance.now();
    await fn(++nonce);
    uncached.push(performance.now() - t);
  }
  return { cached, uncached };
}

async function load(client: ConvexHttpClient, docs: BenchDoc[]) {
  for (;;) if ((await client.mutation(anyApi.bench.clear, {})) === 0) break;
  for (let i = 0; i < docs.length; i += 200) await client.mutation(anyApi.bench.load, { docs: docs.slice(i, i + 200) });
}

async function main() {
  const { child, key } = await startBackend();
  const results: Record<string, unknown> = {
    convexBackend: "precompiled-2026-10-22-1447815",
    convexNpm: JSON.parse(fs.readFileSync(path.join(root, "node_modules/convex/package.json"), "utf8")).version,
    ranAt: new Date().toISOString(),
    loadAverage: spawnSync("uptime", { encoding: "utf8" }).stdout.trim(),
  };
  try {
    deploy(key);
    const client = new ConvexHttpClient(url);
    const fixtures = fixtureDocs();
    const ineligible = new Set(fixtures.filter((d) => !d.eligible).map((d) => d.entityId));

    for (const size of [0, 1000, 10000]) {
      const filler = fillerDocs(size);
      const docs = [...fixtures, ...filler];
      const t0 = performance.now();
      await load(client, docs);
      const loadMs = Math.round(performance.now() - t0);
      const dict = buildDictionary(docs.flatMap((d) => [d.title, ...d.tagNames, d.searchText]));
      const variant: Record<string, unknown> = { docs: docs.length, loadMs };
      variant.textBytes = {
        searchText: docs.reduce((n, d) => n + Buffer.byteLength(d.searchText), 0),
        searchTextExt: docs.reduce((n, d) => n + Buffer.byteLength(d.searchTextExt), 0),
      };
      for (const index of ["raw", "ext"] as const) {
        const cases: CaseResult[] = [];
        for (const r of RELEVANCE_CASES) cases.push(await runCase(client, index, r, dict, ineligible));
        const latency: number[] = [];
        const cachedLatency: number[] = [];
        const perCase: Record<string, number> = {};
        for (const r of RELEVANCE_CASES.filter((c) => c.query)) {
          const q = index === "ext" ? rewriteQuery(r.query, dict).q : r.query;
          const t = await timeQuery((n) => client.query(anyApi.bench.search, { index, q, category: r.filters?.category, owner: r.scope?.handle, tags: r.filters?.tags, limit: 48, ...(n ? { nonce: n } : {}) }), 10);
          latency.push(...t.uncached);
          cachedLatency.push(...t.cached);
          perCase[r.id] = pct(t.uncached, 50);
        }
        variant[index] = {
          passed: cases.filter((c) => c.pass).length,
          of: cases.length,
          meanMrr: Math.round((cases.filter((c) => c.strongTotal).reduce((n, c) => n + c.mrr, 0) / cases.filter((c) => c.strongTotal).length) * 1000) / 1000,
          forbiddenHitCases: cases.filter((c) => c.forbiddenHits.length).map((c) => `${c.id}:${c.forbiddenHits.join(",")}`),
          failed: cases.filter((c) => !c.pass).map((c) => ({ id: c.id, kind: c.kind, query: c.query, sent: c.sent, strong: `${c.strongAt10}/${c.strongTotal}`, forbidden: c.forbiddenHits, top: c.ids.slice(0, 5), corrected: c.corrected })),
          latencyMs: { p50: pct(latency, 50), p95: pct(latency, 95), p99: pct(latency, 99), n: latency.length },
          cachedLatencyMs: { p50: pct(cachedLatency, 50), p95: pct(cachedLatency, 95) },
          perCaseUncachedP50Ms: perCase,
        };
      }
      if (size === 10000) {
        // Facets and non-relevance sorts over a broad query: what one search can see.
        const broad = await client.query(anyApi.bench.searchAll, { index: "ext", q: rewriteQuery("typescript", dict).q });
        const trueCount = docs.filter((d) => d.eligible && d.searchTextExt.includes("zztypescriptzz")).length;
        variant.broadQuery = { query: "typescript", reachable: broad.count, truncated: broad.truncated, trueMatches: trueCount, categoryFacet: broad.category };
        const facetMs = await timeQuery((n) => client.query(anyApi.bench.searchAll, { index: "ext", q: rewriteQuery("typescript", dict).q, ...(n ? { nonce: n } : {}) }), 10);
        variant.broadQueryLatencyMs = { uncachedP50: pct(facetMs.uncached, 50), uncachedP95: pct(facetMs.uncached, 95), cachedP50: pct(facetMs.cached, 50) };
        // Past the 1024-result scan limit: a word most filler descriptions contain.
        const huge = await client.query(anyApi.bench.searchAll, { index: "raw", q: "with" });
        const hugeTrue = docs.filter((d) => d.eligible && /\bwith\b/i.test(d.searchText)).length;
        const hugeMs = await timeQuery((n) => client.query(anyApi.bench.searchAll, { index: "raw", q: "with", ...(n ? { nonce: n } : {}) }), 5);
        const hugeSeen: string[] = [];
        let hc: string | null = null;
        let hDone = false;
        let hPages = 0;
        let hError: string | null = null;
        try {
          while (!hDone && hPages < 300) {
            const pg: { ids: string[]; continueCursor: string; isDone: boolean } = await client.query(anyApi.bench.searchPage, { index: "raw", q: "with", paginationOpts: { numItems: 48, cursor: hc } });
            hugeSeen.push(...pg.ids);
            hc = pg.continueCursor;
            hDone = pg.isDone;
            hPages++;
          }
        } catch (e) {
          hError = String(e).slice(0, 300);
        }
        variant.overScanLimit = {
          query: "with", trueMatches: hugeTrue, searchAllReachable: huge.count, searchAllTruncated: huge.truncated,
          uncachedP50Ms: pct(hugeMs.uncached, 50), uncachedP95Ms: pct(hugeMs.uncached, 95),
          paginated: { pages: hPages, returned: hugeSeen.length, unique: new Set(hugeSeen).size, isDone: hDone, error: hError },
        };
        // Cursor paging at 48 over the broad query, with a write between pages.
        const seen: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        let isDone = false;
        while (!isDone && pages < 40) {
          const pg: { ids: string[]; continueCursor: string; isDone: boolean } = await client.query(anyApi.bench.searchPage, { index: "ext", q: rewriteQuery("typescript", dict).q, paginationOpts: { numItems: 48, cursor } });
          seen.push(...pg.ids);
          cursor = pg.continueCursor;
          isDone = pg.isDone;
          pages++;
          if (pages === 1) {
            await client.mutation(anyApi.bench.load, { docs: [{ ...fixtures[0], entityId: "inserted-mid-paging", searchText: "TypeScript TypeScript TypeScript", searchTextExt: extendText("TypeScript TypeScript TypeScript"), createdAt: Date.now(), updatedAt: Date.now() }] });
          }
        }
        variant.paging = { pageSize: 48, pages, returned: seen.length, unique: new Set(seen).size, isDone, insertedMidPagingSeen: seen.includes("inserted-mid-paging") };
        const browseSeen: string[] = [];
        let bc: string | null = null;
        let bDone = false;
        let bPages = 0;
        while (!bDone && bPages < 400) {
          const pg: { ids: string[]; continueCursor: string; isDone: boolean } = await client.query(anyApi.bench.browse, { paginationOpts: { numItems: 48, cursor: bc } });
          browseSeen.push(...pg.ids);
          bc = pg.continueCursor;
          bDone = pg.isDone;
          bPages++;
        }
        variant.browsePaging = { pageSize: 48, pages: bPages, returned: browseSeen.length, unique: new Set(browseSeen).size, eligibleDocs: docs.filter((d) => d.eligible).length + 1 };
      }
      results[`size_${size}`] = variant;
    }

    // Freshness and privacy transitions, on the 10k corpus still loaded.
    const dict = buildDictionary(fixtures.flatMap((d) => [d.title, ...d.tagNames]));
    const fresh: Record<string, unknown> = {};
    const find = async (q: string) => (await client.query(anyApi.bench.search, { index: "ext", q: rewriteQuery(q, dict).q, limit: 48 })).ids as string[];
    let t = performance.now();
    await client.mutation(anyApi.bench.patch, { entityId: "p-go-proxy", searchText: "Quokka relay", searchTextExt: extendText("Quokka relay") });
    fresh.editVisibleNextQuery = (await find("quokka")).includes("p-go-proxy");
    fresh.editRoundTripMs = Math.round(performance.now() - t);
    t = performance.now();
    await client.mutation(anyApi.bench.patch, { entityId: "p-go-proxy", eligible: false });
    fresh.unpublishGoneNextQuery = !(await find("quokka")).includes("p-go-proxy");
    await client.mutation(anyApi.bench.remove, { entityId: "p-cpp-engine" });
    fresh.deleteGoneNextQuery = !(await find("c++")).includes("p-cpp-engine");
    fresh.transitionsMs = Math.round(performance.now() - t);
    results.freshness = fresh;

    // Tokenizer probe: what plain native search does with identifiers.
    await load(client, fixtures);
    const probe: Record<string, string[]> = {};
    for (const q of ["c", "c++", "c#", ".net", "net", "node.js", "nodejs", "next", "kubernets", "golang", "react native"]) {
      probe[q] = (await client.query(anyApi.bench.search, { index: "raw", q, limit: 10 })).ids;
    }
    results.rawTokenizerProbe = probe;
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 1000));
    fs.rmSync(state, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
