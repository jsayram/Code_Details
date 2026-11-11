// D03: limits for the project lifecycle fan-out (convex/projectLifecycle.ts).
// Kept here, free of Convex imports, so unit tests can check them directly.

/** Rows one transaction writes for the fan-out (listed copies, purge cleanup). */
export const LIFECYCLE_BATCH = 200;

/** File deletion after a purge: attempts before giving up to the orphan sweep. */
export const FILE_DELETE_MAX_ATTEMPTS = 5;

/** Delay before retrying after failed attempt n (1-based): 1 s, 2 s, 4 s... capped at a minute. */
export const fileDeleteRetryDelayMs = (attempt: number) => Math.min(60_000, 1000 * 2 ** (attempt - 1));
