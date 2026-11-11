"use client";

// UI08.2: on the foundations (the yellow-on-black text failed contrast), with
// the same words, mascot and two choices. Focus goes back to whatever opened
// the dialog when it closes without leaving (UI02 defect 15: it fell to body).
import React from "react";
import { AlertTriangle } from "lucide-react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface UnsavedChangesConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Number of pending (unsaved) image uploads */
  pendingImageCount?: number;
  /** The control that opened the dialog; focus returns to it on close. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** True when discarding also leaves the page (a link, or Cancel on create). */
  leaving?: boolean;
}

export function UnsavedChangesConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  pendingImageCount = 0,
  returnFocusRef,
  leaving = false,
}: UnsavedChangesConfirmationModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="cd-foundations sm:max-w-[600px]"
        onCloseAutoFocus={(e) => {
          const el = returnFocusRef?.current;
          if (el && el.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 cd-subheading">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" style={{ color: "var(--cd-warning)" }} />
            Unsaved Changes
          </DialogTitle>
          <DialogDescription>
            You have unsaved changes that will be lost if you continue.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 flex flex-col items-center gap-4">
          {/* Mascot with speech bubble */}
          <div className="relative w-[120px] pt-6">
            <Image
              src="/images/mascot.png"
              alt=""
              width={120}
              height={120}
              className="transform -scale-x-100"
            />
            <div className="absolute top-0 left-0 cd-surface px-3 py-2" style={{ padding: "0.375rem 0.75rem" }}>
              <p className="cd-caption font-medium" style={{ color: "var(--cd-text)" }}>
                Don&apos;t lose your work!
              </p>
            </div>
          </div>

          <div className="cd-surface w-full" style={{ borderColor: "var(--cd-warning)", background: "var(--cd-warning-soft)" }}>
            <p className="cd-small font-semibold" style={{ color: "var(--cd-warning)" }}>
              Changes Detected
            </p>
            <p className="cd-small mt-1" style={{ color: "var(--cd-text)" }}>
              Your edits to title, description, category, tags, links, or images have not been saved.
              {pendingImageCount > 0 && (
                <span className="block mt-1 font-medium">
                  {pendingImageCount} uploaded {pendingImageCount === 1 ? "image" : "images"} will be deleted.
                </span>
              )}{" "}
              Are you sure you want to discard these changes{leaving ? " and leave this page" : ""}?
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Continue Editing
          </Button>
          <Button variant="destructive" onClick={onConfirm} className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Discard Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
