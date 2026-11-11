// D03 (SEC-D02-XSS, defense in depth): stored project URLs are rendered as
// <a href>, so a javascript:, data: or vbscript: URL that reached the database
// some other way (old rows, a direct write) would run on click. The writes
// already refuse anything but http(s); this guard refuses it again at render.

/** The URL itself when it is an absolute http: or https: URL, otherwise undefined. */
export function safeHref(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
