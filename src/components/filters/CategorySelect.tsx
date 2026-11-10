"use client";

// UI07.2: the category filter has a visible label tied to it ("Category,
// All Categories"; axe `button-name` before), and each option shows the
// category's own color (--cd-cat-* tokens). Categories with no projects stay
// listed and disabled, as before.
import React, { useId } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROJECT_CATEGORIES, ProjectCategory } from "@/constants/project-categories";

interface CategorySelectProps {
  value: ProjectCategory | "all";
  onValueChange: (value: ProjectCategory | "all") => void;
  triggerClassName?: string;
  /** Show the "Category" label above the control. When false it is screen-reader only. */
  showLabel?: boolean;
  /** Kept for callers; the options always show the category color now. */
  showPills?: boolean;
  hasCategoryProjects?: (category: string) => boolean;
}

export function CategorySelect({
  value,
  onValueChange,
  triggerClassName = "w-[180px]",
  showLabel = true,
  hasCategoryProjects,
}: CategorySelectProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const triggerId = `${id}-trigger`;
  return (
    <div className="cd-field">
      <span id={labelId} className={showLabel ? "cd-field-label" : "sr-only"}>
        Category
      </span>
      <Select value={value} onValueChange={(v) => onValueChange(v as ProjectCategory | "all")}>
        <SelectTrigger id={triggerId} aria-labelledby={`${labelId} ${triggerId}`} className={triggerClassName}>
          <SelectValue placeholder="Filter by category" />
        </SelectTrigger>
        <SelectContent className="cd-foundations">
          <SelectGroup>
            <SelectItem value="all" className="cursor-pointer min-h-11">
              All Categories
            </SelectItem>
            {Object.entries(PROJECT_CATEGORIES).map(([key, { label }]) => {
              const disabled = hasCategoryProjects ? !hasCategoryProjects(key) : false;
              return (
                <SelectItem key={key} value={key} disabled={disabled} className="cursor-pointer min-h-11">
                  <span className="cd-cat cd-cat-dot" data-category={key} aria-hidden="true" style={{ marginBlockStart: 0 }} />
                  {label}
                  {disabled && <span className="sr-only">, no projects</span>}
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
