// Scheduled jobs (D08c, D04d). Runs wherever this code is deployed; today that
// is only the task-owned test backend.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Half-finished sign-ups: auth users left without an account (convex/accounts.ts).
crons.hourly("repair half-finished sign-ups", { minuteUTC: 17 }, internal.accounts.repairHalfFinishedSignUps, {});

// D04d: accounts past their 14-day grace period. A no-op unless the deployment
// set CODEDETAILS_ACCOUNT_PURGE_ALLOWED=1 (only the test backends do).
crons.hourly("purge accounts past their grace period", { minuteUTC: 41 }, internal.accountDeletion.purgeDue, {});

// D06-c: uploads that never became an image, after 24 hours. A no-op unless the
// deployment set CODEDETAILS_IMAGE_SWEEP_ALLOWED=1 (only the test backends do).
crons.hourly("sweep orphaned image uploads", { minuteUTC: 53 }, internal.projectImages.sweepOrphans, {});

// D10: yesterday's search totals, and retention (receipts 24 h, raw events 90
// days, daily totals 25 months). No-ops unless the deployment set
// CODEDETAILS_SEARCH_ANALYTICS_ALLOWED=1 (only the test backends do).
crons.daily("aggregate yesterday's search totals", { hourUTC: 0, minuteUTC: 20 }, internal.searchAnalytics.aggregateDay, {});
crons.hourly("apply search analytics retention", { minuteUTC: 29 }, internal.searchAnalytics.applyRetention, {});

export default crons;
