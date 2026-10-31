import { success, databaseError, serverError } from "@/lib/api-errors";
import { convexDirectory } from "@/backend/profiles/read";
import { DATA_UNAVAILABLE } from "@/backend/projects/personal";

// Next.js Route Segment Config - Cache for 5 minutes, revalidate in background
export const revalidate = 300; // 5 minutes in seconds

export async function GET() {
  try {
    // D04c: from Convex (listed projects' counters); D04a (P08 R07): public
    // columns only. E03: the Supabase directory is gone.
    const fromConvex = await convexDirectory();
    if (fromConvex === undefined) return serverError(undefined, DATA_UNAVAILABLE);
    const response = success(fromConvex);
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return response;
  } catch (error) {
    return databaseError(error, "Failed to fetch profiles");
  }
}
