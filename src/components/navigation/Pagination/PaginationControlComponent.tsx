"use client";
// UI07.3: page controls on the foundations. The pages were <a> elements with
// no href, so the keyboard skipped them, and the list held bare spans (axe
// `list`, `aria-prohibited-attr`). They are buttons in a list now, inside a
// named navigation, with the current page marked. Behavior is unchanged: the
// same pages, the same ellipsis, the same "Page n of m" on narrow phones, and
// the scroll position kept on a page change.
import "@/styles/foundations.css";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function PaginationControls({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationControlsProps) {
  const [isVerySmallScreen, setIsVerySmallScreen] = useState(false);
  const previousPageRef = useRef<number>(1);
  const [activePageState, setActivePageState] = useState(currentPage);

  // Keep active page state in sync with currentPage prop
  useEffect(() => {
    setActivePageState(currentPage);
  }, [currentPage]);

  useEffect(() => {
    if (currentPage <= totalPages) previousPageRef.current = currentPage;
  }, [currentPage, totalPages]);

  // Screen size detection
  useEffect(() => {
    const checkScreenSize = () => setIsVerySmallScreen(window.innerWidth < 640);
    checkScreenSize();
    let resizeTimeout: NodeJS.Timeout;
    const debouncedCheckScreenSize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(checkScreenSize, 100);
    };
    window.addEventListener("resize", debouncedCheckScreenSize);
    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener("resize", debouncedCheckScreenSize);
    };
  }, []);

  const handlePageChange = useCallback(
    (newPage: number) => {
      // If trying to go to a page beyond total, stay on last valid page
      if (newPage > totalPages) {
        onPageChange(previousPageRef.current);
        return;
      }
      // Don't allow invalid pages or same page navigation
      if (newPage < 1 || newPage === activePageState) return;

      const currentPosition = window.scrollY;
      setActivePageState(newPage);
      onPageChange(newPage);
      // Keep the reader where they were while the new page renders.
      requestAnimationFrame(() => {
        window.scrollTo({ top: currentPosition, behavior: "instant" });
      });
    },
    [activePageState, totalPages, onPageChange]
  );

  // Visible page numbers with gaps: first, last, and two either side of the current page.
  const getVisiblePages = useCallback(() => {
    const delta = 2;
    const range: number[] = [1];
    for (let i = Math.max(2, activePageState - delta); i <= Math.min(totalPages - 1, activePageState + delta); i++) range.push(i);
    if (totalPages > 1) range.push(totalPages);

    const withGaps: (number | "gap")[] = [];
    let prev: number | null = null;
    for (const i of range) {
      if (prev !== null) {
        if (i - prev === 2) withGaps.push(prev + 1);
        else if (i - prev > 2) withGaps.push("gap");
      }
      withGaps.push(i);
      prev = i;
    }
    return withGaps;
  }, [activePageState, totalPages]);

  if (totalPages <= 1) return null;

  const atFirst = activePageState === 1;
  const atLast = activePageState === totalPages;

  return (
    <nav aria-label="Pagination" className="cd-foundations cd-pager pagination-container">
      <ul>
        <li>
          <button
            type="button"
            className="cd-pager-button"
            onClick={() => handlePageChange(Math.max(1, activePageState - 1))}
            disabled={atFirst}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline" aria-hidden="true">Previous</span>
          </button>
        </li>

        {isVerySmallScreen ? (
          <li>
            <span className="cd-small cd-number px-2" aria-current="page">
              Page {activePageState} of {totalPages}
            </span>
          </li>
        ) : (
          getVisiblePages().map((page, index) =>
            page === "gap" ? (
              <li key={`gap-${index}`} className="cd-pager-gap" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={page}>
                <button
                  type="button"
                  className="cd-pager-button pagination-item-text"
                  onClick={() => handlePageChange(page)}
                  aria-current={activePageState === page ? "page" : undefined}
                  aria-label={`Page ${page}`}
                >
                  {page}
                </button>
              </li>
            )
          )
        )}

        <li>
          <button
            type="button"
            className="cd-pager-button"
            onClick={() => handlePageChange(Math.min(totalPages, activePageState + 1))}
            disabled={atLast}
            aria-label="Next page"
          >
            <span className="hidden sm:inline" aria-hidden="true">Next</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </nav>
  );
}
