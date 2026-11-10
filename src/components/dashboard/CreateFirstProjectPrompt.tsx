"use client";

// UI08.1: the first-project prompt on the foundations. Same words, the same
// four benefits and the same link; the gradients and purple are gone, and the
// call to action is a link styled as a button (it was a button inside a link).
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Code, Sparkles, Heart, Users, TrendingUp, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";

const BENEFITS = [
  { icon: Sparkles, label: "Showcase Your Skills" },
  { icon: Heart, label: "Get Appreciated" },
  { icon: Users, label: "Connect with Devs" },
  { icon: TrendingUp, label: "Build Your Portfolio" },
];

export function CreateFirstProjectPrompt() {
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <Card className="border-2" style={{ borderColor: "var(--cd-action)" }}>
      <CardContent className="p-6 md:p-10">
        <div className="flex flex-col items-center text-center gap-6">
          <div className="p-5 rounded-2xl" style={{ background: "var(--cd-selected)" }} aria-hidden="true">
            <Code className="h-10 w-10" style={{ color: "var(--cd-on-selected)" }} />
          </div>

          <div className="cd-stack-tight items-center">
            <h2 className="cd-heading">Ready to Share Your Work?</h2>
            <p className="cd-lead cd-muted max-w-2xl">
              Your creative journey starts here! Share your first project with the community and inspire others.
            </p>
          </div>

          <ul className="grid grid-cols-2 lg:grid-cols-4 gap-3 w-full max-w-4xl">
            {BENEFITS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex flex-col items-center gap-2 p-4 rounded-xl border" style={{ borderColor: "var(--cd-border-subtle)" }}>
                <Icon className="h-6 w-6" aria-hidden="true" style={{ color: "var(--cd-action)" }} />
                <span className="cd-small font-medium">{label}</span>
              </li>
            ))}
          </ul>

          <Button asChild size="lg" className="px-8">
            <Link href="/projects/new" onClick={() => setIsNavigating(true)}>
              {isNavigating ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
                  Loading...
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5 mr-2" aria-hidden="true" />
                  Create Your First Project
                  <ArrowRight className="h-5 w-5 ml-2" aria-hidden="true" />
                </>
              )}
            </Link>
          </Button>

          <p className="cd-small cd-muted italic">
            ✨ It only takes a few minutes to share your masterpiece!
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
