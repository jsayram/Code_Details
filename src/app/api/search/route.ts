// D09 S02b: GET /api/search, Code Details Search v1 (S00.3 §3–4). Public by
// Jose's decision 3: every caller gets the same listed projects, since the
// Convex query takes no identity. A 404 while CODEDETAILS_SEARCH=on isn't set
// (development switch, off by default). Bad or unknown parameters are 400s,
// never silently dropped; past the rate limit, 429 with Retry-After.
// D10: with CODEDETAILS_SEARCH_ANALYTICS=on too, the search is recorded after
// the response, and a receipt comes back when the visitor sent a visit token
// (never under GPC/DNT). Recording can fail without touching the response.
import { NextRequest, NextResponse } from "next/server";
import { rateLimited, serverError, success, validationError } from "@/lib/api-errors";
import { checkRequest, decodeCursor, effectiveSort, normalizeQuery, parseSearchParams, DEFAULT_PAGE_SIZE, type SearchArgs } from "@/backend/search/search-rules";
import { clientKey } from "@/backend/search/rate-limit";
import { runSearch, searchBackendUrl, searchLimiter, withoutOk } from "@/backend/search/search-client";
import { afterResponse, analyticsContext, analyticsOn, receiptFor, recordSearch, type SearchAnalyticsContext } from "@/backend/search/analytics-client";

function record(url: string, ctx: SearchAnalyticsContext, args: SearchArgs, outcome: { status: "ok" | "error"; entityIds: string[]; hasMore: boolean }, started: number) {
  const page = args.cursor ? (decodeCursor(args.cursor, args)?.p ?? 0) : 0;
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const q = normalizeQuery(args.q);
  afterResponse(() =>
    recordSearch(url, {
      receiptId: ctx.receiptId,
      ...(ctx.visit ? { visit: ctx.visit } : {}),
      ...(ctx.interactionId ? { interactionId: ctx.interactionId } : {}),
      browse: !q,
      product: ctx.product,
      query: q,
      scope: args.handle ? "creator" : "global",
      sort: effectiveSort(args),
      filterCount: (args.category ? 1 : 0) + (args.tags?.length ?? 0),
      page,
      status: outcome.status,
      hits: outcome.entityIds.map((entityId, i) => ({ entityId, position: page * pageSize + i })),
      hasMore: outcome.hasMore,
      latencyMs: Date.now() - started,
    }),
  );
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  const url = searchBackendUrl();
  if (!url) return new NextResponse("Not Found", { status: 404 });
  const limit = searchLimiter.take(clientKey(request.headers));
  if (!limit.ok) return rateLimited("Too many searches. Please wait a moment.", limit.retryAfter);
  const args = parseSearchParams(request.nextUrl.searchParams);
  const shape = checkRequest(args);
  if (shape.length) return validationError(shape, "invalid_request");
  const ctx = analyticsOn() ? analyticsContext(request, request.nextUrl.searchParams) : null;
  try {
    const result = await runSearch(url, args);
    if (!result.ok) return validationError(result.issues, result.code);
    const entityIds = result.hits.map((h) => h.entityId);
    if (ctx) record(url, ctx, args, { status: "ok", entityIds, hasMore: !!result.nextCursor }, started);
    const receipt = ctx && normalizeQuery(args.q) ? receiptFor(ctx, entityIds.length) : null;
    return success({ ...withoutOk(result), receipt });
  } catch (error) {
    if (ctx) record(url, ctx, args, { status: "error", entityIds: [], hasMore: false }, started);
    return serverError(error, "Search is unavailable right now");
  }
}
