"use client";

import { useEffect, useId, useState } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// Synthetic content, including the extremes UI02 found on real screens.
const UNBROKEN_TITLE = "Unbrokenprojecttitlewithnospacesatallthatkeepsgoingandgoingforthefullonehundredcharacterlimitokay1";
const UNBROKEN_DESCRIPTION = "Unbroken".repeat(625);
const LONG_TAG = "averylongunbrokentagnamewithnospacesfiftycharsxxxx";
const LONG_LABEL = "L".repeat(100);
const MIXED_SCRIPT = "Déjà vu 日本語のプロジェクト مشروع تجريبي 한국어 🚀";
const FIFTEEN_TAGS = [LONG_TAG, "TypeScript", "React", "Next.js", "Convex", "Rust", "Swift", "Go", "Python", "Docker", "GraphQL", "Tailwind", "Postgres", "Redis", "WebGL"];

const TYPE_ROLES = [
  { role: "Display", className: "cd-display", sample: "Let's get into the { Details }", note: "36 to 64px, semibold. Home headline only." },
  { role: "Title", className: "cd-title", sample: "The journey begins here.", note: "28 to 36px, semibold. One per page." },
  { role: "Heading", className: "cd-heading", sample: "Recent projects", note: "24px, semibold." },
  { role: "Subheading", className: "cd-subheading", sample: "Weekend weather station", note: "20px, medium." },
  { role: "Lead", className: "cd-lead", sample: "A short introduction that sits under a title and sets up the page.", note: "18px, regular." },
  { role: "Body", className: "", sample: "Body text stays at 16px with generous line height, so a long project description reads comfortably on a phone and on a wide monitor.", note: "16px, line height 1.625." },
  { role: "Small", className: "cd-small", sample: "Updated three days ago by fixture-alice", note: "14px. Controls and metadata." },
  { role: "Caption", className: "cd-caption", sample: "Twelve projects in this category", note: "12px, the floor. Muted." },
];

const SPACE_STEPS = [
  ["--cd-space-1", "4px"], ["--cd-space-2", "8px"], ["--cd-space-3", "12px"], ["--cd-space-4", "16px"], ["--cd-space-5", "24px"],
  ["--cd-space-6", "32px"], ["--cd-space-7", "48px"], ["--cd-space-8", "64px"], ["--cd-space-9", "96px"],
];

const COLOR_TOKENS = [
  ["--cd-bg", "Background"], ["--cd-surface", "Surface"], ["--cd-raised", "Raised"], ["--cd-border-subtle", "Subtle border"],
  ["--cd-border-control", "Control border"], ["--cd-text", "Text"], ["--cd-muted", "Muted text"], ["--cd-action", "Action"],
  ["--cd-selected", "Selected"], ["--cd-disabled", "Disabled"], ["--cd-success", "Success"], ["--cd-warning", "Warning"], ["--cd-danger", "Danger"],
];

const CHART_TOKENS = ["--cd-chart-1", "--cd-chart-2", "--cd-chart-3", "--cd-chart-4", "--cd-chart-5"];

const MOTION_BUDGET = [
  ["Button press", "100 to 160ms", "120ms"],
  ["Menus and dropdowns", "150 to 250ms", "180ms"],
  ["Dialogs", "200 to 300ms, exits about 20% shorter", "240ms"],
  ["Particles (UI04, home only)", "18 desktop, 10 phone, CSS transform only", "Not built here"],
];

function Section({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className="cd-section cd-stack" aria-labelledby={id}>
      <div className="cd-stack-tight cd-reading">
        <h2 id={id} className="cd-heading">{title}</h2>
        <p className="cd-muted">{intro}</p>
      </div>
      {children}
    </section>
  );
}

function ProjectSample({ title, description, tags, label, dir }: { title: string; description: string; tags: string[]; label?: string; dir?: "auto" }) {
  return (
    <article className="cd-surface cd-stack">
      <div className="cd-stack-tight">
        <h3 className="cd-subheading cd-wrap" dir={dir}>{title}</h3>
        <p className="cd-small cd-muted cd-wrap cd-clamp" dir={dir}>{description}</p>
      </div>
      <ul className="cd-cluster" aria-label="Tags">
        {tags.map((tag) => <li key={tag} className="cd-tag">{tag}</li>)}
      </ul>
      {label ? <a className="cd-link cd-small cd-wrap" href="#foundations-top">{label}</a> : null}
      <div className="cd-cluster">
        <Button size="sm">View project</Button>
        <Button size="sm" variant="outline">Share</Button>
      </div>
    </article>
  );
}

