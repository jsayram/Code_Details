// H1: outbound fetch for URLs a visitor can influence (repo analyzer, repo
// crawler, link checker). Server-side only.
// - Only http/https, no credentials in the URL, default ports only.
// - Refuses loopback, private, link-local (cloud metadata), CGNAT, multicast
//   and reserved addresses, and names such as localhost or *.internal.
// - The address is checked inside the socket's own DNS lookup, so the checked
//   address is the one connected to (no DNS-rebinding gap). IP literals are
//   checked before connecting.
// - Redirects are followed by hand, each hop checked the same way, at most 5.
// - One deadline for the whole call, and a byte cap on the body.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const blocked = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["168.63.129.16", 32], // Azure host services (wireserver, DNS, metadata)
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(prefix, bits, "ipv4");
}
for (const [prefix, bits] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // old site-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(prefix, bits, "ipv6");
}

/** IPv4 carried inside an IPv6 address (mapped, compatible, NAT64, 6to4), if any. */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const groups = expandIpv6(lower);
  if (!groups) return null;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const zeros = (n: number) => groups.slice(0, n).every((g) => g === 0);
  if (zeros(5) && groups[5] === 0xffff) return v4(groups[6], groups[7]); // ::ffff:a.b.c.d
  if (zeros(6)) return v4(groups[6], groups[7]); // ::a.b.c.d (deprecated)
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) return v4(groups[6], groups[7]);
  if (groups[0] === 0x2002) return v4(groups[1], groups[2]); // 6to4
  return null;
}

function expandIpv6(address: string): number[] | null {
  const [head, tail, extra] = address.split("::");
  if (extra !== undefined) return null;
  const parse = (part: string) => (part ? part.split(":") : []);
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  // A trailing dotted quad counts as two groups.
  const toGroups = (parts: string[]) =>
    parts.flatMap((p) => {
      if (p.includes(".")) {
        const o = p.split(".").map(Number);
        return [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
      }
      return [parseInt(p, 16)];
    });
  const l = toGroups(left);
  const r = toGroups(right);
  const fill = tail === undefined ? 0 : 8 - l.length - r.length;
  if (fill < 0) return null;
  const groups = [...l, ...Array(fill).fill(0), ...r];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** True when an outbound request may connect to this IP address. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped ::ffff:0:0/96 and IPv4-translated ::ffff:0:0:0/96 are
    // refused outright (checked here: a BlockList rule for the mapped range
    // would also match every plain IPv4 address). Real DNS never answers with them.
    const g = expandIpv6(address.toLowerCase());
    if (g && g.slice(0, 4).every((x) => x === 0) && ((g[4] === 0 && g[5] === 0xffff) || (g[4] === 0xffff && g[5] === 0))) return false;
    if (blocked.check(address, "ipv6")) return false;
    const v4 = embeddedIpv4(address);
    return v4 ? isPublicAddress(v4) : true;
  }
  return false;
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|intranet|corp|lan)$/i;

export type SafeFetchOptions = {
  /** Whole call, including redirects and the body (default 10s). */
  timeoutMs?: number;
  /** Body cap in bytes; more is an error (default 5 MB). */
  maxBytes?: number;
  /** Default 5. */
  maxRedirects?: number;
  /** Resolve as soon as the status and headers arrive; the body is dropped (link checks). */
  discardBody?: boolean;
  /** Tests only: replace the address rule. */
  isAllowedAddress?: (address: string) => boolean;
  /** Tests only: replace DNS. */
  lookup?: typeof dns.lookup;
  /** Tests only: allow a non-default port. */
  allowAnyPort?: boolean;
};

type Init = { method?: "GET" | "HEAD"; headers?: Record<string, string> };

/** Throws UnsafeUrlError when a URL may not be fetched; returns the parsed URL. */
export function checkOutboundUrl(raw: string | URL, opts: Pick<SafeFetchOptions, "isAllowedAddress" | "allowAnyPort"> = {}): URL {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http and https URLs are allowed");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed");
  if (url.port && !opts.allowAnyPort) throw new UnsafeUrlError("Only the default http and https ports are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!(opts.isAllowedAddress ?? isPublicAddress)(host)) throw new UnsafeUrlError("That address is not reachable from this server");
  } else if (!host.includes(".") || BLOCKED_NAMES.test(host.replace(/\.$/, ""))) {
    throw new UnsafeUrlError("That host is not reachable from this server");
  }
  return url;
}

