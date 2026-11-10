"use client";

// UI09.3: the last resort, when the root layout itself fails. It replaces the
// whole document, so it brings its own html and body and inline styles (the
// app's stylesheets and theme don't reach it). It follows the OS color scheme.
import { useEffect } from "react";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong | Code Details</title>
        <meta name="color-scheme" content="light dark" />
      </head>
      <body style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui, sans-serif", background: "Canvas", color: "CanvasText" }}>
        <main style={{ maxWidth: "36rem", margin: "0 auto", padding: "4rem 1rem", lineHeight: 1.6 }}>
          <h1 style={{ fontSize: "1.75rem", margin: "0 0 0.5rem" }}>Code Details didn&apos;t load</h1>
          <p style={{ margin: "0 0 1.5rem" }}>Something went wrong on our side. Try again, or come back in a moment.</p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button type="button" onClick={() => retry()} style={{ minHeight: "2.75rem", padding: "0 1.25rem", borderRadius: "999px", font: "inherit", cursor: "pointer" }}>
              Try again
            </button>
            {/* A plain link: the router may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ minHeight: "2.75rem", display: "inline-flex", alignItems: "center", color: "LinkText" }}>
              Back to Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
