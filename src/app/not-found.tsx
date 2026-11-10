"use client";

// UI09.3: the 404 page inside the shared shell (one main, one h1, the sidebar
// and header), on the design foundations. The mascot, its messages and the
// five-click confetti stay; the mascot is a button now, so the keyboard can
// reach it. The floating icons and gradient blob are gone (decoration only),
// and the "404" is solid text.
import "@/styles/foundations.css";
import { motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Home } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { SignedOut } from "@/components/auth/AuthGate";
import { SignInTrigger } from "@/components/auth/SignInButtonComponent";

// Fun messages the mascot can say
const mascotMessages = [
  "...you are so lost aren't you.",
  "Error 404: Humor not found... just kidding! 😄",
  "I've been waiting here for someone to find me!",
  "Plot twist: the page was inside you all along.",
  "Have you tried turning it off and on again?",
  "This page went on vacation. No forwarding address.",
  "404: Page playing hide and seek. It's winning.",
];

const CONFETTI = ["#ff6b6b", "#4ecdc4", "#ffe66d", "#95e1d3", "#f38181"];

export default function NotFound() {
  const [messageIndex, setMessageIndex] = useState(0);
  const [clickCount, setClickCount] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  // UI10: the confetti is pure movement, so reduced motion skips it; the
  // message still changes.
  const reduceMotion = useReducedMotion();

  // Cycle through messages when the mascot is pressed
  const handleMascotClick = () => {
    setMessageIndex((prev) => (prev + 1) % mascotMessages.length);
    setClickCount((prev) => prev + 1);

    // Easter egg: show confetti after 5 presses
    if (clickCount >= 4) {
      if (!reduceMotion) setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 2000);
      setClickCount(0);
    }
  };

  return (
    <AppShell>
      <div className="cd-foundations cd-canvas">
        {/* Confetti effect (Easter egg) */}
        {showConfetti && (
          <div className="fixed inset-0 pointer-events-none z-50" aria-hidden="true">
            {Array.from({ length: 50 }).map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-3 h-3 rounded-full"
                // UI10: falls by transform (y in vh) rather than animating `top`,
                // so each frame skips layout.
                style={{ top: 0, left: `${(i * 37) % 100}%`, backgroundColor: CONFETTI[i % CONFETTI.length] }}
                initial={{ y: "-5vh", rotate: 0 }}
                animate={{ y: "105vh", rotate: (i * 97) % 720, x: ((i * 53) % 200) - 100 }}
                transition={{ duration: 2 + (i % 10) / 10, ease: "easeIn" }}
              />
            ))}
          </div>
        )}

        <div className="cd-page cd-not-found">
          <p className="cd-not-found-code" aria-hidden="true">
            404
          </p>
          <h1 className="cd-title">Page not found</h1>
          <p className="cd-lead cd-muted cd-reading">Oops! This page seems to have wandered off into the digital void. 🤭</p>

          <div className="cd-not-found-mascot">
            <p className="cd-surface cd-small cd-not-found-bubble" aria-live="polite" data-testid="not-found-message">
              {mascotMessages[messageIndex]}
            </p>
            <button type="button" className="cd-not-found-mascot-button" onClick={handleMascotClick}>
              <Image src="/images/mascot.png" alt="" width={300} height={300} sizes="240px" priority className="-scale-x-100" />
              <span className="cd-caption cd-muted">
                Click me!<span className="sr-only"> Show another message</span>
              </span>
            </button>
          </div>

          <div className="cd-cluster cd-not-found-actions">
            <Button asChild size="lg">
              <Link href="/">
                <Home aria-hidden="true" />
                Back to Home
              </Link>
            </Button>
            <SignedOut>
              <SignInTrigger>
                <Button size="lg" variant="outline">
                  Sign In
                </Button>
              </SignInTrigger>
            </SignedOut>
          </div>

          <p className="cd-caption cd-muted cd-reading">
            Fun fact: The HTTP 404 error was named after a room at CERN where the original web servers were located.
            <br />
            <span className="italic">(Actually, that&apos;s a myth, but it&apos;s a fun one!)</span>
          </p>
        </div>
      </div>
    </AppShell>
  );
}
