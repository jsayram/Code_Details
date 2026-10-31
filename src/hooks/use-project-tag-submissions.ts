"use client";

import { useState, useEffect, useCallback } from "react";
import { SelectTagSubmission } from "@/types/rows";
import { useViewerId } from "@/components/auth/AuthGate";

/**
 * Hook to fetch and manage pending tag submissions for a project
 *
 * @param projectId The ID of the project
 * @returns Object with pending tag submissions and a refresh function
 */
export function useProjectTagSubmissions(projectId: string) {
  const [pendingTags, setPendingTags] = useState<SelectTagSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // D07-c: any signed-in viewer (Clerk or Better Auth); the server picks the
  // viewer's own suggestions from the session, so no email is sent.
  const viewerId = useViewerId();

  const fetchPendingTags = useCallback(async () => {
    if (!projectId || !viewerId) {
      setPendingTags([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/tag-submissions?status=pending`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch pending tags: ${response.status}`);
      }

      const result = await response.json();

      if (result.success && Array.isArray(result.data)) {
        setPendingTags(result.data);
      } else {
        console.error("Invalid submissions response:", result);
        setPendingTags([]);
      }
    } catch (err) {
      console.error("Error fetching pending tags:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch pending tag submissions"
      );
      setPendingTags([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, viewerId]);

  useEffect(() => {
    fetchPendingTags();
    // Removed automatic polling - use refreshPendingTags() to manually update
    // Polling was creating unnecessary API calls. Updates occur when:
    // 1. Component mounts/user navigates to project
    // 2. User manually submits a new tag (via refreshPendingTags callback)
    // 3. Admin approves/rejects tags (user can refresh page to see updates)
  }, [fetchPendingTags]);

  return {
    pendingTags,
    isLoading,
    error,
    refreshPendingTags: fetchPendingTags,
  };
}
