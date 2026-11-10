import { success, databaseError, serverError } from "@/lib/api-errors";
import { convexDirectory } from "@/backend/profiles/read";
import { DATA_UNAVAILABLE } from "@/backend/projects/personal";

// H1: the proxy makes /api/profiles signed-in only, so no shared cache (CDN or
// Next's own) may keep a copy that it could hand to someone else.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // D04c: from Convex (listed projects' counters); D04a (P08 R07): public
    // columns only. E03: the Supabase directory is gone.
    const fromConvex = await convexDirectory();
    if (fromConvex === undefined) return serverError(undefined, DATA_UNAVAILABLE);
    const response = success(fromConvex);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    return databaseError(error, "Failed to fetch profiles");
  }
}