export function FoundationsGallery() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  useEffect(() => setMounted(true), []);

  return (
    <div className="cd-foundations cd-canvas" data-density={density}>
      <main className="cd-page" id="foundations-top">
        <header className="cd-stack">
          <div className="cd-stack-tight cd-reading">
            <h1 className="cd-title">Design foundations</h1>
            <p className="cd-lead cd-muted">Type, spacing, color and controls for the UI refresh. Everything on this page is synthetic. No existing page uses it yet.</p>
          </div>
          <div className="cd-cluster">
            <div className="cd-cluster" role="group" aria-label="Theme">
              <Button variant={mounted && resolvedTheme === "light" ? "default" : "outline"} aria-pressed={mounted && resolvedTheme === "light"} onClick={() => setTheme("light")}>Light</Button>
              <Button variant={mounted && resolvedTheme === "dark" ? "default" : "outline"} aria-pressed={mounted && resolvedTheme === "dark"} onClick={() => setTheme("dark")}>Dark</Button>
            </div>
            <div className="cd-cluster" role="group" aria-label="Density">
              <Button variant={density === "comfortable" ? "default" : "outline"} aria-pressed={density === "comfortable"} onClick={() => setDensity("comfortable")}>Comfortable</Button>
              <Button variant={density === "compact" ? "default" : "outline"} aria-pressed={density === "compact"} onClick={() => setDensity("compact")}>Compact</Button>
            </div>
          </div>
        </header>

        <Section title="Typography" intro="One system family with no web font to download. Hierarchy comes from size, weight and color. Monospace is kept for commands and code.">
          <div className="cd-stack">
            {TYPE_ROLES.map(({ role, className, sample, note }) => (
              <div key={role} className="cd-stack-tight">
                <p className="cd-caption">{role}: {note}</p>
                <p className={className}>{sample}</p>
              </div>
            ))}
            <div className="cd-stack-tight">
              <p className="cd-caption">Command: monospace, 0.9em.</p>
              <p className="cd-code cd-wrap">git push --force origin main</p>
            </div>
            <div className="cd-stack-tight">
              <p className="cd-caption">Number: tabular figures, so columns of counts line up.</p>
              <p className="cd-number">1,204 views, 37 favorites</p>
            </div>
          </div>
        </Section>

        <Section title="Spacing and layout" intro="A 4px base with wider steps as it grows. Related things sit closer together. Pages share one width and one gutter, and text stops at a readable measure.">
          <ul className="cd-stack-tight" aria-label="Spacing scale">
            {SPACE_STEPS.map(([token, size]) => (
              <li key={token} className="cd-cluster">
                <span className="cd-caption cd-code">{size}</span>
                <span aria-hidden="true" style={{ display: "block", width: `var(${token})`, height: "0.75rem", background: "var(--cd-action)" }} />
              </li>
            ))}
          </ul>
          <div className="cd-grid">
            <ProjectSample title="Weekend weather station" description="A small dashboard that reads a backyard sensor and charts the last seven days." tags={["Python", "Raspberry Pi", "Charts"]} label="Read the build notes" />
            <ProjectSample title={UNBROKEN_TITLE} description={UNBROKEN_DESCRIPTION} tags={["Longest title", "Unbroken"]} />
            <ProjectSample title="Fifteen tags and a long link" description="The longest tag is 50 characters with no spaces, and the link label is 100." tags={FIFTEEN_TAGS} label={LONG_LABEL} />
            <ProjectSample title={MIXED_SCRIPT} description={MIXED_SCRIPT} tags={["日本語", "العربية", "한국어"]} dir="auto" />
            <article className="cd-surface cd-stack">
              <Image src="/images/mascot.png" alt="The Code Details mascot in its purple hood" width={160} height={207} loading="eager" />
              <p className="cd-small cd-muted">The mascot keeps its original colors on the new surfaces.</p>
            </article>
            <article className="cd-surface cd-stack" aria-label="Loading sample">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </article>
          </div>
          <details className="cd-surface cd-stack-tight">
            <summary className="cd-small">Full 5,000-character unbroken description</summary>
            <p className="cd-small cd-wrap cd-reading">{UNBROKEN_DESCRIPTION}</p>
          </details>
        </Section>

        <Section title="Color and surfaces" intro="Neutral surfaces with one blue for actions, links and selected states. Red, green and amber are for status only. No purple in the theme.">
          <ul className="cd-grid" aria-label="Color tokens">
            {COLOR_TOKENS.map(([token, name]) => (
              <li key={token} className="cd-cluster">
                <span aria-hidden="true" style={{ display: "block", width: "2.5rem", height: "2.5rem", borderRadius: "var(--cd-radius-control)", border: "1px solid var(--cd-border-control)", background: `var(${token})` }} />
                <span className="cd-stack-tight" style={{ gap: 0 }}>
                  <span className="cd-small">{name}</span>
                  <span className="cd-caption cd-code">{token}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="cd-cluster" role="img" aria-label="Five chart colors: blue, teal, amber, green and red">
            {CHART_TOKENS.map((token) => <span key={token} style={{ display: "block", width: "3.5rem", height: "1.5rem", borderRadius: "var(--cd-radius-pill)", background: `var(${token})` }} />)}
          </div>
          <div className="cd-cluster">
            <span className="cd-status" data-tone="success">Published</span>
            <span className="cd-status" data-tone="warning">Pending review</span>
            <span className="cd-status" data-tone="danger">In graveyard</span>
            <span className="cd-status" data-tone="selected">Selected</span>
          </div>
          <div className="cd-grid">
            <Card>
              <CardHeader>
                <CardTitle>An unchanged shadcn card</CardTitle>
                <CardDescription>This is the app&apos;s existing Card. Only the variables around it changed.</CardDescription>
              </CardHeader>
              <CardContent><Badge>Badge</Badge> <Badge variant="secondary">Secondary</Badge> <Badge variant="outline">Outline</Badge></CardContent>
            </Card>
            <Alert>
              <AlertTitle>Saved</AlertTitle>
              <AlertDescription>Your project changes are live.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTitle>That didn&apos;t work</AlertTitle>
              <AlertDescription>The upload failed. Try again.</AlertDescription>
            </Alert>
          </div>
        </Section>

        <Section title="Controls" intro="Actions are pills and normal controls still look like controls. Control borders reach 3:1, focus is always a solid 2px ring, and disabled controls stay readable.">
          <div className="cd-stack">
            <div className="cd-cluster">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
              <Button variant="destructive">Delete</Button>
            </div>
            <div className="cd-cluster">
              <Button disabled>Primary</Button>
              <Button disabled variant="outline">Outline</Button>
              <Button disabled variant="destructive">Delete</Button>
              <Button className="cd-show-focus">Focus ring</Button>
            </div>
            <div className="cd-grid">
              <div className="cd-stack-tight">
                <Label htmlFor="foundations-title">Project title</Label>
                <Input id="foundations-title" placeholder="Weekend weather station" />
              </div>
              <div className="cd-stack-tight">
                <Label htmlFor="foundations-slug">Slug</Label>
                <Input id="foundations-slug" defaultValue="taken-slug" aria-invalid="true" aria-describedby="foundations-slug-error" />
                <p id="foundations-slug-error" className="cd-error-text">That slug is already taken.</p>
              </div>
              <div className="cd-stack-tight">
                <Label htmlFor="foundations-disabled">Owner</Label>
                <Input id="foundations-disabled" defaultValue="fixture-alice" disabled />
              </div>
              <div className="cd-stack-tight">
                <Label htmlFor="foundations-category">Category</Label>
                <Select defaultValue="web">
                  <SelectTrigger id="foundations-category"><SelectValue /></SelectTrigger>
                  <SelectContent className="cd-foundations">
                    <SelectItem value="web">Web</SelectItem>
                    <SelectItem value="mobile">Mobile</SelectItem>
                    <SelectItem value="games">Games</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="cd-stack-tight cd-reading">
              <Label htmlFor="foundations-notes">Description</Label>
              <Textarea id="foundations-notes" defaultValue="What did you build, and what would you do differently next time?" />
            </div>
            <div className="cd-cluster">
              <Checkbox id="foundations-public" defaultChecked />
              <Label htmlFor="foundations-public">Show on my public page</Label>
            </div>
            <Tabs defaultValue="details">
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="images">Images</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="cd-small">Selected tabs use the same surfaces as everything else.</TabsContent>
              <TabsContent value="images" className="cd-small">Nothing here yet.</TabsContent>
            </Tabs>
            <div>
              <Dialog>
                <DialogTrigger asChild><Button variant="outline">Open a dialog</Button></DialogTrigger>
                <DialogContent className="cd-foundations">
                  <DialogHeader>
                    <DialogTitle>Move this project to the graveyard?</DialogTitle>
                    <DialogDescription>You can restore it later from the graveyard.</DialogDescription>
                  </DialogHeader>
                  <DialogFooter><Button variant="destructive">Move to graveyard</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </Section>

        <Section title="Motion budget" intro="Movement explains a change and never makes anyone wait. With reduced motion on, movement stops and everything is usable straight away.">
          <div className="cd-surface" style={{ overflowX: "auto" }} role="region" aria-label="Motion budget table" tabIndex={0}>
            <table className="cd-small" style={{ width: "100%", textAlign: "start" }}>
              <thead>
                <tr><th scope="col" style={{ textAlign: "start" }}>Item</th><th scope="col" style={{ textAlign: "start" }}>Limit</th><th scope="col" style={{ textAlign: "start" }}>Token</th></tr>
              </thead>
              <tbody>
                {MOTION_BUDGET.map(([item, limit, token]) => <tr key={item}><td>{item}</td><td>{limit}</td><td>{token}</td></tr>)}
              </tbody>
            </table>
          </div>
        </Section>
      </main>
    </div>
  );
}
