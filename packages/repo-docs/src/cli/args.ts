// X4: the command line, parsed with node:util parseArgs. Every value is
// checked here, before any file is read or any request is made; a bad one is a
// UsageError (exit code 2).
import path from "node:path";
import { parseArgs } from "node:util";
import { getProvider, LLM_PROVIDERS } from "../llm/providers";
import { parseGitHubUrl } from "../repoScrapper/crawler";

export const DEFAULT_PROVIDER = "openai";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_MAX_CHAPTERS = 8;
export const DEFAULT_MAX_LLM_CALLS = 40;
export const DEFAULT_LANGUAGE = "english";
export const DEFAULT_OUT_ROOT = "docs-output";

const LIMITS = { maxChapters: [1, 20], maxLlmCalls: [1, 500] } as const;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface GenerateOptions {
  repoUrl: string;
  owner: string;
  repo: string;
  branch?: string;
  /** The doc's own folder (absolute); `null` means ./docs-output/<slug>. */
  out: string | null;
  provider: string;
  model: string;
  maxChapters: number;
  maxLlmCalls: number;
  language: string;
  baseUrl?: string;
  allowLoopbackLlm: boolean;
  envFile?: string;
  json: boolean;
  verbose: boolean;
}

export type ParsedCommand = { kind: "help" } | { kind: "version" } | { kind: "generate"; options: GenerateOptions };

export const USAGE = `Usage: repo-docs generate <github-url> [options]

Crawls a public (or token-readable) GitHub repository and writes chaptered
Markdown docs with an LLM. No account, database or web server needed.

Options:
  --out <dir>             Folder for this doc (default ./docs-output/<slug>).
                          Its last part must use only letters, digits, - and _.
  --provider <id>         ${LLM_PROVIDERS.map((p) => p.id).join(", ")} (default ${DEFAULT_PROVIDER})
  --model <id>            Model id (default ${DEFAULT_OPENAI_MODEL} for openai, else the provider's first)
  --max-chapters <n>      Chapters to write, ${LIMITS.maxChapters[0]}-${LIMITS.maxChapters[1]} (default ${DEFAULT_MAX_CHAPTERS})
  --max-llm-calls <n>     Stop after this many model HTTP requests (the SDK doesn't
                          retry; each try counts), ${LIMITS.maxLlmCalls[0]}-${LIMITS.maxLlmCalls[1]} (default ${DEFAULT_MAX_LLM_CALLS})
  --language <name>       Language to write in (default ${DEFAULT_LANGUAGE})
  --base-url <url>        Custom model server for an OpenAI-compatible provider.
                          Must be on REPO_DOCS_LLM_BASE_URL_ALLOWLIST, or loopback
                          with --allow-loopback-llm
  --allow-loopback-llm    Allow a model server on 127.0.0.1, ::1 or localhost: a
                          loopback --base-url, or a local provider such as ollama
  --env-file <path>       Settings file (default packages/repo-docs/.env, then ./.env)
  --json                  Print one JSON object per event on stdout
  --verbose               Also print the engine's own log lines (on stderr)
  -h, --help              Show this help
  --version               Show the version

Exit codes: 0 done, 1 the run failed or hit the call cap, 2 bad arguments or settings.`;

function intOption(name: string, raw: string | undefined, fallback: number, [min, max]: readonly [number, number]): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`);
  const value = Number(raw);
  if (value < min || value > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`);
  return value;
}

/** Parses argv (without node and the script). Throws UsageError on anything wrong. */
export function parseCommand(argv: string[], cwd: string): ParsedCommand {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        out: { type: "string" },
        provider: { type: "string" },
        model: { type: "string" },
        "max-chapters": { type: "string" },
        "max-llm-calls": { type: "string" },
        language: { type: "string" },
        "base-url": { type: "string" },
        "allow-loopback-llm": { type: "boolean" },
        "env-file": { type: "string" },
        json: { type: "boolean" },
        verbose: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
    });
  } catch (error) {
    // parseArgs' own messages name the option, never a value worth hiding.
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };

  const [command, repoUrl, ...extra] = positionals;
  if (!command) throw new UsageError("Missing command. Try: repo-docs generate <github-url>");
  if (command !== "generate") throw new UsageError(`Unknown command "${command}". The only command is "generate".`);
  if (!repoUrl) throw new UsageError("Missing the GitHub repository URL");
  if (extra.length) throw new UsageError(`Unexpected argument "${extra[0]}"`);

  const parsedUrl = parseGitHubUrl(repoUrl);
  if (!parsedUrl) throw new UsageError("That is not a GitHub repository URL (expected https://github.com/owner/repo or owner/repo)");

  const provider = values.provider ?? DEFAULT_PROVIDER;
  const providerConfig = getProvider(provider);
  if (!providerConfig) {
    throw new UsageError(`Unknown --provider "${provider}". Choose one of: ${LLM_PROVIDERS.map((p) => p.id).join(", ")}`);
  }

  const model = values.model ?? (provider === DEFAULT_PROVIDER ? DEFAULT_OPENAI_MODEL : providerConfig.models[0]?.id);
  if (!model || !/^[\w.:/@-]{1,120}$/.test(model) || model.includes("..") || model.startsWith("/") || model.endsWith("/")) {
    throw new UsageError("--model must be 1-120 characters of letters, digits and . : / @ _ -, without \"..\" or a leading or trailing /");
  }

  const language = values.language ?? DEFAULT_LANGUAGE;
  if (!/^[\p{L} -]{1,40}$/u.test(language)) throw new UsageError("--language must be 1-40 letters, spaces or hyphens");

  const baseUrl = values["base-url"];
  if (baseUrl !== undefined && (provider === "anthropic" || provider === "google")) {
    throw new UsageError(`--base-url is not used by the ${provider} provider; leave it out`);
  }

  let out: string | null = null;
  if (values.out !== undefined) {
    if (!values.out.trim()) throw new UsageError("--out must not be empty");
    out = path.resolve(cwd, values.out);
  }

  return {
    kind: "generate",
    options: {
      repoUrl,
      owner: parsedUrl.owner,
      repo: parsedUrl.repo,
      branch: parsedUrl.branch,
      out,
      provider,
      model,
      maxChapters: intOption("max-chapters", values["max-chapters"], DEFAULT_MAX_CHAPTERS, LIMITS.maxChapters),
      maxLlmCalls: intOption("max-llm-calls", values["max-llm-calls"], DEFAULT_MAX_LLM_CALLS, LIMITS.maxLlmCalls),
      language,
      baseUrl,
      allowLoopbackLlm: values["allow-loopback-llm"] ?? false,
      envFile: values["env-file"] === undefined ? undefined : path.resolve(cwd, values["env-file"]),
      json: values.json ?? false,
      verbose: values.verbose ?? false,
    },
  };
}
