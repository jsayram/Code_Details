// D04e (P08 R23; P07 §5.4, §5.5): the email address changes only through
// Better Auth, and only verified. A verified account confirms from its
// current address, then verifies the new one; nothing changes until that
// second link is followed. Links never carry either address (f5).
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearConvexFixtures, convexAvailable } from "../fixtures/convex";
import { FAKE_MAILPIT_PORT, fakeMailpit, linkIn, revealsAddress } from "../fixtures/fake-mailpit";
import { authFetch, authState, signIn, signUpRaw, SYNTHETIC_PASSWORD, syntheticEmail, type Jar } from "../fixtures/better-auth";

const mailbox = fakeMailpit();
/** The emailed link points at the app origin; the test calls the backend's site port with the same path. */
const onBackend = (link: URL) => `${link.pathname.replace(/^\/api\/auth/, "")}${link.search}`;
const follow = async (link: URL) => expect((await authFetch(onBackend(link), { method: "GET" })).status).toBeLessThan(400);

async function verifiedUser(label: string): Promise<{ email: string; jar: Jar }> {
  const email = syntheticEmail(label);
  expect((await signUpRaw(email, SYNTHETIC_PASSWORD)).status).toBe(200);
  const [mail] = await mailbox.waitFor(email, "verify-email");
  await follow(linkIn(mail));
  const res = await signIn(email, SYNTHETIC_PASSWORD);
  expect(res.status).toBe(200);
  return { email, jar: res.jar };
}

describe.skipIf(!convexAvailable())("D04e change email through Better Auth", () => {
  beforeAll(async () => {
    await mailbox.start();
    expect((mailbox.server.address() as AddressInfo).port).toBe(FAKE_MAILPIT_PORT);
    await clearConvexFixtures();
  });
  afterAll(async () => {
    await clearConvexFixtures();
    await mailbox.stop();
  });
  beforeEach(() => {
    mailbox.inbox.length = 0;
  });

  it("confirm at the old address, then verify the new one; only then does the address change", async () => {
    const { email, jar } = await verifiedUser("d04e-change");
    const newEmail = syntheticEmail("d04e-new");
    expect((await authFetch("/change-email", { body: { newEmail }, jar })).status).toBe(200);

    const [confirm] = await mailbox.waitFor(email, "change-email");
    expect(confirm).toBeDefined();
    expect(revealsAddress(confirm.text, newEmail)).toBe(false); // the old mailbox isn't told the new address
    expect(revealsAddress(linkIn(confirm).toString(), email)).toBe(false);
    expect(mailbox.mailFor(newEmail, "verify-email")).toEqual([]);
    expect(await authState(email)).not.toBeNull();
    expect(await authState(newEmail)).toBeNull();

    await follow(linkIn(confirm));
    const [verify] = await mailbox.waitFor(newEmail, "verify-email");
    expect(verify).toBeDefined();
    expect(revealsAddress(linkIn(verify).toString(), newEmail)).toBe(false);
    expect(revealsAddress(linkIn(verify).toString(), email)).toBe(false);
    expect(await authState(email)).not.toBeNull(); // still unchanged

    await follow(linkIn(verify));
    expect(await authState(newEmail)).not.toBeNull();
    expect(await authState(email)).toBeNull();
    expect((await signIn(newEmail, SYNTHETIC_PASSWORD)).status).toBe(200);
  });

  it("update-user still can't set an email", async () => {
    const { email, jar } = await verifiedUser("d04e-update");
    const res = await authFetch("/update-user", { body: { email: syntheticEmail("d04e-sneaky") }, jar });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await authState(email)).not.toBeNull();
  });

  it("an address someone already has: the same answer, and no mail to anyone", async () => {
    const taken = await verifiedUser("d04e-taken");
    const { email, jar } = await verifiedUser("d04e-asker");
    mailbox.inbox.length = 0;
    expect((await authFetch("/change-email", { body: { newEmail: taken.email }, jar })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1000));
    expect(mailbox.inbox).toEqual([]);
    expect(await authState(email)).not.toBeNull();
  });

  it("signed out, change-email is refused", async () => {
    const res = await authFetch("/change-email", { body: { newEmail: syntheticEmail("d04e-anon") } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
