"use client";

/**
 * Image Gallery Component
 * Grid-based image gallery with edit controls
 */

import React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Trash2,
  Star,
  ImageIcon,
  ZoomIn,
} from "lucide-react";
import Image from "next/image";
import { SelectProjectImage, IMAGE_TYPE_INFO, ASPECT_RATIO_INFO, AspectRatio } from "@/types/project-images";

/**
 * Get the CSS class for an aspect ratio
 */
function getAspectRatioClass(aspectRatio?: string | null): string {
  if (!aspectRatio || aspectRatio === "auto") {
    return "aspect-video"; // Default to 16:9 for consistency
  }
  return ASPECT_RATIO_INFO[aspectRatio as AspectRatio]?.cssClass || "aspect-video";
}

interface ImageGalleryProps {
  images: SelectProjectImage[];
  isEditing?: boolean;
  onImageClick?: (image: SelectProjectImage, index: number) => void;
  onImageDelete?: (imageId: string) => void;
  onSetCover?: (imageId: string) => void;
  className?: string;
}

export function ImageGallery({
  images,
  isEditing = false,
  onImageClick,
  onImageDelete,
  onSetCover,
  className,
}: ImageGalleryProps) {
  if (images.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center",
          className
        )}
      >
        <ImageIcon className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No images uploaded yet</p>
      </div>
    );
  }

  // Separate cover from other images
  const coverImage = images.find((img) => img.image_type === "cover");
  const otherImages = images.filter((img) => img.image_type !== "cover");

  // For edit mode, use grid layout with visible action buttons. UI08.3: each
  // thumbnail is a button that opens the preview (it was a click-only image),
  // the action buttons name the image they act on, and a file that won't load
  // shows "Image unavailable" instead of the browser's broken icon (UI02 #19).
  if (isEditing) {
    const ordered = coverImage ? [coverImage, ...otherImages] : otherImages;
    return (
      <div className={cn("space-y-4", className)}>
        {/* Grid of all images - responsive: 1 col mobile, 2 col sm, 3 col md+ */}
        <ul
          tabIndex={0}
          aria-label="Uploaded images"
          className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 max-h-[400px] sm:max-h-[500px] overflow-y-auto pr-1"
        >
          {ordered.map((image, index) => (
            <EditTile
              key={image.id}
              image={image}
              index={index}
              screenshotNumber={image.image_type === "cover" ? 0 : index - (coverImage ? 1 : 0) + 1}
              onOpen={() => onImageClick?.(image, index)}
              onDelete={onImageDelete ? () => onImageDelete(image.id) : undefined}
              onSetCover={image.image_type !== "cover" && onSetCover ? () => onSetCover(image.id) : undefined}
            />
          ))}
        </ul>

        {/* Image count */}
        <p className="cd-caption text-center">
          {images.length} {images.length === 1 ? "image" : "images"} • Click to preview
        </p>
      </div>
    );
  }

  // View mode - show cover prominently, then scrollable screenshots
  return (
    <div className={cn("space-y-4", className)}>
      {/* Cover Image */}
      {coverImage && (
        <div className="relative group">
          <div className={cn(
            "relative w-full overflow-hidden rounded-lg bg-muted",
            getAspectRatioClass(coverImage.aspect_ratio)
          )}>
            <Image
              src={coverImage.storage_url}
              alt={coverImage.alt_text || "Cover image"}
              fill
              className="object-cover cursor-pointer transition-transform hover:scale-105"
              onClick={() => onImageClick?.(coverImage, 0)}
              sizes="(max-width: 768px) 100vw, 800px"
              priority
            />
            
            {/* Cover badge */}
            <Badge className="absolute left-2 top-2 bg-primary/90">
              <Star className="h-3 w-3 mr-1 fill-current" />
              Cover
            </Badge>

            {/* Zoom indicator on hover */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
          
          {coverImage.caption && (
            <p className="mt-2 text-sm text-muted-foreground text-center">
              {coverImage.caption}
            </p>
          )}
        </div>
      )}

      {/* Screenshot Gallery - Grid view */}
      {otherImages.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Screenshots ({otherImages.length})
          </h4>
          
          {/* Grid gallery */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {otherImages.map((image, index) => (
              <div
                key={image.id}
                className="relative group cursor-pointer"
                onClick={() => onImageClick?.(image, index + (coverImage ? 1 : 0))}
              >
                <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                  <Image
                    src={image.storage_url}
                    alt={image.alt_text || `Screenshot ${index + 1}`}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                  />
                  
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One thumbnail in the editor's grid: preview, set as cover, delete. */
function EditTile({
  image,
  index,
  screenshotNumber,
  onOpen,
  onDelete,
  onSetCover,
}: {
  image: SelectProjectImage;
  index: number;
  screenshotNumber: number;
  onOpen?: () => void;
  onDelete?: () => void;
  onSetCover?: () => void;
}) {
  const [failed, setFailed] = React.useState(false);
  const isCover = image.image_type === "cover";
  const description = image.alt_text || (isCover ? "Cover image" : `Screenshot ${screenshotNumber}`);
  const typeLabel = !isCover && image.image_type !== "screenshot"
    ? IMAGE_TYPE_INFO[image.image_type as keyof typeof IMAGE_TYPE_INFO]?.label || image.image_type
    : null;
  return (
    <li className="relative min-w-0" data-image-index={index}>
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-square w-full overflow-hidden rounded-lg bg-muted cursor-pointer"
      >
        <span className="sr-only">{`Preview ${description}`}</span>
        {failed ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-sm text-muted-foreground">
            <ImageIcon className="h-6 w-6" aria-hidden="true" />
            Image unavailable
          </span>
        ) : (
          <Image
            src={image.storage_url}
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, 33vw"
            onError={() => setFailed(true)}
          />
        )}
        {isCover && (
          <Badge className="absolute left-1.5 top-1.5 text-xs" aria-hidden="true">
            <Star className="h-2.5 w-2.5 mr-0.5 fill-current" aria-hidden="true" />
            Cover
          </Badge>
        )}
        {typeLabel && (
          <Badge variant="secondary" className="absolute left-1.5 top-1.5 text-xs" aria-hidden="true">
            {typeLabel}
          </Badge>
        )}
      </button>

      {/* Action buttons - always visible, named for the image they act on */}
      <div className="absolute right-1.5 top-1.5 flex gap-1">
        {onSetCover && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-9 w-9 shadow-md"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSetCover();
            }}
            title="Set as cover"
          >
            <Star className="h-4 w-4" aria-hidden="true" style={{ color: "var(--cd-warning)" }} />
            <span className="sr-only">{`Set ${description} as cover`}</span>
          </Button>
        )}
        {onDelete && (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="h-9 w-9 shadow-md"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            title="Delete image"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{`Delete ${description}`}</span>
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * One thumbnail in the public gallery: a button that opens the viewer, with
 * a plain placeholder if the image itself fails to load (UI06.2).
 */
function GalleryTile({
  image,
  index,
  total,
  onOpen,
}: {
  image: SelectProjectImage;
  index: number;
  total: number;
  onOpen?: () => void;
}) {
  const [failed, setFailed] = React.useState(false);
  const description = image.alt_text || (image.image_type === "cover" ? "Cover image" : `Image ${index + 1}`);
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="cd-gallery-tile relative block aspect-square w-full overflow-hidden rounded-2xl bg-muted cursor-pointer group"
      >
        {/* The name comes from this text, so it always includes what's on screen. */}
        <span className="sr-only">{`Open ${description}, ${index + 1} of ${total}. `}</span>
        {failed ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-sm text-muted-foreground">
            <ImageIcon className="h-6 w-6" aria-hidden="true" />
            Image unavailable
          </span>
        ) : (
          <Image
            src={image.storage_url}
            alt=""
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 475px) 100vw, (max-width: 640px) 50vw, 33vw"
            onError={() => setFailed(true)}
          />
        )}

        {/* Hover overlay with zoom icon */}
        {!failed && (
          <span aria-hidden="true" className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-200 flex items-center justify-center">
            <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
          </span>
        )}

        {/* Cover indicator badge */}
        {image.image_type === "cover" && (
          <Badge className="absolute left-2 top-2 text-xs" aria-hidden="true">
            <Star className="h-2.5 w-2.5 mr-0.5 fill-current" aria-hidden="true" />
            Cover
          </Badge>
        )}
      </button>
    </li>
  );
}

/**
 * Instagram-style grid gallery for view mode
 * All images displayed as square thumbnails for consistent, visible display
 */
export function ImageGalleryGrid({
  images,
  onImageClick,
  className,
}: {
  images: SelectProjectImage[];
  onImageClick?: (image: SelectProjectImage, index: number) => void;
  className?: string;
}) {
  if (images.length === 0) {
    return null;
  }

  // Separate cover from screenshots for optional highlighting
  const coverImage = images.find((img) => img.image_type === "cover");
  const screenshots = images.filter((img) => img.image_type !== "cover");
  const allImages = coverImage ? [coverImage, ...screenshots] : screenshots;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Responsive grid - 1 column on mobile, 2 on sm, 3 on md+ */}
      <ul className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
        {allImages.map((image, index) => (
          <GalleryTile
            key={image.id}
            image={image}
            index={index}
            total={allImages.length}
            onOpen={() => onImageClick?.(image, index)}
          />
        ))}
      </ul>

      {/* Image count */}
      <p className="text-xs text-muted-foreground text-center">
        {allImages.length} {allImages.length === 1 ? "image" : "images"}
      </p>
    </div>
  );
}
