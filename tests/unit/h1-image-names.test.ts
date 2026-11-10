// H1 privacy: neutral image names, in Convex views and in the dry-run script.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { neutralFileName } from "../../convex/projectImages";
import { propose, readRows, storedNeutralName } from "../../scripts/h1-image-names/dry-run";

describe("neutralFileName", () => {
  it("names by kind, id tail and type, never the upload's name", () => {
    expect(neutralFileName("cover", "image/png", "k17abcdefXYZ123")).toBe("cover-XYZ123.png");
    expect(neutralFileName("screenshot", "image/jpeg", "abc123")).toBe("screenshot-abc123.jpg");
    expect(neutralFileName("logo", "application/x-odd", "abcdef")).toBe("logo-abcdef.img");
  });
});

describe("dry-run script", () => {
  const rows = [
    { _id: "a1", kind: "cover", mimeType: "image/png", fileName: "passport-scan.png" },
    { _id: "a2", kind: "screenshot", mimeType: "image/webp", fileName: "screenshot.webp" },
  ];

  it("flags rows still holding an uploader's name and proposes the stored neutral one", () => {
    expect(propose(rows)).toEqual([
      { id: "a1", kind: "cover", storedIsNeutral: false, proposed: "cover.png" },
      { id: "a2", kind: "screenshot", storedIsNeutral: true, proposed: "screenshot.webp" },
    ]);
    expect(storedNeutralName("diagram", "image/gif")).toBe("diagram.gif");
  });

  it("reads an unzipped export folder and never echoes the original names", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "h1-names-"));
    fs.mkdirSync(path.join(dir, "projectImages"));
    fs.writeFileSync(path.join(dir, "projectImages", "documents.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    expect(readRows(dir)).toHaveLength(2);
    expect(JSON.stringify(propose(readRows(dir)))).not.toContain("passport");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
