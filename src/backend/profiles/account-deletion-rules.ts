// D04d: account deletion rules (P07 §5.7). Pure, so unit tests check them and
// convex/accountDeletion.ts uses the same values.

/** Decided by Jose, 2026-10-28. */
export const ACCOUNT_DELETION_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

/** Projects purged (or hidden/shown) per scheduled step; other rows per step. */
export const ACCOUNT_PROJECTS_PER_STEP = 10;
export const ACCOUNT_ROWS_PER_STEP = 200;

/** Due accounts the hourly job starts per run. */
export const ACCOUNT_PURGES_PER_RUN = 10;

/**
 * The automatic purge runs only where the deployment opted in. Only the test
 * backends set this (tests/convex/push.mjs, target "test"); the import and
 * manual backends, and any real deployment, never do.
 */
export const purgeAllowed = (env: Record<string, string | undefined>) => env.CODEDETAILS_ACCOUNT_PURGE_ALLOWED === "1";

/** Due only with a real date in the past: an account marked deleting without one is never purged. */
export const deletionDue = (user: { status: string; deleteAfter?: number }, now: number) =>
  user.status === "deleting" && typeof user.deleteAfter === "number" && Number.isFinite(user.deleteAfter) && user.deleteAfter <= now;

/** Cancellable while deleting and before the date. */
export const deletionCancellable = (user: { status: string; deleteAfter?: number }, now: number) =>
  user.status === "deleting" && typeof user.deleteAfter === "number" && now < user.deleteAfter;
