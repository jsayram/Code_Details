"use client";
import React, { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import "@/styles/shell-foundations";

// UI05: a real button with role="switch", so Tab reaches it and Space or
// Enter flips it (UI01 decision 10; first built on the preflight branch,
// d767a4b). It carries the foundations scope itself, because it also sits on
// pages whose content hasn't adopted them. The hit area is 44px tall.
export const DarkModeButton = ({ isMobile = false }) => {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  // Same size before and after mount, so nothing shifts when the theme is known.
  if (!mounted) {
    return <span className="cd-foundations cd-theme-switch" data-mobile={isMobile || undefined} aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle theme"
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="cd-foundations cd-theme-switch"
      data-mobile={isMobile || undefined}
    >
      <span className="cd-theme-switch-track" aria-hidden="true">
        <span className="cd-theme-switch-thumb">
          {isDark ? <MoonIcon className="size-3.5" /> : <SunIcon className="size-3.5" />}
        </span>
      </span>
    </button>
  );
};
