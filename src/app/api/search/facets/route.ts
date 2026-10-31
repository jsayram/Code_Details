// D09 S02b: GET /api/search/facets, category and tag counts for a search,
// asked on submit (S00.3 §4). Same switch, rate limit and refusals as
// /api/search; counts are exact below 1,024 candidates ("capped" above).
import { NextRequest, NextResponse } from "next/server";
import { rateLimited, serverError, success, validationError } from "@/lib/api-errors";
import { checkRequest, parseSearchParams } from "@/backend/search/search-rules";
import { clientKey } from "@/backend/search/rate-limit";
import { runFacets, searchBackendUrl, searchLimiter, withoutOk } from "@/backend/search/search-client";

export async function GET(request: NextRequest) {
  const url = searchBackendUrl();
  if (!url) return new NextResponse("Not Found", { status: 404 });
  const limit = searchLimiter.take(clientKey(request.headers));
  if (!limit.ok) return rateLimited("Too many searches. Please wait a moment.", limit.retryAfter);
  const { q, handle, category, tags } = parseSearchParams(request.nextUrl.searchParams);
  const args = { q, handle, category, tags };
  const shape = checkRequest(args);
  if (shape.length) return validationError(shape, "invalid_request");
  try {
    const result = await runFacets(url, args);
    if (!result.ok) return validationError(result.issues, result.code);
    return success(withoutOk(result));
  } catch (error) {
    return serverError(error, "Search is unavailable right now");
  }
}
