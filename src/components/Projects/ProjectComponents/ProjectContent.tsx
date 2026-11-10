"use client";

// UI06.2: the public project page (view mode) is on the UI03 foundations.
// UI08.2: so are edit and create mode. Fields say what's wrong next to them
// (aria-invalid, aria-describedby), a failed save says so beside the Save
// button, and unsaved edits are guarded on Cancel, on links anywhere on the
// page and on reload or close.
import "@/styles/foundations.css";

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PROJECT_CATEGORIES,
  ProjectCategory,
} from "@/constants/project-categories";
import { categoryDataFor } from "@/constants/project-category-fields";
import { PROJECT_TEXT_LIMITS } from "@/constants/project-limits";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Heart,
  Calendar,
  User,
  Clock,
  Tags,
  ArrowLeft,
  Edit,
  Eye,
  RefreshCcwIcon,
} from "lucide-react";
import { FormattedDate } from "@/lib/FormattedDate";
import { Separator } from "@/components/ui/separator";
import { SelectProject } from "@/types/rows";
import { validateUrlFormat } from "@/lib/url-validation";
import { toast } from "sonner";
import { SignedOut, useViewerId } from "@/components/auth/AuthGate";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { createProject, updateProject } from "@/app/actions/projects";
import { TagSelector } from "./TagSelectorComponent";
import { TagInfo } from "@/types/rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { slugify } from "@/utils/stringUtils";
import { ProjectTagSubmissionButton } from "./ProjectTagSubmissionButton";
import { useProjectTagSubmissions } from "@/hooks/use-project-tag-submissions";
import { ProjectLinksManager } from "./ProjectLinksManager";
import { ProjectLinksDisplay } from "./ProjectLinksDisplay";
import { ProjectLink } from "@/types/project-links";
import { UnsavedChangesConfirmationModal } from "./UnsavedChangesConfirmationModal";
import { SelectProjectWithOwner } from "@/types/rows";
import { ProjectImagesManager } from "@/components/Projects/ProjectImages";
import { TableOfContents, DEFAULT_PROJECT_SECTIONS } from "./TableOfContents";
import {
  CategoryFieldsEditor,
  CategoryFieldsDisplay,
  useCategoryChange,
  CategoryChangeConfirmationModal,
  validateCategoryData,
  type CategoryChangeConfirmationModalProps,
} from "@/components/Projects/CategoryFields";
import { LinkedDocumentationSection } from "./LinkedDocumentationSection";

interface UserProfile extends SelectProject {
  user_id: string;
  username: string;
  full_name: string;
  profile_image_url: string;
  tier: string;
  email_address: string;
  created_at: Date;
  updated_at: Date;
}

interface ProjectContentProps {
  project: SelectProjectWithOwner | null;
  error?: string;
  userProfile?: UserProfile | null;
  create?: boolean;
}

