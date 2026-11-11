"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { SelectProjectWithOwner, SelectUserWithProject } from "@/types/rows";
import { ProjectContent } from "./ProjectContent";

interface ProjectCreateComponentProps {
  userProfile: SelectUserWithProject;
}

export function ProjectCreateComponent({
  userProfile,
}: ProjectCreateComponentProps) {
  const router = useRouter();

  // Create an empty project template with required properties. F01-15: kept
  // stable across re-renders, because ProjectContent resets the form whenever
  // its project prop changes, and the page re-renders on every session refresh.
  const emptyProject = useMemo<SelectProjectWithOwner>(() => ({
    id: "",
    title: "",
    slug: "",
    description: "",
    category: "web",
    created_at: new Date(),
    updated_at: new Date(),
    user_id: userProfile.user_id,
    deleted_at: null,
    tags: [],
    total_favorites: "0",
    url_links: null,
    category_data: null,
    field_order: null,
  }), [userProfile.user_id]);

  return (
    <ProjectContent
      project={emptyProject}
      userProfile={userProfile}
      error={undefined}
      create={true}
    />
  );
}
