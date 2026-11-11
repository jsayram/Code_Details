# repo-docs

Turns a GitHub repository into a short tutorial: a set of Markdown chapters plus an overview, written by an LLM from the repository's code. It's the engine behind Code Details' GitHub scraper, packaged so it also runs on its own from the command line.

**Status:** private and unpublished. `repo-docs` is a working name. The package is `"private": true` with no license granted (`UNLICENSED`), and it lives in this repository as an npm workspace. Don't publish it or copy it elsewhere without the owner's go.

## What it does

1. Reads the repository's file tree and files through the GitHub API.
2. Asks the model to find the main concepts, how they relate, and the order to teach them in (three calls).
3. Writes one chapter per concept (one call each), then an overview that links the chapters.
4. Saves everything to a folder:

```
<out>/
  -1_overview.md             the overview, with links to each chapter
  00_chapter-1-<title>.md    one file per chapter, YAML frontmatter first
  01_chapter-2-<title>.md
  _meta.json                 repo, provider, model, chapter list, time
```

That's the same layout Code Details writes for its own docs (`FileDocStore`), so a folder made by the CLI can be read by the app's store and the other way round.

A run with the default 8 chapters makes about 11 model calls.

## Install (from this repository)

You need Node 26 (that's what it's tested on). The CLI runs the TypeScript source directly with Node's built-in type stripping, so there's no build step.

```sh
git clone <this-repo> && cd <this-repo>
npm ci
```

Then either call the script directly:

```sh
node packages/repo-docs/bin/repo-docs.mjs --help
```

or through npm from the repository root:

```sh
npm run repo-docs -w repo-docs -- --help
```

Note that `npm run ... -w repo-docs` runs in `packages/repo-docs/`, so relative `--out` paths and the default `./docs-output/` are relative to that folder.

## Settings (`.env`)

```sh
cp packages/repo-docs/.env.example packages/repo-docs/.env
```

Fill in the key for the provider you'll use and, if you like, `GITHUB_TOKEN`. `.env.example` lists every setting with a one-line comment. The CLI looks for settings in this order and uses the first file it finds:

1. the file given with `--env-file <path>`
2. `packages/repo-docs/.env`
3. `.env` in the current folder

Variables already set in your shell win over the file. The file is parsed, not loaded into the process environment, so the values don't leak to child processes. `packages/repo-docs/.env` and `docs-output/` are git-ignored.

If a setting the run needs is missing, the CLI stops with exit code 2 and names it (for example `Missing setting OPENAI_API_KEY`). It never prints a key or token, not in errors and not with `--verbose`; any output line that would contain one is scrubbed to `[redacted]`.

## Usage

```sh
repo-docs generate <github-url> [options]
```

`<github-url>` can be `https://github.com/owner/repo`, `https://github.com/owner/repo/tree/branch`, `owner/repo` or `owner/repo#branch`.

| Option | Default | What it does |
|---|---|---|
| `--out <dir>` | `./docs-output/<owner>-<repo>-<date>-<random>` | The folder for this doc. Its last part must use only letters, digits, `-` and `_`. It must be new or empty. |
| `--provider <id>` | `openai` | `openai`, `anthropic`, `google`, `groq`, `deepseek`, `openrouter`, `xai`, `azure` or `ollama` |
| `--model <id>` | `gpt-4o-mini` for openai, else the provider's first model | The model to call |
| `--max-chapters <n>` | 8 | Chapters to write, 1 to 20 |
| `--max-llm-calls <n>` | 40 | Hard cap on model HTTP requests for this run, 1 to 500. Every try counts, retries included |
| `--language <name>` | `english` | Language to write the docs in |
| `--base-url <url>` | none | A custom server for an OpenAI-compatible provider (see Safety) |
| `--allow-loopback-llm` | off | Allows a model server on 127.0.0.1, ::1 or localhost: a loopback `--base-url`, or a local provider such as `ollama` |
| `--env-file <path>` | see above | Settings file to read |
| `--json` | off | One JSON object per line on stdout: `start`, `progress`, `llm-call`, `done` or `error` |
| `--verbose` | off | Also prints the engine's own log lines, on stderr |

Exit codes: `0` finished, `1` the run failed or hit the call cap, `2` bad arguments or settings.

Examples:

```sh
# OpenAI, defaults
repo-docs generate https://github.com/owner/repo

# Fewer chapters, in Spanish, into a folder of your choosing
repo-docs generate owner/repo --max-chapters 4 --language spanish --out ./docs/owner-repo

# A model server on this machine (Ollama needs no key, but does need the loopback flag)
repo-docs generate owner/repo --provider ollama --model llama3.2 --allow-loopback-llm

# An OpenAI-compatible server on loopback, for example LM Studio
repo-docs generate owner/repo --base-url http://127.0.0.1:1234/v1 --allow-loopback-llm
```

## Safety

**The repository is untrusted input.** Its files go into the prompts as data, and the model's replies are written to disk as Markdown. A repository can contain text written to steer the model (prompt injection): to make it write misleading docs, insert links, or try to pull other text into its answer. Treat the output as unreviewed text from a stranger. Read it before you publish it, and don't render it as raw HTML.

**Where your keys go.**

- The provider key goes only to that provider's API, or to the `--base-url` you allowed. A `--base-url` must have an origin listed in `REPO_DOCS_LLM_BASE_URL_ALLOWLIST`, or be on loopback with `--allow-loopback-llm`. A local provider such as `ollama` talks to loopback by default, so it needs the flag too. URLs with a user name or password are refused. The list comes from your settings, never from the repository being read. `--base-url` is refused for `anthropic` and `google`, which don't use it.
- The provider SDKs would read `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` from your shell on their own. The engine always passes its own endpoint, so they have no effect, and the CLI also refuses to run while any of them is set (it names the variable, never its value).
- `GITHUB_TOKEN` is sent only to `api.github.com`. The crawler always goes through the engine's safe fetch, which refuses private and loopback addresses, pins DNS, checks every redirect, drops credentials on a redirect to another origin, and caps time and size. No option turns it off.
- The token is optional. Without one, GitHub allows 60 API requests an hour from your IP, and each file is one request, so only small repositories fit.

**Costs.** Each model call costs money on a paid provider. The CLI turns off the SDK's own retries, so every try is one HTTP request and the cap counts requests. A run stops before the request that would go over `--max-llm-calls` (default 40), and it stops at the first `401` or `403` from the model server instead of retrying. A failed step is still retried by the flow (up to 5 tries, 20 seconds apart), and each try counts toward the cap. A stopped run writes nothing. Big repositories make big prompts: the first call can carry up to about 70% of the model's context window. Set a spending limit with your provider as well.

**Files.** The CLI writes only inside `--out` (or the default folder). The folder's name goes through the same checks the store uses, so `..`, slashes and dots can't move it elsewhere, and it won't write into a folder that already has files.

## Tests

```sh
npm test -w repo-docs
```

The tests never reach GitHub or a real provider. The CLI tests use a small OpenAI-compatible server on 127.0.0.1 with canned replies and a fixture in place of the GitHub crawl, and they check that fake keys never show up in the output.

## Limits

- It needs a Node with type stripping and `module.registerHooks` (developed on Node 26). Node refuses to strip types in files under `node_modules`, so installing this package as a dependency of another project would need a build step first.
- The generated text is only as good as the model and the code it can see; large repositories are cut to fit the context window.
