import type { MouseEvent } from "react";

/**
 * UI07: true for an ordinary left click that will navigate in this tab. A
 * click with Cmd, Ctrl, Shift or Alt, or with another button, opens a new tab
 * or window, so a link's own handler must leave it alone: no preventDefault,
 * no delay, and no "loading" spinner left turning in this tab.
 */
export function isPlainClick(e: MouseEvent<Element>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
