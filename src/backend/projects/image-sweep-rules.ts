// D06-c: the orphan sweep's rules (P07 §3.10, §5.11). Pure, so unit tests check
// them and convex/projectImages.ts uses the same values.

/** An upload is an orphan once it has gone this long without an image row (P07 §5.11: 24 hours). */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Files looked at per scheduled step; the step reschedules itself for the rest. */
export const ORPHAN_SWEEP_BATCH = 100;

/**
 * The sweep deletes files, so it runs only where the deployment opted in. Only
 * the test backends set this (tests/convex/push.mjs, target "test"); the import
 * and manual backends, and any real deployment, never do.
 */
export const sweepAllowed = (env: Record<string, string | undefined>) => env.CODEDETAILS_IMAGE_SWEEP_ALLOWED === "1";