/** DNS lookup that refuses when any answer is not allowed. Exported for tests. */
export function guardedLookup(allowed: (a: string) => boolean, base: typeof dns.lookup) {
  return ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    base(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses as dns.LookupAddress[];
      if (!list.length || list.some((a) => !allowed(a.address))) {
        return callback(Object.assign(new UnsafeUrlError("That host resolves to an address this server may not reach"), { code: "EUNSAFEADDR" }));
      }
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  }) as unknown as typeof dns.lookup;
}

const NULL_BODY = new Set([204, 205, 304]);

/**
 * fetch() for untrusted URLs. Returns a fully buffered Response. Throws
 * UnsafeUrlError for a refused URL or hop, and a plain Error for timeouts,
 * oversize bodies and network failures.
 */
export async function safeFetch(input: string | URL, init: Init = {}, opts: SafeFetchOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 5;
  const allowed = opts.isAllowedAddress ?? isPublicAddress;
  const lookup = guardedLookup(allowed, opts.lookup ?? dns.lookup);
  const deadline = Date.now() + timeoutMs;
  let method = init.method ?? "GET";

  let url = checkOutboundUrl(input, opts);
  let headers: Record<string, string> = { ...(init.headers ?? {}) };
  for (let hop = 0; ; hop++) {
    // Checked up front as well as inside the socket's own lookup (which pins
    // the address actually connected to), so a refused name never reaches a socket.
    await checkResolves(url, lookup);
    const res = await requestOnce(url, method, headers, lookup, deadline, maxBytes, opts.discardBody ?? false);
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    if (hop >= maxRedirects) throw new Error("Too many redirects");
    const next = checkOutboundUrl(new URL(location, url), opts);
    headers = headersForRedirect(url, next, headers);
    url = next;
    if (res.status === 303) method = "GET";
  }
}

function checkResolves(url: URL, lookup: typeof dns.lookup): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return Promise.resolve();
  return new Promise((resolve, reject) =>
    lookup(host, { all: true }, ((err: Error | null) => (err ? reject(err) : resolve())) as never),
  );
}

/** Headers that carry a credential; dropped on any cross-origin redirect. */
const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "private-token", "cookie"]);

/**
 * The headers to send on a redirect hop: credentials never travel to another
 * origin, and a hop from https to http with credentials is refused.
 */
export function headersForRedirect(from: URL, to: URL, headers: Record<string, string>): Record<string, string> {
  if (hasCredentials(headers) && from.protocol === "https:" && to.protocol === "http:") {
    throw new UnsafeUrlError("Refusing to follow a redirect from https to http with credentials");
  }
  return to.origin === from.origin ? headers : withoutCredentials(headers);
}

function hasCredentials(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((k) => CREDENTIAL_HEADERS.has(k.toLowerCase()));
}

function withoutCredentials(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.has(k.toLowerCase())));
}

function requestOnce(
  url: URL,
  method: string,
  headers: Record<string, string>,
  lookup: typeof dns.lookup,
  deadline: number,
  maxBytes: number,
  discardBody: boolean,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new Error("Request timed out"));
    const mod = url.protocol === "https:" ? https : http;
    const toHeaders = (raw: http.IncomingHttpHeaders) => {
      const out = new Headers();
      for (const [k, v] of Object.entries(raw)) {
        if (v === undefined) continue;
        for (const value of Array.isArray(v) ? v : [v]) out.append(k, value);
      }
      return out;
    };
    const statusOf = (code: number | undefined) => (code === undefined || code < 200 || code > 599 ? 502 : code);
    const req = mod.request(url, { method, headers, lookup, agent: false }, (res) => {
      if (discardBody) {
        clearTimeout(timer);
        resolve(new Response(null, { status: statusOf(res.statusCode), headers: toHeaders(res.headers) }));
        res.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let failed = false;
      const tooBig = () => {
        failed = true;
        clearTimeout(timer);
        reject(new Error(`Response larger than ${maxBytes} bytes`));
        res.destroy();
      };
      if (Number(res.headers["content-length"]) > maxBytes) return tooBig();
      res.on("data", (chunk: Buffer) => {
        if (failed) return;
        size += chunk.length;
        if (size > maxBytes) return tooBig();
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (failed) return;
        clearTimeout(timer);
        const status = statusOf(res.statusCode);
        const body = NULL_BODY.has(status) || method === "HEAD" ? null : Buffer.concat(chunks);
        resolve(new Response(body, { status, headers: toHeaders(res.headers) }));
      });
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new Error("Request timed out")), remaining);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}
