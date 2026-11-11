// UI06.1: list placeholders on the foundations. They have the card's shape
// but no .project-card class and nothing to click, so neither a person nor a
// test mistakes one for a loaded card (UI02's "card didn't open" finding).
import "@/styles/foundations.css";
import React from "react";
import { PROJECTS_PER_PAGE } from "../navigation/Pagination/paginationConstants";

interface LoadingStateProps {
  itemsCount?: number;
  showTierInfo?: boolean;
  /** Leave out the controls row when the page draws its own controls. */
  showControls?: boolean;
}

const Block = ({ className = "", style }: { className?: string; style?: React.CSSProperties }) => (
  <span className={`cd-skeleton-block animate-pulse ${className}`} style={style} />
);

/** One placeholder card, the same size as a real one. */
export function ProjectCardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div className="cd-project-card cd-project-card-skeleton skeleton-fade" style={{ animationDelay: `${delay}ms` }}>
      <div className="cd-project-card-media" />
      <div className="cd-project-card-body">
        <div className="cd-project-card-meta">
          <Block className="h-8 w-24 rounded-full" />
          <Block className="h-8 w-14 rounded-full" />
        </div>
        <Block className="h-6 w-3/4" />
        {["100%", "85%", "70%"].map((width) => (
          <Block key={width} className="h-4" style={{ width }} />
        ))}
        <div className="cd-project-card-tags">
          <Block className="h-8 w-16 rounded-full" />
          <Block className="h-8 w-20 rounded-full" />
          <Block className="h-8 w-12 rounded-full" />
        </div>
      </div>
      <div className="cd-project-card-footer">
        <Block className="h-8 w-32 rounded-full" />
        <Block className="h-11 w-28 rounded-full" />
      </div>
    </div>
  );
}

export function ProjectListLoadingState({
  itemsCount = PROJECTS_PER_PAGE,
  showControls = true,
}: LoadingStateProps) {
  return (
    <div className="cd-foundations flex flex-col py-6 sm:py-10 sm:-mt-10">
      <p role="status" className="sr-only">
        Loading projects
      </p>
      <div aria-hidden="true">
        {showControls && (
          <div className="mb-6 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <Block className="h-11 w-32 rounded-full" />
            <div className="flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row sm:justify-end">
              <Block className="h-11 w-full sm:w-[180px]" />
              <Block className="h-11 w-full sm:w-[180px]" />
              <Block className="hidden h-11 w-32 md:block" />
            </div>
          </div>
        )}
        <div className="cd-card-grid">
          {Array.from({ length: itemsCount }).map((_, i) => (
            <ProjectCardSkeleton key={i} delay={i * 20} />
          ))}
        </div>
      </div>
    </div>
  );
}
