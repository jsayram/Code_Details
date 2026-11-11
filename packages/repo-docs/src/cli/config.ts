// X4: the CLI's settings. Keys come from one .env file (read with
// node:util parseEnv, never loaded into process.env, so the engine's own
// process.env fallbacks and any child process can't see them) or from
// variables already set in the shell. No value read here is ever printed:
// errors name the setting, and Redactor scrubs every secret from output.
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { getProvider } from "../llm/providers";
import { UsageError, type GenerateOptions } from "./args";

/** Every setting the CLI reads. The provider keys are the engine's ENV_KEYS names. */
export const SETTING_NAMES = [
  "GITHUB_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "REPO_DOCS_LLM_BASE_URL_ALLOWLIST",
] as const;
export type SettingName = (typeof SETTING_NAMES)[number];
export type Settings = Partial<Record<SettingName, string>>;

const SECRET_NAMES: SettingName[] = SETTING_NAMES.filter((n) => /_(API_KEY|TOKEN)$/.test(n));

/** Every key and token among the settings, used or not. */
export function secretValues(settings: Settings): string[] {
  return SECRET_NAMES.map((n) => settings[n]).filter((v): v is string => Boolean(v));
}

export interface LoadedSettings {
  settings: Settings;
  /** The file the settings came from, or null when only the shell's variables were used. */
  file: string | null;
}

/**
 * Reads the first settings file that exists: --env-file (which must exist),
 * then <package>/.env, then <cwd>/.env. Shell variables win over the file.
 */
export function loadSettings(opts: { envFile?: string; packageDir: string; cwd: string; env: NodeJS.ProcessEnv }): LoadedSettings {
  let file: string | null = null;
  if (opts.envFile) {
    if (!fs.existsSync(opts.envFile)) throw new UsageError(`Settings file not found: ${opts.envFile}`);
    file = opts.envFile;
  } else {
    file = [path.join(opts.packageDir, ".env"), path.join(opts.cwd, ".env")].find((p) => fs.existsSync(p)) ?? null;
  }
  let fromFile: NodeJS.Dict<string> = {};
  if (file) {
    try {
      fromFile = parseEnv(fs.readFileSync(file, "utf8"));
    } catch {
      // The parser's message could quote a line of the file; keep it out.
      throw new UsageError(`Could not read the settings file ${file}`);
    }
  }
  const settings: Settings = {};
  for (const name of SETTING_NAMES) {
    const value = opts.env[name] || fromFile[name];
    if (value && value.trim()) settings[name] = value.trim();
  }
  return { settings, file };
}

/** The provider key the run needs (the provider's ENV_KEYS name), or undefined for a local provider. */
export function providerKeyName(providerId: string): SettingName | undefined {
  const provider = getProvider(providerId);
  if (!provider || provider.isLocal || !provider.requiresApiKey) return undefined;
  const name = provider.envVarNames[0];
  return (SETTING_NAMES as readonly string[]).includes(name) ? (name as SettingName) : undefined;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function allowlistedOrigins(raw: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    try {
      const url = new URL(entry.trim());
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) origins.add(url.origin);
    } catch {
      /* a bad entry allows nothing */
    }
  }
  return origins;
}

/**
 * Null when the base URL may receive the run's prompts and key; else why not.
 * Allowed: an origin on REPO_DOCS_LLM_BASE_URL_ALLOWLIST, or a loopback host
 * when the user passed --allow-loopback-llm. The list comes from the settings
 * file or the shell, never from the repository being read.
 */
export function baseUrlRefusal(value: string, allowlist: string | undefined, allowLoopback: boolean): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "The base URL is not a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "The base URL must use http or https";
  if (url.username || url.password) return "The base URL must not contain a user name or password";
  if (allowlistedOrigins(allowlist).has(url.origin)) return null;
  if (LOOPBACK_HOSTS.has(url.hostname)) {
    return allowLoopback ? null : "A loopback base URL needs --allow-loopback-llm";
  }
  return "The base URL is not on REPO_DOCS_LLM_BASE_URL_ALLOWLIST";
}

/**
 * Variables the provider SDKs read on their own to change where a call goes or
 * which credential it carries. The engine now passes its own values, but the
 * CLI still refuses to run with them set, so they can't route around the
 * base-URL rule if that ever regresses.
 */
export const SDK_ENV_OVERRIDES = ["OPENAI_BASE_URL", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"] as const;

/** The first SDK override set in the environment, by name (never its value), or null. */
export function sdkEnvRefusal(env: NodeJS.ProcessEnv): string | null {
  const found = SDK_ENV_OVERRIDES.find((name) => env[name]?.trim());
  return found
    ? `${found} is set in the environment. The provider SDKs read it on their own, so repo-docs won't run with it; unset it (and use --base-url for a custom server).`
    : null;
}

export interface RunConfig {
  apiKey?: string;
  baseUrl?: string;
  githubToken?: string;
  /** Every secret value in play, for the Redactor. */
  secrets: string[];
}

/** Checks the settings against the options; throws UsageError naming what's missing or refused. */
export function resolveRunConfig(options: GenerateOptions, settings: Settings): RunConfig {
  const keyName = providerKeyName(options.provider);
  const apiKey = keyName ? settings[keyName] : undefined;
  if (keyName && !apiKey) {
    throw new UsageError(`Missing setting ${keyName} (needed for --provider ${options.provider}). Add it to the .env file; see .env.example.`);
  }

  let baseUrl = options.baseUrl;
  if (options.provider === "azure") {
    baseUrl ??= settings.AZURE_OPENAI_ENDPOINT;
    if (!baseUrl) throw new UsageError("Missing setting AZURE_OPENAI_ENDPOINT (or --base-url) for --provider azure");
  }
  if (baseUrl !== undefined) {
    const refusal = baseUrlRefusal(baseUrl, settings.REPO_DOCS_LLM_BASE_URL_ALLOWLIST, options.allowLoopbackLlm);
    if (refusal) throw new UsageError(refusal);
  } else if (getProvider(options.provider)?.isLocal && !options.allowLoopbackLlm) {
    // A local provider's built-in server is on loopback too: same rule, same flag.
    const builtIn = getProvider(options.provider)?.baseUrl ?? "this machine";
    throw new UsageError(`--provider ${options.provider} calls a model server on loopback (${builtIn}); pass --allow-loopback-llm`);
  }

  return { apiKey, baseUrl, githubToken: settings.GITHUB_TOKEN, secrets: secretValues(settings) };
}

/** Replaces every known secret (and its URL-encoded form) with [redacted]. */
export class Redactor {
  private readonly values: string[] = [];

  add(...secrets: string[]): void {
    for (const s of secrets) {
      // Very short values would scrub ordinary words; real keys are long.
      if (s.length < 6) continue;
      for (const form of new Set([s, encodeURIComponent(s)])) if (!this.values.includes(form)) this.values.push(form);
    }
    this.values.sort((a, b) => b.length - a.length);
  }

  scrub(text: string): string {
    let out = text;
    for (const v of this.values) out = out.split(v).join("[redacted]");
    return out;
  }
}
