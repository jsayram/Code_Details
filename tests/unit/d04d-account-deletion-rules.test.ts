// D04d: the account-deletion rules. The purge is opt-in per deployment, an
// account is due only with a real date in the past, and it can be cancelled
// only before that date.
import { describe, expect, it } from "vitest";
import { ACCOUNT_DELETION_GRACE_MS, deletionCancellable, deletionDue, purgeAllowed } from "@/backend/profiles/account-deletion-rules";

const DAY = 24 * 60 * 60 * 1000;

describe("D04d account deletion rules", () => {
  it("the grace period is 14 days", () => {
    expect(ACCOUNT_DELETION_GRACE_MS).toBe(14 * DAY);
  });

  it("the purge runs only where the deployment set the flag to exactly 1", () => {
    expect(purgeAllowed({ CODEDETAILS_ACCOUNT_PURGE_ALLOWED: "1" })).toBe(true);
    for (const value of [undefined, "", "0", "true", "yes", " 1"]) {
      expect(purgeAllowed({ CODEDETAILS_ACCOUNT_PURGE_ALLOWED: value }), String(value)).toBe(false);
    }
    expect(purgeAllowed({})).toBe(false);
  });

  it("due: deleting with a date in the past, and nothing else", () => {
    const now = 1_000 * DAY;
    expect(deletionDue({ status: "deleting", deleteAfter: now - 1 }, now)).toBe(true);
    expect(deletionDue({ status: "deleting", deleteAfter: now }, now)).toBe(true);
    expect(deletionDue({ status: "deleting", deleteAfter: now + 1 }, now)).toBe(false);
    expect(deletionDue({ status: "deleting" }, now)).toBe(false);
    expect(deletionDue({ status: "deleting", deleteAfter: Number.NaN }, now)).toBe(false);
    for (const status of ["active", "deleted", "system"]) expect(deletionDue({ status, deleteAfter: 0 }, now), status).toBe(false);
  });

  it("cancellable only while deleting and before the date", () => {
    const now = 1_000 * DAY;
    expect(deletionCancellable({ status: "deleting", deleteAfter: now + 1 }, now)).toBe(true);
    expect(deletionCancellable({ status: "deleting", deleteAfter: now }, now)).toBe(false);
    expect(deletionCancellable({ status: "deleting" }, now)).toBe(false);
    expect(deletionCancellable({ status: "active", deleteAfter: now + DAY }, now)).toBe(false);
  });
});
