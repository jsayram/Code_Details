// H1 privacy: neutral names for project images. No Convex imports, so the
// dry-run script and unit tests can use it without the function modules.

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

const extensionOf = (mimeType: string) => EXTENSIONS[mimeType] ?? "img";

/**
 * The name every caller sees for an image, built from its kind, id and type.
 * The uploader's own file name ("passport-scan.png") is never returned; rows
 * from before H1 may still hold one in storage (scripts/h1-image-names/dry-run.ts).
 */
export function neutralFileName(kind: string, mimeType: string, id: string): string {
  return `${kind}-${id.slice(-6)}.${extensionOf(mimeType)}`;
}

/** What attach stores since H1. */
export function storedNeutralName(kind: string, mimeType: string): string {
  return `${kind}.${extensionOf(mimeType)}`;
}
