import { NextRequest } from "next/server";
import { serverError, success, invalidInput } from "@/lib/api-errors";
import { sharedProjectsQuerySchema, parseSearchParams, type SharedProjectsQueryInput } from "@/types/schemas/project";
import { ZodError } from "zod";
import { DATA_UNAVAILABLE, convexHandle, convexSharedList, personalReadsFromConvex } from "@/backend/projects/personal";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ username: string }> }
) {
  const params = await context.params;
  const username = params.username.toLowerCase();

  // Parse and validate query parameters using Zod schema
  const rawParams = parseSearchParams(request.nextUrl.searchParams);
  
  let validatedParams: SharedProjectsQueryInput;
  try {
    validatedParams = sharedProjectsQuerySchema.parse(rawParams);
  } catch (error) {
    if (error instanceof ZodError) {
      return invalidInput(error.errors.map(e => e.message).join(", "));
    }
    throw error;
  }

  const { page, limit, category, sortBy } = validatedParams;

  try {
    // D07x: from Convex. Same response shape; listed projects only, and the
    // D04b redirect for a handle given up in the last 90 days. E03: the
    // Supabase list is gone.
    if (!personalReadsFromConvex()) return serverError(undefined, DATA_UNAVAILABLE);
    const holder = await convexHandle(username);
    if (holder?.kind === "redirect") {
      return success({ redirect: true, oldUsername: username, currentUsername: holder.currentUsername });
    }
    if (!holder) return success({ data: [], pagination: { total: 0, page, limit, totalPages: 0 } });
    const { cards, total } = await convexSharedList({
      handle: username,
      ...(category && category !== "all" ? { category } : {}),
      sortBy,
      page,
      limit,
    });
    return success({
      data: cards.map((c) => ({
        project: {
          id: c.id,
          title: c.title,
          slug: c.slug,
          description: c.description,
          category: c.category,
          created_at: c.createdAt,
          updated_at: c.updatedAt,
          total_favorites: String(c.favoriteCount),
        },
        profile: c.owner
          ? { username: c.owner.username, profile_image_url: c.owner.avatarUrl, full_name: c.owner.fullName }
          : null,
        tags: c.tags,
      })),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Error fetching shared projects:", error);
    return serverError(error, "Failed to fetch shared projects");
  }
}
