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

export default crons;
