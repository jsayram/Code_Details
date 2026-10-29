// D00b: the importer's internal functions refuse to run on the task-owned test
// backend (127.0.0.1:3210), which only has CODEDETAILS_FIXTURES_ALLOWED. The
// import itself runs on its own backend (3220) that tests never touch, so
// fixtures:clear can't wipe it and the importer can't write into test data.
// Anonymous clients can't reach the importer at all: it's internal.
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { adminClient, anonymousClient, convexAvailable } from "../fixtures/convex";

const begin = makeFunctionReference<"mutation">("importer:begin");
const dump = makeFunctionReference<"query">("importer:dump");

describe.skipIf(!convexAvailable())("D00b importer guard on the test backend", () => {
  it("refuses the importer even with the admin key", async () => {
    await expect(adminClient().mutation(begin, { sourceCapture: "synthetic", sourceFingerprint: "synthetic" })).rejects.toThrow(/importer is disabled/);
    await expect(adminClient().query(dump, {})).rejects.toThrow(/importer is disabled/);
  });

  it("exposes no importer function to an anonymous client", async () => {
    await expect(anonymousClient().query(dump, {})).rejects.toThrow(/Could not find public function/);
  });
});
