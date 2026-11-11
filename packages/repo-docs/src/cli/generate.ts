// X4: one generate run. It drives the same flow the app's /api/generate-docs
// route drives and saves the result the same way, through FileDocStore. The
// crawl always goes through the engine's safe fetch (nothing here can change
// that), and every model call passes the per-run cap below first.
import fs from "node:fs";
import path from "node:path";
import { runDocumentationFlowWithProgress, type ProgressCallback, type SharedData } from "../repoScrapper/flow";
import type { LlmGuard } from "../repoScrapper/nodes";
import { generateDocSlug, isSafeDocSlug, type DocChapterInfo, type DocMeta } from "../repoScrapper/store/doc-store";
import { FileDocStore } from "../repoScrapper/store/file-doc-store";
import { DEFAULT_OUT_ROOT, UsageError, type GenerateOptions } from "./args";
import type { RunConfig } from "./config";

export type ProgressUpdate = Parameters<ProgressCallback>[0];

export type RunEvent =
  | { type: "start"; repoUrl: string; out: string; provider: string; model: string; maxLlmCalls: number }
  | ({ type: "progress" } & ProgressUpdate)
  | { type: "llm-call"; call: number; max: number }
  | { type: "done"; out: string; slug: string; files: string[]; llmCalls: number };

/** The cap was reached; the run stops without writing anything. */
export class LlmCallCapError extends Error {
  readonly max: number;

  constructor(max: number) {
    super(`Stopped: this run reached its cap of ${max} model calls (--max-llm-calls). Nothing was written.`);
    this.name = "LlmCallCapError";
    this.max = max;
  }
}

/** A model call was refused for its key (401/403); retrying would only spend more calls. */
export class LlmAuthError extends Error {
  constructor(status: number) {
    super(`Stopped: the model server refused the key (HTTP ${status}). Check the provider key in the .env file.`);
    this.name = "LlmAuthError";
  }
}

/** Where the doc goes: --out as given, or ./docs-output/<slug>. Its last part is the store's slug. */
export function outputTarget(options: GenerateOptions, cwd: string): { root: string; slug: string; dir: string } {
  const dir = options.out ?? path.join(cwd, DEFAULT_OUT_ROOT, generateDocSlug(options.owner, options.repo));
  const slug = path.basename(dir);
  if (!isSafeDocSlug(slug)) {
    throw new UsageError(`The last part of --out ("${slug}") may use only letters, digits, - and _ (up to 255)`);
  }
  if (fs.existsSync(dir)) {
    if (!fs.statSync(dir).isDirectory()) throw new UsageError(`--out ${dir} exists and is not a folder`);
    if (fs.readdirSync(dir).length > 0) throw new UsageError(`--out ${dir} is not empty; choose a new folder`);
  }
  return { root: path.dirname(dir), slug, dir };
}

export async function runGenerate(
  options: GenerateOptions,
  config: RunConfig,
  target: { root: string; slug: string; dir: string },
  emit: (event: RunEvent) => void,
): Promise<{ files: string[]; llmCalls: number }> {
  emit({ type: "start", repoUrl: options.repoUrl, out: target.dir, provider: options.provider, model: options.model, maxLlmCalls: options.maxLlmCalls });

  // The flow retries a failed step (with waits), so a refusal thrown from the
  // guard alone would linger. The first refusal also settles `stopped`, and the
  // run returns at once; the guard keeps refusing for any retry still pending.
  let stop!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => (stop = reject));
  let fatal: Error | null = null;
  let calls = 0;

  const llmGuard: LlmGuard = async () => {
    if (fatal) throw fatal;
    if (calls >= options.maxLlmCalls) {
      fatal = new LlmCallCapError(options.maxLlmCalls);
      stop(fatal);
      throw fatal;
    }
    calls += 1;
    emit({ type: "llm-call", call: calls, max: options.maxLlmCalls });
    return async (ok, _latencyMs, status) => {
      if (!ok && (status === 401 || status === 403) && !fatal) {
        fatal = new LlmAuthError(status);
        stop(fatal);
      }
    };
  };

  const shared: SharedData = {
    repo_url: options.repoUrl,
    project_name: options.repo,
    llm_provider: options.provider,
    llm_model: options.model,
    llm_api_key: config.apiKey,
    llm_base_url: config.baseUrl,
    // No retries inside the SDK: each guarded call is one HTTP request, so the
    // cap counts requests. The flow retries a failed step through the guard.
    llm_sdk_max_retries: 0,
    max_abstraction_num: options.maxChapters,
    language: options.language,
    // Only the crawler reads this, and it only calls api.github.com.
    github_token: config.githubToken,
    _llmGuard: llmGuard,
  };

  const onProgress: ProgressCallback = (update) => emit({ type: "progress", ...update });
  const flow = runDocumentationFlowWithProgress(shared, onProgress);
  flow.catch(() => undefined); // settled through the race below
  const result = await Promise.race([flow, stopped]);

  // Save exactly as the app's route does: chapters 0..n-1, the overview as -1, then the metadata.
  const store = new FileDocStore(target.root);
  const chapters: DocChapterInfo[] = [];
  for (let i = 0; i < result.generatedChapters.length; i++) {
    const chapter = result.generatedChapters[i];
    const filename = await store.saveChapter(target.slug, { order: i, title: chapter.title, content: chapter.content, abstractionsCovered: [] });
    chapters.push({ filename, title: chapter.title, order: i, abstractionsCovered: [] });
  }
  const overview = await store.saveChapter(target.slug, { order: -1, title: "Overview", content: result.generatedIndex, abstractionsCovered: [] });
  const meta: Omit<DocMeta, "projectSlug"> = {
    repoUrl: options.repoUrl,
    repoOwner: options.owner,
    repoName: options.repo,
    ...(options.branch ? { branch: options.branch } : {}),
    createdAt: new Date().toISOString(),
    chapters,
    llmProvider: options.provider,
    llmModel: options.model,
  };
  await store.saveMeta(target.slug, meta);

  const files = [...chapters.map((c) => c.filename), overview, "_meta.json"];
  emit({ type: "done", out: target.dir, slug: target.slug, files, llmCalls: calls });
  return { files, llmCalls: calls };
}
