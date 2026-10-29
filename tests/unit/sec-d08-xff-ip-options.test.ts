// SEC-D08-XFF (interim, fail closed): Better Auth takes the client IP only
// from headers this deployment was told to trust. X-Forwarded-For counts only
// with a trusted-proxy list; the test-only header only on a loopback site;
// otherwise nothing counts and every client shares the fallback bucket.
import { describe, expect, it } from "vitest";
import { TEST_CLIENT_IP_HEADER, ipAddressOptions } from "../../convex/authRules";

const LOOPBACK = "http://127.0.0.1:3211";

describe("ipAddressOptions", () => {
  it("trusts no header by default", () => {
    expect(ipAddressOptions({})).toEqual({ ipAddressHeaders: [], trustedProxies: [] });
    expect(ipAddressOptions({ CONVEX_SITE_URL: LOOPBACK, CODEDETAILS_AUTH_TRUSTED_PROXIES: " , " })).toEqual({ ipAddressHeaders: [], trustedProxies: [] });
  });

  it("uses X-Forwarded-For only with a trusted-proxy list, and passes the list on", () => {
    expect(ipAddressOptions({ CODEDETAILS_AUTH_TRUSTED_PROXIES: "10.0.0.1, 10.1.0.0/16" })).toEqual({
      ipAddressHeaders: ["x-forwarded-for"],
      trustedProxies: ["10.0.0.1", "10.1.0.0/16"],
    });
  });

  it("honors the test-only header only on a loopback site", () => {
    expect(ipAddressOptions({ CODEDETAILS_AUTH_TEST_CLIENT_IP: "1", CONVEX_SITE_URL: LOOPBACK }).ipAddressHeaders).toEqual([TEST_CLIENT_IP_HEADER]);
    expect(ipAddressOptions({ CODEDETAILS_AUTH_TEST_CLIENT_IP: "1", CONVEX_SITE_URL: "https://example.convex.site" }).ipAddressHeaders).toEqual([]);
    expect(ipAddressOptions({ CODEDETAILS_AUTH_TEST_CLIENT_IP: "true", CONVEX_SITE_URL: LOOPBACK }).ipAddressHeaders).toEqual([]);
  });
});