export function ProjectContent({
  project,
  error,
  userProfile,
  create = false,
}: ProjectContentProps): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  // State management
  const [isNavigatingUser, setIsNavigatingUser] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isNavigatingAfterSave, setIsNavigatingAfterSave] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    slug: "",
    description: "",
    category: "web" as ProjectCategory,
    url_links: [] as ProjectLink[],
  });
  const [selectedTags, setSelectedTags] = useState<TagInfo[]>([]);
  
  // Category fields state (dynamic, category-aware fields)
  const [categoryData, setCategoryData] = useState<Record<string, unknown>>({});
  const [fieldOrder, setFieldOrder] = useState<string[]>([]);
  const [formErrors, setFormErrors] = useState<{
    title?: string;
    description?: string;
    category?: string;
    slug?: string;
  }>({});

  // Track original values for change detection
  const [originalFormData, setOriginalFormData] = useState({
    title: "",
    slug: "",
    description: "",
    category: "web" as ProjectCategory,
    url_links: [] as ProjectLink[],
  });
  const [originalTags, setOriginalTags] = useState<TagInfo[]>([]);
  const [originalCategoryData, setOriginalCategoryData] = useState<Record<string, unknown>>({});
  const [originalFieldOrder, setOriginalFieldOrder] = useState<string[]>([]);
  const [showUnsavedChangesModal, setShowUnsavedChangesModal] = useState(false);
  // UI08.2: where a guarded link (or Cancel on create) was going, the control
  // that opened the unsaved-changes dialog (focus goes back there, UI02
  // defect 15), and the last failed save's message, shown beside Save.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const unsavedOpenerRef = useRef<HTMLElement | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Track pending image uploads (count of images uploaded during edit session)
  const [pendingImageCount, setPendingImageCount] = useState(0);
  // Ref to call discard function on ProjectImagesManager
  const discardImagesRef = useRef<(() => Promise<void>) | null>(null);

  // Tag submissions for the project
  const {
    pendingTags,
    refreshPendingTags,
    isLoading: isLoadingPendingTags,
  } = useProjectTagSubmissions(project?.id || "");

  // Refs
  const formInitializedRef = useRef(false);
  const projectIdRef = useRef<string | null>(null);

  // Derived state with proper memoization
  // D02: the session's user ID (Clerk's userId, or the Better Auth session's,
  // which the Convex owner view puts in userProfile.user_id). The project
  // actions take the user from the session; the ID passed to them is ignored.
  const viewerId = useViewerId();
  const isOwner = useMemo(() => {
    return !!viewerId && !!userProfile?.user_id && viewerId === userProfile.user_id;
  }, [viewerId, userProfile?.user_id]);

  // Handle edit mode with useMemo to prevent unnecessary re-renders
  const isEditMode = useMemo(() => {
    // Always in edit mode if creating a new project
    if (create) return true;

    // Otherwise check URL parameter
    const shouldEdit = searchParams?.get("edit") === "true";
    return shouldEdit && isOwner;
  }, [searchParams, isOwner, create]);

  // Form field change handlers - memoized to maintain stable references
  const handleFieldChange = useCallback(
    <T extends keyof typeof formData>(
      field: T,
      value: (typeof formData)[T]
    ) => {
      setFormData((prev) => ({ ...prev, [field]: value }));

      // Clear validation error when field changes (only for error fields)
      if (field in formErrors) {
        setFormErrors((prev) => ({ ...prev, [field as keyof typeof formErrors]: undefined }));
      }
    },
    [formErrors]
  );

  // Category change hook for handling field migration
  const handleCategoryChangeConfirmed = useCallback(
    (newCategory: ProjectCategory, newFieldOrder: string[]) => {
      handleFieldChange("category", newCategory);
      setFieldOrder(newFieldOrder);
    },
    [handleFieldChange]
  );

  const { requestCategoryChange, modalProps: categoryChangeModalProps } =
    useCategoryChange({
      onCategoryChange: handleCategoryChangeConfirmed,
    });

  const handleCategoryChange = useCallback(
    (value: string) => {
      const newCategory = value as ProjectCategory;
      const currentCategory = formData.category;

      // If there's category data or field order, use the modal for confirmation.
      // C01: hidden fields with values count too, since saving removes them.
      if ((fieldOrder.length > 0 || Object.keys(categoryData).length > 0) && currentCategory !== newCategory) {
        requestCategoryChange(
          currentCategory,
          newCategory,
          fieldOrder,
          categoryData
        );
      } else {
        // No fields to migrate, just change category
        handleFieldChange("category", newCategory);
      }
    },
    [formData.category, fieldOrder, categoryData, requestCategoryChange, handleFieldChange]
  );

  // Handle tag changes with useCallback to maintain stable reference
  const handleTagsChange = useCallback((tags: TagInfo[]) => {
    setSelectedTags(tags);
  }, []);

  // Handle url_links changes
  const handleLinksChange = useCallback((links: ProjectLink[]) => {
    setFormData((prev) => ({ ...prev, url_links: links }));
  }, []);

  // Handle pending images change from ProjectImagesManager
  const handleImagesChange = useCallback((newImageCount: number) => {
    setPendingImageCount(newImageCount);
  }, []);

  // Reset form state and initialize from project data when entering edit mode
  useEffect(() => {
    if (!project) return;

    // Check if this is a new project load
    const isNewProject = project.id !== projectIdRef.current;
    
    if (isEditMode) {
      // ALWAYS reinitialize when entering edit mode to ensure fresh data
      // This fixes the issue where links don't show up after being idle
      const initialFormData = {
        title: project.title || "",
        slug: project.slug || "",
        description: project.description || "",
        category: (project.category as ProjectCategory) || "web",
        url_links: (project.url_links as ProjectLink[]) || [],
      };
      
      setFormData(initialFormData);
      setOriginalFormData(initialFormData);

      // Set tags
      const initialTags = project.tags && project.tags.length > 0
        ? project.tags.map((name) => ({
            id: `tag-${name}`, // Add unique ID to prevent React key warnings
            name,
          }))
        : [];
      setSelectedTags(initialTags);
      setOriginalTags(initialTags);

      // Set category data and field order
      const initialCategoryData = (project.category_data as Record<string, unknown>) || {};
      const initialFieldOrder = (project.field_order as string[]) || [];
      setCategoryData(initialCategoryData);
      setFieldOrder(initialFieldOrder);
      setOriginalCategoryData(initialCategoryData);
      setOriginalFieldOrder(initialFieldOrder);

      // Reset form errors
      setFormErrors({});

      // Mark as initialized and store project ID
      formInitializedRef.current = true;
      projectIdRef.current = project.id;
    } else {
      // Reset initialization flag when exiting edit mode
      formInitializedRef.current = false;
    }
  }, [project, isEditMode]);

  // Handle tag query parameter - auto-populate tag from URL
  useEffect(() => {
    if (!isEditMode) return;
    
    const tagFromUrl = searchParams?.get("tag");
    if (!tagFromUrl) return;

    // Check if tag already exists in selected tags
    const tagExists = selectedTags.some(
      (tag) => tag.name.toLowerCase() === tagFromUrl.toLowerCase()
    );

    if (!tagExists) {
      // Add the tag from URL to selected tags
      const newTag: TagInfo = {
        id: `tag-${tagFromUrl}`,
        name: tagFromUrl,
      };
      
      setSelectedTags((prev) => [...prev, newTag]);
      
      // Show a toast to inform the user
      toast.info(`Tag "${tagFromUrl}" has been added to the tag field`, {
        description: "You can save the project to save the tag to your project, or cancel the edit to discard.",
      });
    }
  }, [isEditMode, searchParams, selectedTags]);

  const generateSlug = useCallback(() => {
    if (formData.title) {
      const newSlug = slugify(formData.title);
      handleFieldChange("slug", newSlug);
    }
  }, [formData.title, handleFieldChange]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = useCallback(() => {
    // Check if any form fields changed
    const formChanged = 
      formData.title !== originalFormData.title ||
      formData.slug !== originalFormData.slug ||
      formData.description !== originalFormData.description ||
      formData.category !== originalFormData.category;

    // Check if tags changed
    const tagsChanged = 
      selectedTags.length !== originalTags.length ||
      selectedTags.some((tag, index) => tag.name !== originalTags[index]?.name);

    // Check if url_links changed
    const linksChanged = 
      formData.url_links.length !== originalFormData.url_links.length ||
      formData.url_links.some((link, index) => {
        const originalLink = originalFormData.url_links[index];
        return !originalLink || 
               link.url !== originalLink.url || 
               link.type !== originalLink.type ||
               link.label !== originalLink.label;
      });

    // Check if category data changed
    const categoryDataChanged = 
      JSON.stringify(categoryData) !== JSON.stringify(originalCategoryData);

    // Check if field order changed
    const fieldOrderChanged = 
      JSON.stringify(fieldOrder) !== JSON.stringify(originalFieldOrder);

    // Check if there are pending (unsaved) image uploads
    const hasNewImages = pendingImageCount > 0;

    return formChanged || tagsChanged || linksChanged || categoryDataChanged || fieldOrderChanged || hasNewImages;
  }, [formData, originalFormData, selectedTags, originalTags, categoryData, originalCategoryData, fieldOrder, originalFieldOrder, pendingImageCount]);

  // Handler for confirming discard of unsaved changes
  const handleConfirmDiscardChanges = useCallback(async () => {
    setShowUnsavedChangesModal(false);
    unsavedOpenerRef.current = null;

    // Discard pending images via ref
    if (pendingImageCount > 0 && discardImagesRef.current) {
      await discardImagesRef.current();
    }

    // UI08.2: a guarded link, or Cancel on create, goes where it was going.
    if (pendingHref) {
      const href = pendingHref;
      setPendingHref(null);
      setPendingImageCount(0);
      leavingRef.current = true;
      router.push(href);
      return;
    }

    // Reset form data to original project values
    if (project) {
      setFormData({
        title: project.title || "",
        slug: project.slug || "",
        description: project.description || "",
        category: (project.category as ProjectCategory) || "web",
        url_links: (project.url_links as ProjectLink[]) || [],
      });

      // Reset tags
      if (project.tags && project.tags.length > 0) {
        setSelectedTags(
          project.tags.map((name) => ({
            id: `tag-${name}`,
            name,
          }))
        );
      } else {
        setSelectedTags([]);
      }

      // Reset category data and field order
      setCategoryData((project.category_data as Record<string, unknown>) || {});
      setFieldOrder((project.field_order as string[]) || []);
      setOriginalCategoryData((project.category_data as Record<string, unknown>) || {});
      setOriginalFieldOrder((project.field_order as string[]) || []);

      // Reset form errors
      setFormErrors({});
    }
    
    // Reset pending image count
    setPendingImageCount(0);

    // Exit edit mode
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    url.searchParams.delete("tag");
    router.replace(url.pathname + url.search, {
      scroll: false,
    });
  }, [project, router, pendingImageCount, pendingHref]);

  // "Continue Editing" or Escape: nothing happens, and focus goes back to
  // what opened the dialog.
  const handleKeepEditing = useCallback(() => {
    setShowUnsavedChangesModal(false);
    setPendingHref(null);
  }, []);

  // UI08.2 (UI02 defect 6): unsaved edits were lost silently through the
  // sidebar, any other link, or a reload. While the editor has unsaved
  // changes, a same-site link opens the unsaved-changes dialog first, and a
  // reload or close gets the browser's own prompt. In-page anchors (the
  // contents list), new-tab clicks and the browser's Back button are left
  // alone: Back can't be held without rewriting history.
  const leavingRef = useRef(false);
  const dirtyRef = useRef(false);
  dirtyRef.current =
    isEditMode && !isUpdating && !isNavigatingAfterSave && !leavingRef.current && hasUnsavedChanges();
  useEffect(() => {
    if (!isEditMode) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
      e.preventDefault();
      e.stopPropagation();
      unsavedOpenerRef.current = anchor;
      setPendingHref(url.pathname + url.search + url.hash);
      setShowUnsavedChangesModal(true);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [isEditMode]);

  const handleEditModeToggle = useCallback(() => {
    // Don't allow toggling out of edit mode in create mode
    if (create) return;

    const url = new URL(window.location.href);
    const currentEditMode = searchParams?.get("edit") === "true";

    if (!currentEditMode) {
      url.searchParams.set("edit", "true");
    } else {
      // Check for unsaved changes before canceling
      if (hasUnsavedChanges()) {
        unsavedOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setShowUnsavedChangesModal(true);
        return; // Show modal, don't proceed yet
      }

      // When exiting edit mode (Cancel), reset form data to original project values
      if (project) {
        setFormData({
          title: project.title || "",
          slug: project.slug || "",
          description: project.description || "",
          category: (project.category as ProjectCategory) || "web",
          url_links: (project.url_links as ProjectLink[]) || [],
        });

        // Reset tags
        if (project.tags && project.tags.length > 0) {
          setSelectedTags(
            project.tags.map((name) => ({
              id: `tag-${name}`,
              name,
            }))
          );
        } else {
          setSelectedTags([]);
        }

        // Reset form errors
        setFormErrors({});
      }

      url.searchParams.delete("edit");
      // Remove tag parameter when exiting edit mode
      url.searchParams.delete("tag");
    }

    router.replace(url.pathname + url.search, {
      scroll: false,
    });
  }, [searchParams, router, create, project, hasUnsavedChanges]);

  // Check if we have a valid username to navigate to (handle orphaned projects)
  const navigableUsername = userProfile?.username || project?.owner_username;
  const canNavigateToUser = !!navigableUsername;

  const handleNavigateUser = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!viewerId) {
      toast.dismiss();
      toast.info(
        <div className="relative flex flex-row items-center gap-2">
          <Image
            src="/images/mascot.png"
            alt="Code Minion"
            width={50}
            height={50}
            className="relative rounded-md"
          />
          <p>You have to be logged in to view user profiles silly goose</p>
        </div>
      );
      return;
    }
    if (isNavigatingUser || !canNavigateToUser || !navigableUsername) return;
    setIsNavigatingUser(true);
    router.push(`/users/${encodeURIComponent(navigableUsername)}`);
  };

  const focusFirstError = (errors: { title?: string; slug?: string; description?: string; category?: string }) => {
    const first = (["title", "slug", "description", "category"] as const).find((f) => errors[f]);
    if (first) window.requestAnimationFrame(() => document.getElementById(first)?.focus());
  };

  const validateForm = (): boolean => {
    const errors: typeof formErrors = {};

    // Validate title
    if (!formData.title.trim() || formData.title.length < 3) {
      errors.title = "Title must be at least 3 characters";
    }

    // Validate slug
    if (!formData.slug.trim()) {
      errors.slug = "Slug is required";
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(formData.slug)) {
      errors.slug =
        "Slug must contain only lowercase letters, numbers, and hyphens";
    }

    // Validate url_links - check for empty URLs and invalid formats
    const hasEmptyLinks = formData.url_links.some(link => !link.url || link.url.trim() === '' || link.url === 'https://');
    if (hasEmptyLinks) {
      setSaveError("Please fill in all link URLs or remove empty links before saving.");
      toast.error("Please fill in all link URLs or remove empty links before saving");
      // Trigger highlighting of empty URL fields
      window.dispatchEvent(new Event('highlight-empty-links'));
      setIsUpdating(false);
      return false;
    }

    // Check for invalid URL formats
    const invalidLinks = formData.url_links.filter(link => {
      const formatResult = validateUrlFormat(link.url);
      return !formatResult.valid;
    });
    
    if (invalidLinks.length > 0) {
      setSaveError("Some links have invalid URL format. Fix the URL format or use the 'Fix URL' button before saving.");
      toast.error("Some links have invalid URL format", {
        description: "Please fix the URL format or use the 'Fix URL' button before saving",
        duration: 5000,
      });
      // Trigger highlighting of invalid URL fields
      window.dispatchEvent(new Event('highlight-invalid-links'));
      setIsUpdating(false);
      return false;
    }

    // Warn about unreachable links but don't block saving
    const unreachableLinks = formData.url_links.filter(link => link.reachable === false);
    if (unreachableLinks.length > 0) {
      toast.warning(`${unreachableLinks.length} unreachable link(s) will not be displayed on your project`, {
        description: "Fix and re-verify them or they won't appear to visitors",
        duration: 5000,
      });
    }

    // Update errors state. UI08.2: focus the first field that needs fixing.
    setFormErrors(errors);
    focusFirstError(errors);

    // Return true if no errors
    return Object.keys(errors).length === 0;
  };

  const handleSaveChanges = async () => {
    setIsUpdating(true);
    setSaveError(null);
    try {
      if (!viewerId) throw new Error("You must be logged in to update a project");

      // Re-validate all URLs before saving (in case state changed)
      const hasInvalidUrls = formData.url_links.some(link => {
        if (!link.url || link.url.trim() === '') return true;
        const formatResult = validateUrlFormat(link.url);
        return !formatResult.valid;
      });

      if (hasInvalidUrls) {
        setSaveError("Cannot save: some links have invalid URL format. Fix them or remove them before saving.");
        toast.error("Cannot save: Some links have invalid URL format", {
          description: "Please fix all URL formats or remove invalid links before saving",
          duration: 5000,
        });
        setIsUpdating(false);
        return;
      }

      // Validate the form
      if (!validateForm()) {
        setIsUpdating(false);
        return;
      }

      // Validate category data for profanity
      const categoryDataValidation = validateCategoryData(categoryData, fieldOrder);
      if (!categoryDataValidation.isValid) {
        setSaveError("Cannot save: project details contain inappropriate content. Review the Project Details fields.");
        toast.error("Cannot save: Project details contain inappropriate content", {
          description: "Please review and remove any inappropriate language from your project fields",
          duration: 5000,
        });
        setIsUpdating(false);
        return;
      }

      // Filter out unreachable links and invalid formats - only save verified reachable links with valid formats
      const validLinks = formData.url_links.filter(link => {
        // Must be reachable (not explicitly marked as unreachable)
        if (link.reachable === false) return false;
        
        // Must have valid URL format
        const formatResult = validateUrlFormat(link.url);
        return formatResult.valid;
      });

      const projectData = {
        title: formData.title,
        slug: formData.slug,
        description: formData.description,
        category: formData.category,
        tags: selectedTags.map((tag) => tag.name),
        url_links: validLinks,
        // C01 (Jose): only the fields the saved category defines. The server
        // refuses any other key, and the category-change dialog has already
        // named the filled-in fields this removes.
        category_data: categoryDataFor(formData.category, categoryData),
        field_order: fieldOrder,
      };

      console.log('ProjectContent sending data:', JSON.stringify(projectData, null, 2));

      let result;

      if (create) {
        // Create new project
        result = await createProject(projectData, viewerId ?? "");
        if (result.success) {
          toast.success("Project created successfully!");
          // Navigate to the new project if we have a slug
          setIsNavigatingAfterSave(true);
          if (result.data?.slug) {
            router.push(`/projects/${result.data.slug}`);
          } else {
            // Fallback to projects list if no slug is available
            router.push("/projects");
          }
        }
      } else {
        // Update existing project
        if (!project?.id) throw new Error("Project ID is missing");
        // D02: the Convex owner view carries the version the edit started from.
        const contentVersion = (project as { content_version?: number }).content_version;
        result = await updateProject(
          project.id,
          contentVersion === undefined ? projectData : { ...projectData, content_version: contentVersion },
          viewerId
        );
        if (result.success) {
          toast.success("Project updated successfully!");
          
          // Clear pending images count - they are now saved (no need to discard)
          setPendingImageCount(0);

          // Reset form initialization state
          formInitializedRef.current = false;

          // Exit edit mode
          const url = new URL(window.location.href);
          url.searchParams.delete("edit");
          url.searchParams.delete("tag");

          // If slug changed, navigate to new URL
          if (result.data && result.data.slug !== project.slug) {
            setIsNavigatingAfterSave(true);
            router.push(`/projects/${result.data.slug}`);
          } else {
            // If slug didn't change, refresh first to get new data, then update URL
            router.refresh();
            router.replace(url.pathname + url.search, { scroll: false });
          }
        }
      }

      if (!result.success) {
        // Parse validation errors and set form field errors
        if (result.validationErrors && Array.isArray(result.validationErrors)) {
          const newFormErrors: typeof formErrors = {};
          result.validationErrors.forEach((err: { field: string; message: string }) => {
            if (err.field === 'title') newFormErrors.title = err.message;
            if (err.field === 'description') newFormErrors.description = err.message;
            if (err.field === 'category') newFormErrors.category = err.message;
            if (err.field === 'slug') newFormErrors.slug = err.message;
          });
          setFormErrors(newFormErrors);
          focusFirstError(newFormErrors);
        }
        // Show error toast but don't throw - fail gracefully. UI08.2: and
        // beside the Save button, where it stays until the next attempt.
        setSaveError(result.error || "Failed to save project");
        toast.error(result.error || "Failed to save project");
        return;
      }
    } catch (error) {
      console.error("Error saving project:", error);
      setSaveError(error instanceof Error ? error.message : "Failed to save project");
      toast.error(
        error instanceof Error ? error.message : "Failed to save project"
      );
    } finally {
      if (!isNavigatingAfterSave) {
        setIsUpdating(false);
      }
    }
  };

  const handleCancel = () => {
    if (create) {
      // When in create mode, navigate back to projects page. UI08.2: after
      // the unsaved-changes dialog if anything was typed.
      if (hasUnsavedChanges()) {
        unsavedOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPendingHref("/projects");
        setShowUnsavedChangesModal(true);
        return;
      }
      router.push("/projects");
    } else {
      // In edit mode, just toggle back to view mode
      handleEditModeToggle();
    }
  };

  // Only show error if project is missing or there's an explicit error
  // userProfile can be null for orphaned projects (deleted users)
  if (!project || error) {
    return (
      <div className="w-full max-w-[1920px] 4xl:max-w-none mx-auto px-4 2xl:px-8 3xl:px-12 py-8">
        <Card>
          <CardContent className="py-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-destructive mb-2">
                Error
              </h2>
              <p className="text-muted-foreground">
                {error || "Project not found"}
              </p>
              <p className="text-muted-foreground">
                Please check the URL or sign in to view the project.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Handle display name for orphaned projects (no userProfile)
  const displayName =
    userProfile?.full_name ||
    userProfile?.username?.split("@")[0] ||
    project.owner_full_name ||
    project.owner_username?.split("@")[0] ||
    "Unknown User";

  // UI06.2 put view mode on the foundations; UI08.2 adds edit and create.
  const editDirty = isEditMode && hasUnsavedChanges();
  const errorCount = Object.values(formErrors).filter(Boolean).length;
  const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;
  const renderContent = () => (
    <div className="cd-foundations cd-canvas">
    <div className="cd-page cd-project-page">
      {/* Top action bar - stacks on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
      {!create && (
        <div className="flex items-center gap-2">
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleEditModeToggle}
              className="flex items-center gap-2 hover:cursor-pointer text-xs sm:text-sm"
            >
              {isEditMode ? (
                <>
                  <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden xs:inline">View Mode</span>
                  <span className="xs:hidden">View</span>
                </>
              ) : (
                <>
                  <Edit className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden xs:inline">Edit Project</span>
                  <span className="xs:hidden">Edit</span>
                </>
              )}
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 sm:gap-5">
        <Badge
          variant="secondary"
          className="cd-tag cd-cat rounded-full border"
          data-category={project.category}
        >
          {PROJECT_CATEGORIES[
            project.category as keyof typeof PROJECT_CATEGORIES
          ]?.label || project.category}
        </Badge>
        <div className="flex items-center gap-1 text-muted-foreground text-sm">
          <Heart className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
          <span>{project.total_favorites || 0}</span>
          <span className="sr-only">{Number(project.total_favorites) === 1 ? " favorite" : " favorites"}</span>
        </div>
      </div>
      </div>
      {/* Profile Header Section - Mobile responsive */}
      <div className="cd-surface mb-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6">
          {!create && (
            <button
              onClick={handleNavigateUser}
              disabled={isNavigatingUser}
              className={`relative shrink-0 ${
                isNavigatingUser
                  ? "cursor-wait"
                  : "cursor-pointer hover:opacity-80 transition-opacity"
              }`}
              aria-label="View user profile"
            >
              <Avatar className="h-16 w-16 sm:h-20 sm:w-20 md:h-24 md:w-24 border-2 sm:border-4 border-background">
                {(userProfile?.profile_image_url || project.owner_profile_image_url) ? (
                  <AvatarImage
                    src={userProfile?.profile_image_url || project.owner_profile_image_url || ""}
                    alt={displayName}
                  />
                ) : null}
                {/* UI06.2: also shown when the picture fails to load (an unreachable host). */}
                <AvatarFallback className="text-xl sm:text-2xl">
                  <User className="h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12" />
                </AvatarFallback>
              </Avatar>
              {isNavigatingUser && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-full">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </button>
          )}
          <div className="flex-1 text-center sm:text-left min-w-0">
            <div className="flex flex-col items-center sm:items-start">
              <div className="w-full">
                <h1 className="cd-title cd-wrap">
                  {create ? "Create New Project" : project.title}
                </h1>
                {!create && (
                  canNavigateToUser ? (
                    <button
                      onClick={handleNavigateUser}
                      disabled={isNavigatingUser}
                      className={`text-sm sm:text-base text-muted-foreground cd-wrap mt-1 min-h-11 sm:min-h-0 ${
                        isNavigatingUser
                          ? "cursor-wait opacity-70"
                          : "hover:text-primary hover:underline cursor-pointer"
                      }`}
                    >
                      by {displayName}
                    </button>
                  ) : (
                    <span className="text-sm sm:text-base text-muted-foreground">
                      by {displayName}
                    </span>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Project Details */}
      <div className="space-y-4 sm:space-y-6">
        {isEditMode ? (
          <>
            {/* Blog-style Edit Mode Layout - matches view mode structure */}
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_250px] lg:gap-8">
              {/* Main Content Column */}
              <div className="space-y-6 md:space-y-8 min-w-0">
                {/* Project Basics Section */}
                <Card>
                  <CardHeader>
                    <CardTitle role="heading" aria-level={2} className="cd-subheading">{create ? "Create New Project" : "Edit Project"}</CardTitle>
                    <p className="cd-small cd-muted">
                      Fields marked <span aria-hidden="true">*</span><span className="sr-only">required</span> are required.
                    </p>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="space-y-2">
                        <label htmlFor="title" className="cd-small font-medium">
                          Project Title <span aria-hidden="true" style={{ color: "var(--cd-danger)" }}>*</span>
                        </label>
                        <Input
                          id="title"
                          value={formData.title}
                          onChange={(e) => handleFieldChange("title", e.target.value)}
                          maxLength={PROJECT_TEXT_LIMITS.MAX_TITLE_LENGTH}
                          aria-required="true"
                          aria-invalid={formErrors?.title ? true : undefined}
                          aria-describedby={describedBy(formErrors?.title && "title-error", "title-count")}
                        />
                        <div className="flex justify-between gap-3 cd-caption">
                          {formErrors?.title ? (
                            <p id="title-error" className="cd-error-text">{formErrors.title}</p>
                          ) : (
                            <span />
                          )}
                          <span id="title-count" className="cd-number shrink-0">
                            {formData.title.length}/{PROJECT_TEXT_LIMITS.MAX_TITLE_LENGTH}
                            <span className="sr-only"> characters</span>
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="slug" className="cd-small font-medium">
                          Slug (URL-friendly identifier){" "}
                          <span aria-hidden="true" style={{ color: "var(--cd-danger)" }}>*</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <Input
                            id="slug"
                            value={formData.slug}
                            onChange={(e) =>
                              handleFieldChange("slug", e.target.value)
                            }
                            maxLength={PROJECT_TEXT_LIMITS.MAX_SLUG_LENGTH}
                            className="flex-1 min-w-[12rem]"
                            aria-required="true"
                            aria-invalid={formErrors?.slug ? true : undefined}
                            aria-describedby={describedBy(formErrors?.slug && "slug-error", "slug-help")}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={generateSlug}
                          >
                            <RefreshCcwIcon className="h-4 w-4 mr-1" aria-hidden="true" />
                            Generate<span className="sr-only"> slug from title</span>
                          </Button>
                        </div>
                        {formErrors?.slug && (
                          <p id="slug-error" className="cd-error-text">
                            {formErrors.slug}
                          </p>
                        )}
                        <p id="slug-help" className="cd-caption">
                          Lowercase letters, numbers and hyphens. Your project&apos;s address is /projects/{formData.slug || "your-slug"}.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="category" className="cd-small font-medium">
                          Project Category
                        </label>
                        <Select
                          value={formData.category}
                          onValueChange={handleCategoryChange}
                        >
                          <SelectTrigger
                            id="category"
                            aria-invalid={formErrors?.category ? true : undefined}
                            aria-describedby={describedBy(formErrors?.category && "category-error", "category-help")}
                          >
                            <SelectValue placeholder="Select Category" />
                          </SelectTrigger>
                          <SelectContent className="cd-foundations">
                            {Object.entries(PROJECT_CATEGORIES).map(
                              ([value, { label }]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                        {/* UI07 (Jose): the full description with its tie-break wording, where people choose. */}
                        {formErrors?.category && (
                          <p id="category-error" className="cd-error-text">{formErrors.category}</p>
                        )}
                        <p id="category-help" className="cd-small cd-muted">
                          {PROJECT_CATEGORIES[formData.category as keyof typeof PROJECT_CATEGORIES]?.description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Images Section */}
                  {/* D06-b: the session's viewer (Clerk's userId by default, Better Auth's under the switch) */}
                  {!create && project?.id && viewerId && (
                    <section id="images">
                      <ProjectImagesManager
                        projectId={project.id}
                        userId={viewerId}
                        isEditing={true}
                        onImagesChange={handleImagesChange}
                        discardRef={discardImagesRef}
                      />
                    </section>
                  )}

                  {/* About Section */}
                  <section id="about">
                    <Card>
                      <CardHeader>
                        <CardTitle role="heading" aria-level={2} className="cd-subheading">About This Project</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <label htmlFor="description" className="cd-small font-medium">
                            Description
                          </label>
                          <Textarea
                            id="description"
                            value={formData.description}
                            onChange={(e) =>
                              handleFieldChange("description", e.target.value)
                            }
                            maxLength={PROJECT_TEXT_LIMITS.MAX_DESCRIPTION_LENGTH}
                            rows={5}
                            className="resize-y"
                            aria-invalid={formErrors?.description ? true : undefined}
                            aria-describedby={describedBy(formErrors?.description && "description-error", "description-count")}
                          />
                          <div className="flex justify-between gap-3 cd-caption">
                            {formErrors?.description ? (
                              <p id="description-error" className="cd-error-text">{formErrors.description}</p>
                            ) : (
                              <span />
                            )}
                            <span id="description-count" className="cd-number shrink-0">
                              {formData.description.length}/{PROJECT_TEXT_LIMITS.MAX_DESCRIPTION_LENGTH}
                              <span className="sr-only"> characters</span>
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </section>

                  {/* Links Section */}
                  <section id="links">
                    <Card>
                      <CardHeader>
                        <CardTitle role="heading" aria-level={2} className="cd-subheading">Links</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ProjectLinksManager
                          key={`links-${isEditMode}-${project?.id || 'new'}`}
                          initialLinks={formData.url_links}
                          onChange={handleLinksChange}
                        />
                      </CardContent>
                    </Card>
                  </section>

                  {/* Category Fields Section */}
                  <section id="category-fields">
                    <Card>
                      <CardHeader>
                        <CardTitle role="heading" aria-level={2} className="cd-subheading">Project Details</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <CategoryFieldsEditor
                          category={formData.category}
                          categoryData={categoryData}
                          fieldOrder={fieldOrder}
                          onCategoryDataChange={setCategoryData}
                          onFieldOrderChange={setFieldOrder}
                        />
                      </CardContent>
                    </Card>
                  </section>

                  {/* Tags Section */}
                  <section id="tags">
                    <Card>
                      <CardHeader>
                        <CardTitle role="heading" aria-level={2} className="cd-subheading flex items-center gap-2">
                          <Tags className="h-5 w-5" aria-hidden="true" />
                          Tags
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <TagSelector
                          projectId={create ? undefined : project?.id}
                          initialTags={selectedTags.map((tag) => tag.name)}
                          onTagsChange={handleTagsChange}
                          className="w-full"
                          isOwner={isOwner}
                        />
                      </CardContent>
                    </Card>
                  </section>

                  {/* Save/Cancel Actions. UI08.2: what blocks the save, and
                      whether anything is unsaved, sit beside the buttons. */}
                  <div className="cd-stack-tight pt-2">
                    {(errorCount > 0 || saveError) && (
                      <div role="alert" className="cd-surface cd-stack-tight" style={{ borderColor: "var(--cd-danger)" }}>
                        <p className="cd-small font-semibold" style={{ color: "var(--cd-danger)" }}>
                          {create ? "The project wasn't created" : "Your changes weren't saved"}
                        </p>
                        {saveError && <p className="cd-small cd-wrap">{saveError}</p>}
                        {errorCount > 0 && (
                          <ul className="cd-small list-disc pl-5">
                            {(["title", "slug", "description", "category"] as const)
                              .filter((f) => formErrors[f])
                              .map((f) => (
                                <li key={f}>
                                  <a
                                    href={`#${f}`}
                                    className="cd-link"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      document.getElementById(f)?.focus();
                                    }}
                                  >
                                    {formErrors[f]}
                                  </a>
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <p role="status" className="cd-small cd-muted mr-auto">
                        {isUpdating ? (create ? "Creating your project…" : "Saving your changes…") : editDirty ? "Unsaved changes" : create ? "" : "No unsaved changes"}
                      </p>
                      <Button
                        variant="outline"
                        onClick={handleCancel}
                        disabled={isUpdating}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleSaveChanges} disabled={isUpdating}>
                        {isUpdating ? (
                          <span className="flex items-center gap-2">
                            <span aria-hidden="true" className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            {create ? "Creating..." : "Saving..."}
                          </span>
                        ) : create ? (
                          "Create Project"
                        ) : (
                          "Save Changes"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* TOC Column - Desktop only, sticky */}
                {!create && (
                  <aside className="hidden lg:block">
                    <TableOfContents sections={DEFAULT_PROJECT_SECTIONS} />
                  </aside>
                )}

                {/* Mobile TOC FAB */}
                {!create && (
                  <div className="lg:hidden">
                    <TableOfContents sections={DEFAULT_PROJECT_SECTIONS} />
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Blog-style View Mode Layout. The main column may shrink below
                  its content, so one long word can't widen the page (UI02
                  defect 5). */}
              <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_250px] lg:gap-8">
                {/* Main Content Column */}
                <div className="cd-project-sections min-w-0">
                  {/* Architecture Documentation Section - Featured at Top */}
                  {project.slug && (
                    <LinkedDocumentationSection
                      projectSlug={project.slug}
                      isOwner={isOwner}
                    />
                  )}

                  {/* Images Section (the manager draws the section when there are images) */}
                  <div>
                    {/* F02: signed-out visitors of a shared link see the images
                        too. The server read decides who may (listed projects,
                        else the owner); view mode never uses userId. */}
                    {project.id && (
                      <ProjectImagesManager
                        projectId={project.id}
                        userId={viewerId ?? ""}
                        isEditing={false}
                        isOwner={isOwner}
                        onEditClick={() => {
                          const url = new URL(window.location.href);
                          url.searchParams.set("edit", "true");
                          router.replace(url.pathname + url.search, { scroll: false });
                        }}
                      />
                    )}
                  </div>

                  {/* About Section */}
                  <section id="about" aria-labelledby="about-heading">
                    <h2 id="about-heading" className="cd-heading mb-3">About This Project</h2>
                    <p className={`cd-lead cd-reading cd-wrap ${project.description ? "" : "cd-muted"}`}>
                      {project.description || "No description provided"}
                    </p>
                  </section>

                  {/* Links Section */}
                  {project.url_links && (project.url_links as ProjectLink[]).length > 0 && (
                    <section id="links" aria-labelledby="links-heading">
                      <h2 id="links-heading" className="cd-heading mb-3">Links</h2>
                      <ProjectLinksDisplay links={project.url_links as ProjectLink[]} />
                    </section>
                  )}

                  {/* Category Fields Section */}
                  {project.category_data && Object.keys(project.category_data as Record<string, unknown>).length > 0 && (
                    <section id="category-fields" aria-labelledby="details-heading" className="cd-wrap">
                      <h2 id="details-heading" className="cd-heading mb-3">Project Details</h2>
                      <CategoryFieldsDisplay
                        category={project.category as ProjectCategory}
                        categoryData={project.category_data as Record<string, unknown>}
                        fieldOrder={(project.field_order as string[]) || []}
                        variant="default"
                      />
                    </section>
                  )}

                  {/* Tags Section */}
                  <section id="tags" aria-labelledby="tags-heading" className="cd-project-divided">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                      <h2 id="tags-heading" className="cd-heading flex items-center gap-2">
                        <Tags className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
                        Tags
                      </h2>
                      {!isEditMode && !create && isOwner && (
                        <ProjectTagSubmissionButton
                          projectId={project.id || ""}
                          projectTitle={project.title}
                          currentTags={project.tags || []}
                          pendingTags={pendingTags}
                          onSubmit={refreshPendingTags}
                          variant="outline"
                          size="sm"
                        />
                      )}
                    </div>
                    {project.tags && project.tags.length > 0 ? (
                      <ul className="flex flex-wrap gap-2" aria-label="Tags">
                        {project.tags.map((tag) => (
                          <li key={tag} className="cd-tag rounded-full">
                            #{tag}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="cd-muted">No tags added yet</p>
                    )}

                    {/* Pending tag submissions */}
                    {pendingTags && pendingTags.length > 0 && (
                      <div className="cd-surface mt-4 space-y-2" style={{ background: "var(--cd-raised)" }}>
                        <p className="cd-small font-medium">Pending Tag Submissions:</p>
                        <div className="flex flex-wrap gap-2">
                          {pendingTags.map((submission) => (
                            <span
                              key={submission.id}
                              className="cd-status cd-wrap"
                              data-tone="warning"
                            >
                              {submission.tag_name}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          These tags will appear on the project once approved.
                        </p>
                      </div>
                    )}
                  </section>

                  {/* Project Info Section */}
                  <section id="project-info" aria-labelledby="info-heading" className="cd-project-divided">
                    <h2 id="info-heading" className="cd-heading mb-3">Project Info</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="cd-surface">
                        <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Category</p>
                        <p className="text-sm sm:text-base font-medium">
                          {PROJECT_CATEGORIES[
                            project.category as keyof typeof PROJECT_CATEGORIES
                          ]?.label || project.category}
                        </p>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                          {PROJECT_CATEGORIES[
                            project.category as keyof typeof PROJECT_CATEGORIES
                          ]?.description}
                        </p>
                      </div>
                      <div className="cd-surface">
                        <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Engagement</p>
                        <p className="text-sm sm:text-base font-medium flex items-center gap-2">
                          <Heart className="h-4 w-4 sm:h-5 sm:w-5" style={{ color: "var(--cd-danger)" }} aria-hidden="true" />
                          {project.total_favorites || 0} favorites
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Timeline Section */}
                  <section id="timeline" aria-labelledby="timeline-heading" className="cd-project-divided">
                    <h2 id="timeline-heading" className="cd-heading mb-3 flex items-center gap-2">
                      <Clock className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
                      Timeline
                    </h2>
                    <div className="space-y-3 sm:space-y-4">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="cd-timeline-dot h-8 w-8 sm:h-10 sm:w-10 rounded-full flex items-center justify-center shrink-0" aria-hidden="true">
                          <Calendar className="h-4 w-4 sm:h-5 sm:w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-medium">Created</p>
                          <p className="text-xs sm:text-sm text-muted-foreground">
                            {project.created_at ? (
                              <FormattedDate date={project.created_at} />
                            ) : (
                              "No date available"
                            )}
                          </p>
                        </div>
                      </div>
                      {project.updated_at && (
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className="cd-timeline-dot h-8 w-8 sm:h-10 sm:w-10 rounded-full flex items-center justify-center shrink-0" aria-hidden="true">
                            <Clock className="h-4 w-4 sm:h-5 sm:w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-medium">Last Updated</p>
                            <p className="text-xs sm:text-sm text-muted-foreground">
                              <FormattedDate date={project.updated_at} />
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                {/* TOC Column - Desktop only, sticky */}
                <aside className="hidden lg:block">
                  <TableOfContents sections={DEFAULT_PROJECT_SECTIONS} />
                </aside>

                {/* Mobile TOC FAB */}
                <div className="lg:hidden">
                  <TableOfContents sections={DEFAULT_PROJECT_SECTIONS} />
                </div>
              </div>
            </>
          )}
      </div>

      {/* Unsaved Changes Confirmation Modal */}
      <UnsavedChangesConfirmationModal
        isOpen={showUnsavedChangesModal}
        onClose={handleKeepEditing}
        onConfirm={handleConfirmDiscardChanges}
        pendingImageCount={pendingImageCount}
        returnFocusRef={unsavedOpenerRef}
        leaving={pendingHref !== null}
      />

      {/* Category Change Confirmation Modal */}
      {categoryChangeModalProps && (
        <CategoryChangeConfirmationModal {...categoryChangeModalProps} />
      )}
    </div>
    </div>
  );

  return renderContent();
}
