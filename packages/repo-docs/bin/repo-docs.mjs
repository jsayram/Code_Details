#!/usr/bin/env node
// X4: the repo-docs command. It runs the package's TypeScript source with
// Node's built-in type stripping, so there is no build step. Two small module
// hooks make the source loadable as-is, and only for files under ../src/:
//   resolve: the source imports siblings without an extension ("./nodes"), as
//            the TypeScript compiler and the app's bundler expect; try ".ts"
//            and "/index.ts" when Node can't find the bare name.
//   load:    mark those files as ES module TypeScript, so Node doesn't guess
//            (and warn) about their module type.
// Needs a Node version with type stripping on by default and
// module.registerHooks (developed and tested on Node 26).
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!/^\.\.?\//.test(specifier) || !context.parentURL?.startsWith(SRC)) throw error;
      for (const suffix of [".ts", "/index.ts"]) {
        try {
          const resolved = nextResolve(specifier + suffix, context);
          if (resolved.url.startsWith(SRC)) return resolved;
        } catch {
          // try the next form
        }
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith(SRC) && url.endsWith(".ts")) return nextLoad(url, { ...context, format: "module-typescript" });
    return nextLoad(url, context);
  },
});

const { main } = await import("../src/cli/main.ts");
const code = await main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
  env: process.env,
  packageDir: fileURLToPath(new URL("..", import.meta.url)),
});

// Let piped output drain, then exit: a run stopped by the call cap may still
// have a retry timer pending inside the flow, and it must not keep running.
await Promise.all([process.stdout, process.stderr].map((s) => new Promise((resolve) => s.write("", resolve))));
process.exit(code);
