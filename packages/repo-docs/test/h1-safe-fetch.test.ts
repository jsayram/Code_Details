// H1 SSRF guard. Nothing here reaches the internet: the only server is a
// throwaway one on 127.0.0.1, which the tests allow through an injected
// address rule, and DNS is a stand-in. The shared isolation guard
// (tests/support/vitest-setup.ts) stays on; it only learns this server's port.
import http from "node:http";
import type { AddressInfo } from "node:net";
import type dns from "node:dns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkOutboundUrl, guardedLookup, headersForRedirect, isPublicAddress, safeFetch, UnsafeUrlError } from "../src/repoScrapper/net/safe-fetch";
import { allowTestOwnedPort } from "./support/loopback-port";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1", "127.8.9.10", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::1", "::127.0.0.1",
    "::ffff:8.8.8.8", "::ffff:0:808:808", "::ffff:0:7f00:1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "168.63.129.16",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(["140.82.112.3", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "2001:4860:4860::8888", "168.63.129.17"])("allows %s", (ip) =>
    expect(isPublicAddress(ip)).toBe(true),
  );

  it("refuses things that aren't IPs", () => expect(isPublicAddress("example.com")).toBe(false));
});

describe("checkOutboundUrl", () => {
  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::ffff:169.254.169.254]/",
    "http://2130706433/", // 127.0.0.1 as one number; URL normalizes it
    "http://0x7f.1/",
    "http://localhost/",
    "http://foo.localhost/",
    "http://metadata.google.internal/",
    "http://printer.local/",
    "http://intranet/",
    "https://gitlab.example.com:8443/a/b",
    "https://user:pw@example.com/",
    "file:///etc/passwd",
    "ftp://example.com/",
    "not a url",
  ])("refuses %s", (url) => expect(() => checkOutboundUrl(url)).toThrow(UnsafeUrlError));

  it.each(["https://api.github.com/repos/a/b", "http://example.com/path?q=1", "https://8.8.8.8/"])("accepts %s", (url) =>
    expect(checkOutboundUrl(url).href).toBeTruthy(),
  );
});

const fakeDns = (...addresses: string[]) =>
  ((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
    cb(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })))) as unknown as typeof dns.lookup;
const resolveWith = (lookup: typeof dns.lookup, all = false) =>
  new Promise<unknown>((resolve, reject) =>
    guardedLookup(isPublicAddress, lookup)("repo.example.test", { all }, ((err: Error | null, address: unknown) =>
      err ? reject(err) : resolve(address)) as never),
  );

describe("guardedLookup (the check inside the socket's own DNS step)", () => {
  it("refuses a name that resolves to a private address", async () => {
    await expect(resolveWith(fakeDns("10.0.0.7"))).rejects.toThrow(/may not reach/);
  });
  it("refuses when any of several answers is private", async () => {
    await expect(resolveWith(fakeDns("140.82.112.3", "127.0.0.1"))).rejects.toThrow(/may not reach/);
    await expect(resolveWith(fakeDns("2606:4700::1111", "::ffff:169.254.169.254"), true)).rejects.toThrow(/may not reach/);
  });
  it("refuses a name that resolves to loopback", async () => {
    await expect(resolveWith(fakeDns("127.0.0.1"))).rejects.toThrow(/may not reach/);
  });
  it("passes public answers through in the shape asked for", async () => {
    expect(await resolveWith(fakeDns("140.82.112.3"))).toBe("140.82.112.3");
    expect(await resolveWith(fakeDns("140.82.112.3"), true)).toEqual([{ address: "140.82.112.3", family: 4 }]);
  });
});

