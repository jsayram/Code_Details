# Code Details

Code Details is a place for developers to show their software projects. You add a project, file it under a category, tag the technologies it uses, and other people can browse, search and favorite it.

> **Work in progress.** The current code lives on the `dev` branch. `main` still holds an earlier version (Supabase and Clerk) until `dev` is merged into it. It isn't hosted publicly yet.

## What it does

- **Project pages** with a description, links, images and per-category details. There are 22 categories, from web and mobile to AI agents and embedded systems.
- **Tags** for technologies, with aliases, so "nextjs" and "Next.js" count as the same thing.
- **Search** across projects, tags and people, with typo tolerance and synonyms. Anyone can search; you don't need an account.
- **Profiles and favorites.** Each user has a public profile with the projects they've shared and the ones they've favorited.
- **Accounts** with email and password, or GitHub sign-in.
- **Admin tools:** moderation, tag review and a dashboard.
- **Repo docs (admin only).** Point it at a public GitHub repository and it reads the code and writes a tutorial-style guide with an LLM. The engine is its own package, `packages/repo-docs`, and also runs as a command-line tool.

## Tech stack

| Area | Choice |
|---|---|
| Web app | Next.js 16 (App Router), React 19, TypeScript |
| UI | Tailwind CSS 4, shadcn/ui on Radix, Framer Motion |
| Data and server functions | Convex |
| Auth | Better Auth on Convex |
| Repo docs engine | `packages/repo-docs`: crawler, LLM clients (OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, xAI, Azure, Ollama), Mermaid diagrams |
| Tests | Vitest, Playwright, axe accessibility checks |

## Getting started (on the `dev` branch)

You need Node 20 or newer and Docker (the end-to-end tests use a throwaway Postgres container).

```bash
git clone https://github.com/jsayram/Code_Details.git
cd Code_Details
git checkout dev
npm install
cp .env.example .env.local
```

Fill in `.env.local`. Every setting in `.env.example` has a one-line comment, and the file only holds placeholders. To start, the app needs:

- a local Convex backend (`scripts/dev-backend/backend-up.sh` starts one on 127.0.0.1:3240), and the two Convex URLs pointing at it;
- `CODEDETAILS_INTERNAL_AUTH_SECRET`, any long random string;
- `SITE_URL`, `http://localhost:3000` when running locally.

The GitHub, OpenAI and other provider keys are optional. Without them, the features that need them stay off.

Then run:

```bash
npm run dev
```

## Tests

```bash
npm test            # unit and integration tests (Vitest)
npm run typecheck   # app, Convex functions and the repo-docs package
npm run test:e2e    # browser tests (Playwright); needs a test slot, see tests/
```

## Repo docs from the command line

```bash
node packages/repo-docs/bin/repo-docs.mjs generate https://github.com/owner/repo --out ./docs-output
```

The command-line tool needs Node 26: it runs the TypeScript source directly, with no build step. See `packages/repo-docs/README.md` for its settings, safety notes and costs. It sends repository code to the LLM provider you configure, and that provider bills you for the calls.

## Security

Server keys stay on the server. Outbound fetches go through an SSRF guard. Custom LLM endpoints must be on an allowlist. Generated diagrams render in Mermaid's strict mode. If you find a security problem, please open a private security advisory on this repo rather than a public issue.

## History

This repo was the home of an earlier Angular version that was never finished. That code now lives in a separate archive. The Next.js app was built in `jsayram/CodeDetailsWeb`; it moved here in November 2026 with its full history, and the old repo is archived.

## License

MIT. See [LICENSE](LICENSE).
