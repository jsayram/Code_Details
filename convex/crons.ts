// Scheduled jobs (D08c). Runs wherever this code is deployed; today that is
// only the task-owned test backend.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Half-finished sign-ups: auth users left without an account (convex/accounts.ts).
crons.hourly("repair half-finished sign-ups", { minuteUTC: 17 }, internal.accounts.repairHalfFinishedSignUps, {});

export default crons;
