// X4: `repo-docs generate <github-url>`. main() returns the exit code (0 done,
// 1 runtime failure or the call cap, 2 bad arguments or settings) and writes
// only to the streams it is given, so tests can run it in-process. Everything
// it writes passes through the Redactor, and the engine's own console lines
// are dropped unless --verbose sends them (scrubbed) to stderr.
import fs from "node:fs";
import path from "node:path";
import { format } from "node:util";
import { parseCommand, UsageError, USAGE, type GenerateOptions } from "./args";
import { loadSettings, Redactor, resolveRunConfig, sdkEnvRefusal, secretValues } from "./config";
import { outputTarget, runGenerate, type RunEvent } from "./generate";

export interface CliIO {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The package folder (for the default .env and the version). */
  packageDir: string;
}

const CONSOLE_METHODS = ["log", "info", "debug", "warn", "error", "trace"] as const;

/** Routes console.* away from stdout for the run: to stderr (scrubbed) when verbose, else nowhere. */
function captureConsole(verbose: boolean, write: (line: string) => void): () => void {
  const saved = CONSOLE_METHODS.map((m) => [m, console[m]] as const);
  for (const m of CONSOLE_METHODS) {
    console[m] = verbose ? (...args: unknown[]) => write(format(...args)) : () => undefined;
  }
  return () => {
    for (const [m, fn] of saved) console[m] = fn;
  };
}

/** Scrubs every string field before JSON.stringify, whose escaping could hide a secret from a line-level scrub. */
function scrubFields<T>(value: T, redactor: Redactor): T {
  if (typeof value === "string") return redactor.scrub(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubFields(v, redactor)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubFields(v, redactor)])) as T;
  }
  return value;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "The run failed";
}

function plainLine(event: RunEvent, verbose: boolean): string | null {
  switch (event.type) {
    case "start":
      return `repo-docs: ${event.repoUrl} -> ${event.out} (${event.provider} ${event.model}, at most ${event.maxLlmCalls} model calls)`;
    case "progress":
      return `[${String(Math.round(event.progress)).padStart(3)}%] ${event.message}`;
    case "llm-call":
      return verbose ? `  model call ${event.call} of at most ${event.max}` : null;
    case "done":
      return [`Done: ${event.files.length} files in ${event.out} (${event.llmCalls} model calls)`, ...event.files.map((f) => `  ${f}`)].join("\n");
  }
}

export async function main(argv: string[], io: CliIO): Promise<number> {
  const redactor = new Redactor();
  const json = argv.includes("--json");
  let verbose = argv.includes("--verbose");
  const out = (line: string) => io.stdout.write(`${redactor.scrub(line)}\n`);
  const err = (line: string) => io.stderr.write(`${redactor.scrub(line)}\n`);
  const fail = (code: number, message: string): number => {
    if (json) out(JSON.stringify(scrubFields({ type: "error", exitCode: code, message }, redactor)));
    else err(`repo-docs: ${message}`);
    return code;
  };

  // Engine modules log while they work (URL parsing included), so capture first.
  const restoreConsole = captureConsole(verbose, err);
  try {
    let options: GenerateOptions;
    try {
      const command = parseCommand(argv, io.cwd);
      if (command.kind === "help") {
        out(USAGE);
        return 0;
      }
      if (command.kind === "version") {
        out(JSON.parse(fs.readFileSync(path.join(io.packageDir, "package.json"), "utf8")).version);
        return 0;
      }
      options = command.options;
      verbose = options.verbose;
    } catch (error) {
      if (error instanceof UsageError) return fail(2, `${error.message}\nRun "repo-docs --help" for the options.`);
      throw error;
    }

    let config;
    let target;
    try {
      const loaded = loadSettings({ envFile: options.envFile, packageDir: io.packageDir, cwd: io.cwd, env: io.env });
      redactor.add(...secretValues(loaded.settings));
      const envRefusal = sdkEnvRefusal(io.env);
      if (envRefusal) throw new UsageError(envRefusal);
      config = resolveRunConfig(options, loaded.settings);
      redactor.add(...config.secrets);
      if (verbose) err(`Settings: ${loaded.file ?? "shell variables only"}`);
      target = outputTarget(options, io.cwd);
    } catch (error) {
      if (error instanceof UsageError) return fail(2, error.message);
      throw error;
    }

    const emit = (event: RunEvent) => {
      if (json) out(JSON.stringify(scrubFields(event, redactor)));
      else {
        const line = plainLine(event, verbose);
        if (line !== null) out(line);
      }
    };
    try {
      await runGenerate(options, config, target, emit);
      return 0;
    } catch (error) {
      return fail(1, errorMessage(error));
    }
  } catch (error) {
    return fail(1, errorMessage(error));
  } finally {
    restoreConsole();
  }
}
