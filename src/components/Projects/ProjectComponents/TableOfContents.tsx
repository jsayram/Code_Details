"use client";

/**
 * Table of Contents Component
 * Sticky sidebar for desktop, FAB overlay for mobile
 * Uses IntersectionObserver for scroll-spy functionality
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { scrollMotion } from "@/lib/reduced-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  List,
  X,
  Image as ImageIcon,
  FileText,
  Link2,
  Settings2,
  Tags,
  Info,
  Clock,
  BookOpen,
} from "lucide-react";

export interface TOCSection {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface TableOfContentsProps {
  sections: TOCSection[];
  className?: string;
}

// Default sections for project view
export const DEFAULT_PROJECT_SECTIONS: TOCSection[] = [
  { id: "architecture-docs", label: "Docs", icon: <BookOpen className="h-4 w-4" /> },
  { id: "images", label: "Images", icon: <ImageIcon className="h-4 w-4" /> },
  { id: "about", label: "About", icon: <FileText className="h-4 w-4" /> },
  { id: "links", label: "Links", icon: <Link2 className="h-4 w-4" /> },
  { id: "category-fields", label: "Details", icon: <Settings2 className="h-4 w-4" /> },
  { id: "tags", label: "Tags", icon: <Tags className="h-4 w-4" /> },
  { id: "project-info", label: "Info", icon: <Info className="h-4 w-4" /> },
  { id: "timeline", label: "Timeline", icon: <Clock className="h-4 w-4" /> },
];

export function TableOfContents({
  sections = DEFAULT_PROJECT_SECTIONS,
  className,
}: TableOfContentsProps) {
  const [activeSection, setActiveSection] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  const [visibleSections, setVisibleSections] = useState<string[]>([]);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Only list sections that exist in the DOM. The server can't check, so the
  // server render and the first client render both list every section (they
  // must match, or React discards the server HTML); the list narrows once
  // mounted.
  // UI06.2: sections that load later (images, linked docs) or drop out are
  // picked up as they change, so the list never names an empty section.
  const [presentIds, setPresentIds] = useState<string[] | null>(null);
  useEffect(() => {
    const update = () => {
      const ids = sections.filter((s) => document.getElementById(s.id) !== null).map((s) => s.id);
      setPresentIds((prev) => (prev && prev.join() === ids.join() ? prev : ids));
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [sections]);
  const existingSections = presentIds === null ? sections : sections.filter((s) => presentIds.includes(s.id));

  // Set up IntersectionObserver for scroll-spy
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        const id = entry.target.id;
        
        setVisibleSections((prev) => {
          if (entry.isIntersecting) {
            return prev.includes(id) ? prev : [...prev, id];
          } else {
            return prev.filter((s) => s !== id);
          }
        });
      });
    };

    observerRef.current = new IntersectionObserver(handleIntersection, {
      rootMargin: "-10% 0px -70% 0px", // Top 20% of viewport triggers
      threshold: 0,
    });

    // Observe all section elements
    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) {
        observerRef.current?.observe(element);
      }
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [sections, presentIds]);

  // Determine active section based on visible sections
  useEffect(() => {
    if (visibleSections.length === 0) {
      setActiveSection("");
      return;
    }

    // Find the first visible section in order
    const firstVisible = sections.find((s) => visibleSections.includes(s.id));
    if (firstVisible) {
      setActiveSection(firstVisible.id);
    }
  }, [visibleSections, sections]);

  // Escape closes the phone menu and puts focus back on its button.
  const fabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setIsOpen(false);
      fabRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Smooth scroll to section
  const scrollToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      const offsetTop = element.offsetTop - 100; // Account for sticky header
      window.scrollTo({
        top: offsetTop,
        behavior: scrollMotion(),
      });
      setIsOpen(false); // Close mobile menu after navigation
    }
  }, []);

  // Don't render if no sections exist
  if (existingSections.length === 0) {
    return null;
  }

  // Desktop TOC - Sticky sidebar
  const DesktopTOC = (
    <nav
      aria-labelledby="toc-heading-desktop"
      className={cn(
        "hidden lg:block sticky top-24 h-fit max-h-[calc(100vh-8rem)] overflow-auto",
        "cd-toc rounded-2xl border bg-card p-4",
        className
      )}
    >
      <h2 id="toc-heading-desktop" className="mb-3 text-sm font-semibold text-muted-foreground">
        On This Page
      </h2>
      <ul className="space-y-1">
        {existingSections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => scrollToSection(section.id)}
              aria-current={activeSection === section.id ? "location" : undefined}
              className={cn(
                "cd-toc-item flex items-center gap-2 w-full px-3 text-sm rounded-full transition-colors text-left",
                "hover:bg-accent hover:text-accent-foreground",
                activeSection === section.id
                  ? "cd-toc-current font-medium"
                  : "text-muted-foreground"
              )}
            >
              {section.icon}
              {section.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );

  // Mobile TOC - FAB with overlay
  const MobileTOC = (
    <div className="lg:hidden">
      {/* FAB Button */}
      <Button
        ref={fabRef}
        variant="default"
        size="icon"
        className="cd-toc-fab fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle table of contents"
        aria-expanded={isOpen}
        aria-controls="toc-menu-mobile"
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <List className="h-6 w-6" />
        )}
      </Button>

      {/* Overlay */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu */}
          <nav
            id="toc-menu-mobile"
            aria-labelledby="toc-heading-mobile"
            className={cn(
              "fixed bottom-24 right-6 z-50 w-64 max-w-[calc(100vw-3rem)] max-h-[60vh] overflow-auto",
              "rounded-2xl border bg-card p-4 shadow-xl",
              "animate-in slide-in-from-bottom-4 fade-in-0 duration-200"
            )}
          >
            <h2 id="toc-heading-mobile" className="mb-3 text-sm font-semibold text-muted-foreground">
              Jump to Section
            </h2>
            <ul className="space-y-1">
              {existingSections.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => scrollToSection(section.id)}
                    aria-current={activeSection === section.id ? "location" : undefined}
                    className={cn(
                      "cd-toc-item flex items-center gap-2 w-full px-3 text-sm rounded-full transition-colors text-left",
                      "hover:bg-accent hover:text-accent-foreground",
                      activeSection === section.id
                        ? "cd-toc-current font-medium"
                        : "text-muted-foreground"
                    )}
                  >
                    {section.icon}
                    {section.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </>
      )}
    </div>
  );

  return (
    <>
      {DesktopTOC}
      {MobileTOC}
    </>
  );
}
