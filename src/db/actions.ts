"use server";

import { executeQuery } from "./server";
import { project_tags } from "./schema/project_tags";
import { tags } from "./schema/tags";
import { eq } from "drizzle-orm";

// createProjectServer moved to src/db/project-write.ts as insertProjectRow
// (D03, P08 R03): as an export of this "use server" file it inserted any row,
// any owner and any link, for any caller.

/**
 * Helper function to get tag names for a project
 */
export async function getProjectTagNames(projectId: string): Promise<string[]> {
  return await executeQuery(async (db) => {
    return (
      await db
        .select({ tagName: tags.name })
        .from(project_tags)
        .innerJoin(tags, eq(project_tags.tag_id, tags.id))
        .where(eq(project_tags.project_id, projectId))
    ).map((tag) => tag.tagName);
  });
}

// getProjectBySlugServer moved to src/db/project-read.ts (D02r, P08 R09): as
// an export of this "use server" file it was a callable server action that
// trusted its viewer arguments.
// getUserById and getCachedUserById were removed (D03, SEC-D03-EMAIL): as
// exports of this "use server" file they returned any user's full profile,
// email included, to any caller who knew a user ID. The share button reads
// the session's own username instead (src/app/actions/share.ts).

// deleteProjectServer moved to src/db/project-write.ts as softDeleteProjectRow
// (D03, P08 R03): it soft-deleted any project for any caller.

// updateProjectServer moved to src/db/project-write.ts as updateProjectRow (D02,
// P08 R03): as an export of this "use server" file it wrote any column of any
// project for any caller.

// getAccessibleProjectsServer moved to src/db/project-read.ts as
// readAllActiveProjects (D04a, P08 R07): as an export of this "use server"
// file it gave any caller every owner's provider subject, profile UUID and tier.

// getUserProjectsServer moved to src/db/project-read.ts (D02r): as an export
// of this "use server" file it listed anyone's projects, deleted included.
// isProjectOwner moved to src/db/project-write.ts (D02, P08 R03).

// getProjectUsersProfileBySlugServer moved to src/db/project-read.ts (D02r):
// it returned any owner's full profile row, email included, to any caller.
