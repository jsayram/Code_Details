// D01, P08 rule 3: no public Convex function accepts a user, owner, viewer or
// other identity argument. Identity only ever comes from the verified token
// (convex/viewer.ts). This loads every module in convex/ and inspects the
// argument validators Convex itself exports for each registered function, so
// a new function is covered as soon as it exists. Internal functions (admin
// key only, e.g. fixtures) are exempt; public ones must also declare args.
import fs from "node:fs";
import path from "node:path";
import { v } from "convex/values";
import { describe, expect, it } from "vitest";
import { queryGeneric } from "convex/server";

const CONVEX_DIR = path.resolve(__dirname, "../../convex");
const NOT_FUNCTION_MODULES = new Set(["schema.ts", "auth.config.ts"]);
const IDENTITY_NAME = /user|owner|viewer|subject|email|identity|account|author|creator|member|caller|actor|token|session/i;
const IDENTITY_TABLES = new Set(["users", "authLinks", "profiles"]);

interface Registered {
  isPublic?: boolean;
  isInternal?: boolean;
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  exportArgs?: () => string;
}

type ValidatorJson = { type: string; value?: unknown; tableName?: string };

/** Every identity-shaped field name or ID in an exported args validator. */
function identityProblems(argsJson: string): string[] {
  const problems: string[] = [];
  const walk = (node: ValidatorJson, where: string) => {
    if (node.type === "any") problems.push(`${where}: v.any() accepts anything, identities included`);
    if (node.type === "id" && node.tableName && IDENTITY_TABLES.has(node.tableName)) problems.push(`${where}: takes an Id<"${node.tableName}">`);
    if (node.type === "object") {
      for (const [name, field] of Object.entries(node.value as Record<string, { fieldType: ValidatorJson }>)) {
        if (IDENTITY_NAME.test(name)) problems.push(`${where}.${name}: identity-shaped argument name`);
        walk(field.fieldType, `${where}.${name}`);
      }
    }
    if (node.type === "array") walk(node.value as ValidatorJson, `${where}[]`);
    if (node.type === "union") (node.value as ValidatorJson[]).forEach((m, i) => walk(m, `${where}|${i}`));
    if (node.type === "record") {
      const r = node.value as { keys: ValidatorJson; values: { fieldType: ValidatorJson } };
      walk(r.values.fieldType, `${where}{}`);
    }
  };
  walk(JSON.parse(argsJson) as ValidatorJson, "args");
  return problems;
}

async function publicFunctions(): Promise<{ name: string; argsJson: string }[]> {
  const files = fs.readdirSync(CONVEX_DIR).filter((f) => f.endsWith(".ts") && !NOT_FUNCTION_MODULES.has(f));
  const out: { name: string; argsJson: string }[] = [];
  for (const file of files) {
    const mod = (await import(path.join(CONVEX_DIR, file))) as Record<string, unknown>;
    for (const [exportName, value] of Object.entries(mod)) {
      const fn = value as Registered;
      if (typeof value !== "function" || !fn.exportArgs || !fn.isPublic) continue;
      out.push({ name: `${file.replace(/\.ts$/, "")}:${exportName}`, argsJson: fn.exportArgs() });
    }
  }
  return out;
}

describe("D01 no public Convex function takes an identity argument", () => {
  it("finds the public functions (guards against an empty scan)", async () => {
    const names = (await publicFunctions()).map((f) => f.name).sort();
    expect(names).toEqual(expect.arrayContaining(["identity:whoami", "projects:getOwnBySlug", "projects:getPublicBySlug"]));
  });

  it("every public function's arguments are free of identity", async () => {
    const problems = (await publicFunctions()).flatMap((f) => identityProblems(f.argsJson).map((p) => `${f.name} ${p}`));
    expect(problems).toEqual([]);
  });

  it("the checker catches the shapes it is meant to (self-test)", () => {
    const argsOf = (args: Parameters<typeof queryGeneric>[0] extends infer D ? D : never) =>
      (queryGeneric(args) as unknown as Registered).exportArgs!();
    expect(identityProblems(argsOf({ args: { userId: v.string() }, handler: async () => null }))).toHaveLength(1);
    expect(identityProblems(argsOf({ args: { slug: v.string(), opts: v.object({ ownerKey: v.string() }) }, handler: async () => null }))).toHaveLength(1);
    expect(identityProblems(argsOf({ args: { target: v.id("users") }, handler: async () => null }))).toHaveLength(1);
    expect(identityProblems(argsOf({ args: { who: v.optional(v.union(v.null(), v.id("profiles"))) }, handler: async () => null }))).toHaveLength(1);
    expect(identityProblems(argsOf({ handler: async () => null }))).toEqual(["args: v.any() accepts anything, identities included"]);
    expect(identityProblems(argsOf({ args: { slug: v.string() }, handler: async () => null }))).toEqual([]);
  });
});
