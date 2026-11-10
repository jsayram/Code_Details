"use client";

import React, { useEffect, useRef, useState } from "react";

// UI10 (DESIGN.md "Motion"): home's code particles, inside the UI01 budget.
// 18 symbols on desktop and 10 on a phone (globals.css hides the rest), code
// only with no emoji, in one muted color. CSS keyframes move them with
// transform and opacity, so no JavaScript runs per frame. The markup comes
// from a fixed seed, so server and client render the same field.
//
// They stand still under reduced motion (globals.css only animates them for
// "no-preference"), and pause while the tab is hidden, the layer is
// offscreen, data saver is on, or `paused` is set by the page's button. The
// layer and every symbol ignore the pointer, so clicks reach what's below
// (F01-7).

const SYMBOLS = [
  "</>", "{ }", "( )", "[ ]", "=>", "&&", "===", "//", "/* */", "#",
  "const", "await", "async", "return", "import", "export", "fn()", "null",
  "true", "if", "git", "npm", "let", "0xff", "42", "`${}`", "?.", "::",
];

export const PARTICLE_COUNT = 18;

/** mulberry32: a small seeded generator, so every render draws the same field. */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type Particle = { symbol: string; top: string; left: string; style: React.CSSProperties };

function buildField(count: number): Particle[] {
  const rand = seeded(20261110);
  return Array.from({ length: count }, (_, i) => {
    const duration = 14 + rand() * 12; // seconds per drift cycle
    return {
      symbol: SYMBOLS[Math.floor(rand() * SYMBOLS.length)],
      // A loose grid with jitter keeps symbols spread out instead of clumping.
      top: `${4 + ((i * 37) % 90) + rand() * 4}%`,
      left: `${3 + ((i * 53) % 92) + rand() * 3}%`,
      style: {
        "--cd-particle-dx": `${(rand() * 24 - 12).toFixed(1)}px`,
        "--cd-particle-dy": `${(rand() * 24 - 12).toFixed(1)}px`,
        "--cd-particle-rot": `${(rand() * 6 - 3).toFixed(1)}deg`,
        animationDuration: `${duration.toFixed(1)}s`,
        // A negative delay starts each symbol part-way through its cycle, so
        // the field is already spread out on the first frame.
        animationDelay: `-${(rand() * duration).toFixed(1)}s`,
      } as React.CSSProperties,
    };
  });
}

const FIELD = buildField(PARTICLE_COUNT);

interface CodeParticlesProps {
  /** Set by the page's pause button. */
  paused?: boolean;
  containerClassName?: string;
}

export const CodeParticlesElement: React.FC<CodeParticlesProps> = ({ paused = false, containerClassName = "" }) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const [saveData, setSaveData] = useState(false);

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    setSaveData(connection?.saveData === true);

    let observer: IntersectionObserver | undefined;
    if (layerRef.current && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting));
      observer.observe(layerRef.current);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, []);

  const running = !(paused || hidden || offscreen || saveData);

  return (
    <div
      ref={layerRef}
      className={`cd-particles pointer-events-none absolute inset-0 z-0 overflow-hidden ${containerClassName}`}
      aria-hidden="true"
      data-decorative="code-particles"
      data-running={running ? "true" : "false"}
    >
      {FIELD.map((p, i) => (
        <span
          key={i}
          className="cd-particle absolute select-none font-mono text-sm sm:text-base"
          style={{ top: p.top, left: p.left, ...p.style }}
        >
          {p.symbol}
        </span>
      ))}
    </div>
  );
};
