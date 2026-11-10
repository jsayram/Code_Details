/**
 * H1 privacy, dry run only: which stored project images still hold the
 * uploader's original file name, and the neutral name each would get.
 *
 * Reads an unzipped Convex export (the folder that holds
 * projectImages/documents.jsonl) or that .jsonl file directly. No database or
 * network access, nothing is written. Original names are never printed, only
 * whether a row has one. Changing the rows needs Jose's go, and a migration
 * written then.
 *
 *   npx tsx scripts/h1-image-names/dry-run.ts <export-folder-or-jsonl>
 */
import fs from "node:fs";
import path from "node:path";

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export type ImageRow = { _id: string; kind: string; mimeType: string; fileName: string };
export type Proposal = { id: string; kind: string; storedIsNeutral: boolean; proposed: string };

/** The value attach stores since H1. */
export const storedNeutralName = (kind: string, mimeType: string) => `${kind}.${EXTENSIONS[mimeType] ?? "img"}`;

export function propose(rows: ImageRow[]): Proposal[] {
  return rows.map((r) => {
    const proposed = storedNeutralName(r.kind, r.mimeType);
    return { id: r._id, kind: r.kind, storedIsNeutral: r.fileName === proposed, proposed };
  });
}

export function readRows(target: string): ImageRow[] {
  const file = fs.statSync(target).isDirectory() ? path.join(target, "projectImages", "documents.jsonl") : target;
  if (!fs.existsSync(file)) throw new Error(`No projectImages export at ${file}`);
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ImageRow);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: npx tsx scripts/h1-image-names/dry-run.ts <export-folder-or-projectImages-jsonl>");
    process.exit(2);
  }
  const proposals = propose(readRows(target));
  const pending = proposals.filter((p) => !p.storedIsNeutral);
  console.log(`DRY RUN. ${proposals.length} image rows; ${pending.length} still store an uploader's file name.`);
  for (const p of pending) console.log(`${p.id}\t${p.kind}\t-> ${p.proposed}`);
  console.log("Nothing was changed.");
}
