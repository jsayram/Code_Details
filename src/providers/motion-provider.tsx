"use client";

import { MotionConfig } from "framer-motion";

// UI03 (decision 10): with the system's reduced motion on, every Framer Motion
// animation drops its movement and keeps its opacity and color fades.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
