// D09 S02b: GET /api/search, Code Details Search v1 (S00.3 §3–4). Public by
// Jose's decision 3: every caller gets the same listed projects, since the
// Convex query takes no identity. A 404 while CODEDETAILS_SEARCH=on isn't set
// (development switch, off by default). Bad or unknown parameters are 400s,
// never silently dropped; past the rate limit, 429 with Retry-After.
import { NextRequest, NextResponse } from "next/server";
import { rateLimited, serverError, success, validationError } from "@/lib/api-errors";
import { checkRequest, parseSearchParams } from "@/backend/search/search-rules";
import { clientKey } from "@/backend/search/rate-limit";
import { runSearch, searchBackendUrl, searchLimiter, withoutOk } from "@/backend/search/search-client";

export async function GET(request: NextRequest) {
  const url = searchBackendUrl();
  if (!url) return new NextResponse("Not Found", { status: 404 });
  const limit = searchLimiter.take(clientKey(request.headers));
  if (!limit.ok) return rateLimited("Too many searches. Please wait a moment.", limit.retryAfter);
  const args = parseSearchParams(request.nextUrl.searchParams);
  const shape = checkRequest(args);
  if (shape.length) return validationError(shape, "invalid_request");
  try {
    const result = await runSearch(url, args);
    if (!result.ok) return validationError(result.issues, result.code);
    return success(withoutOk(result));
  } catch (error) {
    return serverError(error, "Search is unavailable right now");
  }
}
