import { NextRequest, NextResponse } from "next/server";
import { serverError, invalidInput, unauthorized } from "@/lib/api-errors";
import { projectQuerySchema, parseSearchParams, type ProjectQueryInput } from "@/types/schemas/project";
import { ZodError } from "zod";
import { betterAuthSignedIn } from "@/lib/auth-server";
import { getProjectReadBackend } from "@/backend/projects";
import { ownProjectForEdit } from "@/backend/projects/owner-edit";
import { toProjectContentProps } from "@/backend/projects/legacy-props";
import {
  DATA_UNAVAILABLE,
  convexPersonalList,
  convexPublicList,
  listResponse,
  personalListResponse,
  personalReadsFromConvex,
} from "@/backend/projects/personal";

// E03: every list and the single-project read come from Convex. The Supabase
// queries (and their Clerk-era viewer) are gone; with no local Convex the
// route refuses (fail closed).

export async function GET(request: NextRequest) {
  try {
    // Set JSON content type header
    const headers = new Headers();
    headers.set("Content-Type", "application/json");

    const { searchParams } = new URL(request.url);
    
    // Parse and validate query parameters using Zod schema
    const rawParams = parseSearchParams(searchParams);
    // Handle tags array specially since getAll returns array
    rawParams.tags = searchParams.getAll("tags");
    
    const validatedParams: ProjectQueryInput = projectQuerySchema.parse(rawParams);
    
    // D02r (P08 R08): who "my projects", "my favorites" and "my graveyard"
    // belong to comes from the session only. A userId in the query string is
    // still accepted (the client puts it in its cache key) but never used.
    // D08g4f3: under the Convex data default every branch below reads Convex
    // with the session itself, so the Supabase viewer (a Clerk-era subject,
    // which a fresh account doesn't have) isn't looked up at all.
    // D09 S02c: /api/projects is a public route now. Its personal views
    // (mine, favorites, deleted) need a live session; without one they are a
    // 401, never an empty or public list.
    const wantsPersonal = validatedParams.showFavorites || validatedParams.showDeleted || (!validatedParams.showAll && !validatedParams.username && !validatedParams.slug);
    if (wantsPersonal && (await betterAuthSignedIn()) !== true) return unauthorized("Sign in to see your own projects");

    if (!personalReadsFromConvex()) return serverError(undefined, DATA_UNAVAILABLE);

    const {
      showAll,
      slug,
      category,
      username,
      tags = [],
      showFavorites,
      showDeleted,
      sortBy,
      page,
      limit,
    } = validatedParams;

    // Log request parameters for debugging
    console.log(
      `🔍 API Request - Projects:
       - Category: ${category || "any"}
       - Viewer: from the session (Convex)
       - Username: ${username || "any"}
       - Tags: ${tags.length > 0 ? tags.join(", ") : "any"}
       - Show All: ${showAll}
       - Show Favorites: ${showFavorites}
       - Show Deleted: ${showDeleted}
       - Sort By: ${sortBy}
       - Page: ${page}
       - Limit: ${limit || "all"}`
    );

    // D08g4f3: the same read as the project page and /api/projects/slug/[slug]:
    // the owner's own project (deleted included), else the public projection.
    if (slug) {
      const own = await ownProjectForEdit(slug);
      const publicProject = own ? null : await getProjectReadBackend().getPublicProjectBySlug(slug);
      const project = own?.project ?? (publicProject ? toProjectContentProps(publicProject).project : null);
      return new NextResponse(
        JSON.stringify(project ? { success: true, data: project } : { success: false, error: "Project not found" }),
        { status: project ? 200 : 404, headers },
      );
    }

    // D02r-c: the personal views come from Convex, which learns the caller
    // from the Better Auth session. A username with favorites or the
    // graveyard narrows the viewer's own list to that owner's projects (what
    // the Supabase query did).
    const personalView = showFavorites ? "favorites" : showDeleted ? "deleted" : !showAll && !username ? "mine" : null;
    if (personalView) {
      const handle = username?.toLowerCase();
      const cards = (await convexPersonalList(personalView)).filter((c) => !handle || c.owner?.username.toLowerCase() === handle);
      const response = personalListResponse(cards, { category, tags, sortBy, page, limit });
      return new NextResponse(JSON.stringify(response), { status: 200, headers });
    }

    // D07x: the community list and its category, tag and portfolio variants,
    // so their rows carry Convex IDs the favorite, edit and lifecycle actions
    // can act on. Listed projects only; the session only marks the viewer's
    // own rows and favorites.
    const { cards, total } = await convexPublicList({
      ...(category && category !== "all" ? { category } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(username ? { handle: username } : {}),
      sortBy,
      page,
      limit,
    });
    return new NextResponse(JSON.stringify(listResponse(cards, total, page, limit)), { status: 200, headers });
  } catch (error) {
    // Handle Zod validation errors specifically
    if (error instanceof ZodError) {
      return invalidInput(error.errors.map(e => e.message).join(", "));
    }
    return serverError();
  }
}
