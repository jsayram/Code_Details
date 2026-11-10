"use client";

// UI07.2: the sort control has a visible label tied to it, so its name reads
// "Sort by, Newest" (axe `button-name` before). The menu carries the
// foundations scope because it renders in a portal outside the page.
import React, { useId } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SORT_BY_OPTIONS, SortByValue } from "@/constants/sort-options";

interface SortBySelectProps {
  value: SortByValue;
  onValueChange: (value: SortByValue) => void;
  triggerClassName?: string;
  /** Show the "Sort by" label above the control. When false it is screen-reader only. */
  showLabel?: boolean;
}

export function SortBySelect({
  value,
  onValueChange,
  triggerClassName = "w-[180px]",
  showLabel = true,
}: SortBySelectProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const triggerId = `${id}-trigger`;
  return (
    <div className="cd-field">
      <span id={labelId} className={showLabel ? "cd-field-label" : "sr-only"}>
        Sort by
      </span>
      <Select value={value} onValueChange={(v) => onValueChange(v as SortByValue)}>
        <SelectTrigger id={triggerId} aria-labelledby={`${labelId} ${triggerId}`} className={triggerClassName}>
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent className="cd-foundations">
          <SelectGroup>
            {SORT_BY_OPTIONS.map(({ value, label }) => (
              <SelectItem key={value} value={value} className="cursor-pointer min-h-11">
                {label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
