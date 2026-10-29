// A stand-in for Mailpit's send API on 127.0.0.1:3299 (where tests/convex/push.mjs
// points the test backend's auth emails), for manual checks against the
// isolated test server (D08F3C_MANUAL_STEPS.md). Keeps messages in memory only
// and shows them at http://127.0.0.1:3299/ (newest first, links clickable).
// Loopback only; synthetic addresses only. Don't run it while browser tests
// run: they start their own receiver on the same port.
import http from "node:http";

const PORT = 3299;
const inbox = [];
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const linkify = (text) => escape(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/v1/send") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        const m = JSON.parse(raw);
        inbox.push({ at: new Date().toISOString(), to: m.To?.[0]?.Email ?? "", subject: m.Subject ?? "", text: m.Text ?? "", tags: m.Tags ?? [] });
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ID: `fake-${inbox.length}` }));
      } catch {
        res.writeHead(400).end();
      }
    });
    return;
  }
  if (req.method === "GET" && req.url === "/api/messages") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify([...inbox].reverse()));
    return;
  }
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const items = [...inbox]
      .reverse()
      .map((m) => `<article><h2>${escape(m.subject)}</h2><p><b>To</b> ${escape(m.to)} · <b>At</b> ${escape(m.at)} · <b>Tags</b> ${escape(m.tags.join(", "))}</p><pre>${linkify(m.text)}</pre></article>`)
      .join("<hr>");
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
      .end(`<!doctype html><meta charset="utf-8"><title>Fake mail (${inbox.length})</title><style>body{font:14px system-ui;margin:24px;max-width:900px}pre{white-space:pre-wrap}</style><h1>Fake mail receiver: ${inbox.length} message(s)</h1><p>Reload to see new mail.</p>${items || "<p>No mail yet.</p>"}`);
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, "127.0.0.1", () => console.log(`fake mail receiver on http://127.0.0.1:${PORT}/`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
