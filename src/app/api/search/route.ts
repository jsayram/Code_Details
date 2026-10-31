// D09 S02b: GET /api/search, Code Details Search v1 (S00.3 §3–4). Public by
// Jose's decision 3: every caller gets the same listed projects, since the
// Convex query takes no identity. A 404 while CODEDETAILS_SEARCH=on isn't set
// (development switch, off by default). Bad or unknown parameters are 400s,
// never silently dropped; past the rate limit, 429 with Retry-After.
// D10: with CODEDETAILS_SEARCH_ANALYTICS=on too, the search is recorded. When
// it earns a receipt (a visit token, never under GPC/DNT, and hits), the record
// is written before responding, so the receipt exists by the time the browser
// sends events about it; that write gets RECEIPT_WRITE_TIMEOUT_MS, and if it
// fails or runs over the search still answers, just without a receipt. Every
// other search is recorded after the response. Recording never blocks search.
import { NextRequest, NextResponse } from "next/server";
import { rateLimited, serverError, success, validationError } from "@/lib/api-errors";
import { checkRequest, decodeCursor, effectiveSort, normalizeQuery, parseSearchParams, DEFAULT_PAGE_SIZE, type SearchArgs } from "@/backend/search/search-rules";
import { clientKey } from "@/backend/search/rate-limit";
import { runSearch, searchBackendUrl, searchLimiter, withoutOk } from "@/backend/search/search-client";
import { afterResponse, analyticsContext, analyticsOn, receiptFor, recordSearch, type SearchAnalyticsContext } from "@/backend/search/analytics-client";

/** The most a receipt write may add to a search response. */
const RECEIPT_WRITE_TIMEOUT_MS = 500;

/** p's value, or null if it fails or takes longer than ms (p may still finish later; nothing waits for it). */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)))]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function recordArgs(ctx: SearchAnalyticsContext, args: SearchArgs, outcome: { status: "ok" | "error"; entityIds: string[]; hasMore: boolean }, started: number) {
  const page = args.cursor ? (decodeCursor(args.cursor, args)?.p ?? 0) : 0;
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const q = normalizeQuery(args.q);
  return {
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
  };
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
    let receipt: ReturnType<typeof receiptFor> = null;
    if (ctx) {
      const record = recordArgs(ctx, args, { status: "ok", entityIds, hasMore: !!result.nextCursor }, started);
      const wantsReceipt = !!normalizeQuery(args.q) && receiptFor(ctx, entityIds.length) !== null;
      if (wantsReceipt) {
        const stored = await withTimeout(recordSearch(url, record), RECEIPT_WRITE_TIMEOUT_MS);
        receipt = (stored as { receipt?: boolean } | null)?.receipt ? receiptFor(ctx, entityIds.length) : null;
      } else afterResponse(() => recordSearch(url, record));
    }
    return success({ ...withoutOk(result), receipt });
  } catch (error) {
    if (ctx) {
      const record = recordArgs(ctx, args, { status: "error", entityIds: [], hasMore: false }, started);
      afterResponse(() => recordSearch(url, record));
    }
    return serverError(error, "Search is unavailable right now");
  }
}
