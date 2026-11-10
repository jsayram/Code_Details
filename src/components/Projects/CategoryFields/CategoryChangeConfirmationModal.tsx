"use client";

import * as React from "react";
import { AlertTriangle, Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCategoryFields,
  COMMON_FIELDS,
  type CategoryFieldDefinition,
} from "@/constants/project-category-fields";
import {
  PROJECT_CATEGORIES,
  type ProjectCategory,
} from "@/constants/project-categories";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface CategoryChangeConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromCategory: ProjectCategory;
  toCategory: ProjectCategory;
  currentFieldOrder: string[];
  categoryData: Record<string, unknown>;
  onConfirm: (newFieldOrder: string[]) => void;
}

interface FieldMigrationInfo {
  field: CategoryFieldDefinition;
  hasData: boolean;
  status: "kept" | "lost" | "new";
}

// =============================================================================
// Helper Functions
// =============================================================================

function hasFieldData(fieldId: string, categoryData: Record<string, unknown>): boolean {
  const value = categoryData[fieldId];
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function getCategoryLabel(category: ProjectCategory): string {
  return PROJECT_CATEGORIES[category]?.label ?? category;
}

function analyzeFieldMigration(
  fromCategory: ProjectCategory,
  toCategory: ProjectCategory,
  currentFieldOrder: string[] | undefined | null,
  categoryData: Record<string, unknown> | undefined | null
): {
  keptFields: FieldMigrationInfo[];
  removedFields: FieldMigrationInfo[];
  droppedFields: FieldMigrationInfo[];
  newFields: FieldMigrationInfo[];
} {
  const fromFields = getCategoryFields(fromCategory);
  const toFields = getCategoryFields(toCategory);
  const toFieldIds = new Set(toFields.map((f) => f.id));
  const commonFieldIds = new Set(COMMON_FIELDS.map((f) => f.id));

  const keptFields: FieldMigrationInfo[] = [];
  // C01 (Jose): filled-in fields the new category doesn't have. Their values
  // are removed when the project is saved, so the dialog names them first.
  const removedFields: FieldMigrationInfo[] = [];
  // Shown but empty fields the new category doesn't have: nothing is lost.
  const droppedFields: FieldMigrationInfo[] = [];

  // Safely handle undefined/null currentFieldOrder
  const safeFieldOrder = currentFieldOrder ?? [];
  const safeCategoryData = categoryData ?? {};

  // Analyze current visible fields
  safeFieldOrder.forEach((fieldId) => {
    const field = fromFields.find((f) => f.id === fieldId);
    if (!field) return;

    const hasData = hasFieldData(fieldId, safeCategoryData);
    if (commonFieldIds.has(fieldId) || toFieldIds.has(fieldId)) {
      keptFields.push({ field, hasData, status: "kept" });
    } else if (hasData) {
      removedFields.push({ field, hasData, status: "lost" });
    } else {
      droppedFields.push({ field, hasData, status: "lost" });
    }
  });

  // Filled-in fields that were hidden earlier are removed too.
  Object.keys(safeCategoryData).forEach((fieldId) => {
    if (safeFieldOrder.includes(fieldId) || toFieldIds.has(fieldId) || !hasFieldData(fieldId, safeCategoryData)) return;
    const field = fromFields.find((f) => f.id === fieldId) ?? { id: fieldId, label: fieldId, type: "text" as const, isCommon: false };
    removedFields.push({ field, hasData: true, status: "lost" });
  });

  // Find new fields available in the target category
  const newFields: FieldMigrationInfo[] = toFields
    .filter((f) => !safeFieldOrder.includes(f.id) && !commonFieldIds.has(f.id))
    .slice(0, 3) // Show top 3 new suggestions
    .map((field) => ({ field, hasData: false, status: "new" as const }));

  return { keptFields, removedFields, droppedFields, newFields };
}

/** C01: true when changing to `toCategory` would remove a filled-in value on save. */
export function categoryChangeRemovesData(
  toCategory: ProjectCategory,
  categoryData: Record<string, unknown> | undefined | null
): boolean {
  const toFieldIds = new Set(getCategoryFields(toCategory).map((f) => f.id));
  const data = categoryData ?? {};
  return Object.keys(data).some((fieldId) => !toFieldIds.has(fieldId) && hasFieldData(fieldId, data));
}

// =============================================================================
// Main Component
// =============================================================================

export function CategoryChangeConfirmationModal({
  open,
  onOpenChange,
  fromCategory,
  toCategory,
  currentFieldOrder,
  categoryData,
  onConfirm,
}: CategoryChangeConfirmationModalProps) {
  const { keptFields, removedFields, droppedFields, newFields } = React.useMemo(
    () =>
      analyzeFieldMigration(
        fromCategory,
        toCategory,
        currentFieldOrder,
        categoryData
      ),
    [fromCategory, toCategory, currentFieldOrder, categoryData]
  );

  const hasDataToLose = removedFields.length > 0;

  const handleConfirm = () => {
    // Build new field order: keep common + fields that exist in new category
    const toFieldIds = new Set(
      getCategoryFields(toCategory).map((f) => f.id)
    );
    const newFieldOrder = currentFieldOrder.filter((fieldId) => {
      const isCommon = COMMON_FIELDS.some((f) => f.id === fieldId);
      return isCommon || toFieldIds.has(fieldId);
    });

    onConfirm(newFieldOrder);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasDataToLose && (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            )}
            Changing Project Category
          </DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-2 mt-2">
              <Badge variant="outline">{getCategoryLabel(fromCategory)}</Badge>
              <ArrowRight className="h-4 w-4" />
              <Badge variant="default">{getCategoryLabel(toCategory)}</Badge>
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* C01: a plain scroll region. The ScrollArea here never limited its
            height, so a long list ran over the buttons. Focusable so the
            keyboard can scroll it. */}
        <div className="py-2">
          <div
            className="max-h-[min(20rem,50vh)] overflow-y-auto pr-2"
            tabIndex={0}
            role="region"
            aria-label="Fields affected by the change"
          >
            <div className="space-y-4">
              {/* Fields that will be kept */}
              {keptFields.length > 0 && (
                <FieldSection
                  title="Fields Kept"
                  subtitle="These fields will remain visible"
                  fields={keptFields}
                  variant="success"
                />
              )}

              {/* Filled-in fields the new category doesn't have */}
              {removedFields.length > 0 && (
                <FieldSection
                  title="Fields Removed When You Save"
                  subtitle={`${getCategoryLabel(toCategory)} doesn't have these fields, so their values are deleted when you save the project`}
                  fields={removedFields}
                  variant="warning"
                />
              )}

              {/* Empty fields the new category doesn't have */}
              {droppedFields.length > 0 && (
                <FieldSection
                  title="Empty Fields Hidden"
                  subtitle="Nothing is filled in here, so nothing is lost"
                  fields={droppedFields}
                  variant="info"
                />
              )}

              {/* New fields available */}
              {newFields.length > 0 && (
                <FieldSection
                  title="New Fields Available"
                  subtitle="Category-specific fields you can add"
                  fields={newFields}
                  variant="info"
                />
              )}

              {/* What happens to the removed values */}
              {hasDataToLose && (
                <div role="note" className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    <strong>Before you save:</strong> the values in{" "}
                    {removedFields.map((f) => f.field.label).join(", ")} will be deleted.
                    Fields both categories share keep their values. To keep everything,
                    switch back to{" "}
                    <span className="font-medium">{getCategoryLabel(fromCategory)}</span>{" "}
                    or cancel the edit before saving.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Change Category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Field Section Component
// =============================================================================

interface FieldSectionProps {
  title: string;
  subtitle: string;
  fields: FieldMigrationInfo[];
  variant: "success" | "warning" | "info";
}

function FieldSection({ title, subtitle, fields, variant }: FieldSectionProps) {
  const iconMap = {
    success: <Check className="h-4 w-4 text-green-500" />,
    warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    info: <ArrowRight className="h-4 w-4 text-blue-500" />,
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        {iconMap[variant]}
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{subtitle}</p>
      <div className="flex flex-wrap gap-1.5">
        {fields.map(({ field, hasData }) => (
          <Badge
            key={field.id}
            variant="secondary"
            className={cn(
              "text-xs",
              hasData && variant === "warning" && "ring-1 ring-amber-400"
            )}
          >
            {field.label}
            {hasData && (
              <span className="ml-1 text-[10px] opacity-70">•</span>
            )}
          </Badge>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Hook for managing category change
// =============================================================================

export interface UseCategoryChangeOptions {
  onCategoryChange: (
    newCategory: ProjectCategory,
    newFieldOrder: string[]
  ) => void;
}

export function useCategoryChange({
  onCategoryChange,
}: UseCategoryChangeOptions) {
  const [modalState, setModalState] = React.useState<{
    open: boolean;
    fromCategory: ProjectCategory | null;
    toCategory: ProjectCategory | null;
    currentFieldOrder: string[];
    categoryData: Record<string, unknown>;
  }>({
    open: false,
    fromCategory: null,
    toCategory: null,
    currentFieldOrder: [],
    categoryData: {},
  });

  const requestCategoryChange = React.useCallback(
    (
      fromCategory: ProjectCategory,
      toCategory: ProjectCategory,
      currentFieldOrder: string[] | undefined | null,
      categoryData: Record<string, unknown> | undefined | null
    ) => {
      // If same category, no-op
      if (fromCategory === toCategory) return;

      // Safely handle undefined/null values
      const safeFieldOrder = currentFieldOrder ?? [];
      const safeCategoryData = categoryData ?? {};

      const commonFieldIds = new Set(COMMON_FIELDS.map((f) => f.id));
      const toFieldIds = new Set(getCategoryFields(toCategory).map((f) => f.id));

      // C01: any filled-in value the new category doesn't define, shown or hidden.
      const willRemoveData = categoryChangeRemovesData(toCategory, safeCategoryData);

      if (willRemoveData) {
        // Show confirmation modal
        setModalState({
          open: true,
          fromCategory,
          toCategory,
          currentFieldOrder: safeFieldOrder,
          categoryData: safeCategoryData,
        });
      } else {
        // No data loss - proceed directly
        const newFieldOrder = safeFieldOrder.filter((fieldId) => {
          const isCommon = commonFieldIds.has(fieldId);
          return isCommon || toFieldIds.has(fieldId);
        });
        onCategoryChange(toCategory, newFieldOrder);
      }
    },
    [onCategoryChange]
  );

  const handleConfirm = React.useCallback(
    (newFieldOrder: string[]) => {
      if (modalState.toCategory) {
        onCategoryChange(modalState.toCategory, newFieldOrder);
      }
      setModalState((prev) => ({ ...prev, open: false }));
    },
    [modalState.toCategory, onCategoryChange]
  );

  const handleOpenChange = React.useCallback((open: boolean) => {
    setModalState((prev) => ({ ...prev, open }));
  }, []);

  const modalProps = modalState.fromCategory && modalState.toCategory
    ? {
        open: modalState.open,
        onOpenChange: handleOpenChange,
        fromCategory: modalState.fromCategory,
        toCategory: modalState.toCategory,
        currentFieldOrder: modalState.currentFieldOrder,
        categoryData: modalState.categoryData,
        onConfirm: handleConfirm,
      }
    : null;

  return {
    requestCategoryChange,
    modalProps,
  };
}