describe("safeFetch", () => {
  let server: http.Server;
  let base: string;
  let release: () => void;
  let other: http.Server;
  let otherBase: string;
  let releaseOther: () => void;
  const loopbackOnly = { isAllowedAddress: (a: string) => a === "127.0.0.1", allowAnyPort: true };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://x");
      if (u.pathname === "/ok") return res.end("hello");
      if (u.pathname === "/big") return res.end("x".repeat(10_000));
      if (u.pathname === "/chunked") {
        for (let i = 0; i < 10; i++) res.write("y".repeat(500));
        return res.end();
      }
      if (u.pathname === "/slow") return setTimeout(() => res.end("late"), 2_000);
      if (u.pathname === "/hop") {
        res.writeHead(302, { location: "/ok" });
        return res.end();
      }
      if (u.pathname === "/to-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();
      }
      if (u.pathname === "/to-localhost") {
        res.writeHead(307, { location: "http://localhost/admin" });
        return res.end();
      }
      if (u.pathname === "/echo") return res.end(JSON.stringify(req.headers));
      if (u.pathname === "/to-echo") {
        res.writeHead(302, { location: "/echo" });
        return res.end();
      }
      if (u.pathname === "/to-other") {
        res.writeHead(302, { location: `${otherBase}/echo` });
        return res.end();
      }
      if (u.pathname === "/loop") {
        res.writeHead(302, { location: "/loop" });
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    release = allowTestOwnedPort(port);
    base = `http://127.0.0.1:${port}`;
    // A second origin (another port), which only echoes what it received.
    other = http.createServer((req, res) => res.end(JSON.stringify(req.headers)));
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
    const otherPort = (other.address() as AddressInfo).port;
    releaseOther = allowTestOwnedPort(otherPort);
    otherBase = `http://127.0.0.1:${otherPort}`;
  });
  afterAll(async () => {
    releaseOther();
    other.closeAllConnections();
    await new Promise<void>((r) => other.close(() => r()));
    release();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("fetches an allowed address and follows a same-host redirect", async () => {
    const res = await safeFetch(`${base}/hop`, {}, loopbackOnly);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("refuses a host name whose lookup answers 127.0.0.1, before any socket", async () => {
    const lookup = fakeDns("127.0.0.1");
    await expect(safeFetch("http://looks-public.example.test/", {}, { lookup })).rejects.toThrow(/may not reach/);
    await expect(safeFetch("https://api.example.test/x", {}, { lookup: fakeDns("140.82.112.3", "::1") })).rejects.toThrow(/may not reach/);
  });

  it("a DNS lookup that never answers still ends at the deadline", async () => {
    const hang = (() => undefined) as unknown as typeof dns.lookup;
    const started = Date.now();
    await expect(safeFetch("https://slow-dns.example.test/", {}, { lookup: hang, timeoutMs: 200 })).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("drops credential headers on a cross-origin redirect and keeps them on the same origin", async () => {
    const headers = { Authorization: "Bearer SYNTHETIC", "PRIVATE-TOKEN": "SYNTHETIC", Cookie: "a=b", "X-Api-Key": "SYNTHETIC", "X-Auth-Token": "SYNTHETIC", Accept: "x/y" };
    const cross = (await (await safeFetch(`${base}/to-other`, { headers }, loopbackOnly)).json()) as Record<string, string>;
    expect(cross.authorization).toBeUndefined();
    expect(cross["private-token"]).toBeUndefined();
    expect(cross.cookie).toBeUndefined();
    expect(cross["x-api-key"]).toBeUndefined();
    expect(cross["x-auth-token"]).toBeUndefined();
    expect(cross.accept).toBe("x/y");
    const same = (await (await safeFetch(`${base}/to-echo`, { headers }, loopbackOnly)).json()) as Record<string, string>;
    expect(same.authorization).toBe("Bearer SYNTHETIC");
  });

  it("the default rule refuses loopback before connecting", async () => {
    await expect(safeFetch(`${base}/ok`, {}, { allowAnyPort: true })).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("refuses a redirect to the metadata address", async () => {
    await expect(safeFetch(`${base}/to-metadata`, {}, loopbackOnly)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("refuses a redirect to localhost by name", async () => {
    await expect(safeFetch(`${base}/to-localhost`, {}, loopbackOnly)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("stops after too many redirects", async () => {
    await expect(safeFetch(`${base}/loop`, {}, { ...loopbackOnly, maxRedirects: 3 })).rejects.toThrow(/Too many redirects/);
  });

  it("caps the body size", async () => {
    await expect(safeFetch(`${base}/big`, {}, { ...loopbackOnly, maxBytes: 1_000 })).rejects.toThrow(/larger than/);
  });

  it("caps a body with no content-length", async () => {
    await expect(safeFetch(`${base}/chunked`, {}, { ...loopbackOnly, maxBytes: 1_000 })).rejects.toThrow(/larger than/);
    expect(await (await safeFetch(`${base}/chunked`, {}, loopbackOnly)).text()).toHaveLength(5_000);
  });

  it("enforces the deadline", async () => {
    const started = Date.now();
    await expect(safeFetch(`${base}/slow`, {}, { ...loopbackOnly, timeoutMs: 200 })).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("discardBody resolves on headers", async () => {
    const res = await safeFetch(`${base}/big`, { method: "GET" }, { ...loopbackOnly, maxBytes: 10, discardBody: true });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});

describe("headersForRedirect", () => {
  const creds = { authorization: "Bearer SYNTHETIC", accept: "x/y" };
  it("refuses https to http when credentials are present", () => {
    expect(() => headersForRedirect(new URL("https://a.example.test/"), new URL("http://a.example.test/x"), creds)).toThrow(UnsafeUrlError);
  });
  it("allows https to http without credentials", () => {
    expect(headersForRedirect(new URL("https://a.example.test/"), new URL("http://b.example.test/"), { accept: "x/y" })).toEqual({ accept: "x/y" });
  });
  it("strips credentials across origins, whatever their case, and keeps them on the same origin", () => {
    const mixed = { Authorization: "a", "Private-Token": "b", COOKIE: "c", "Proxy-Authorization": "d", "X-Api-Key": "e", "X-AUTH-TOKEN": "f", accept: "x/y" };
    expect(headersForRedirect(new URL("https://a.example.test/"), new URL("https://b.example.test/"), mixed)).toEqual({ accept: "x/y" });
    expect(headersForRedirect(new URL("https://a.example.test/"), new URL("https://a.example.test/y"), mixed)).toEqual(mixed);
  });
});
