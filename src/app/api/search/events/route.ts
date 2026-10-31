// D10 day one: POST /api/search/events, the browser's "results shown" and
// "result clicked" events, each checked by Convex against its search receipt.
// 404 unless search and its analytics switch are both on. Visitors sending
// Global Privacy Control or Do Not Track are answered 204 and nothing is
// stored. Always 202 otherwise, even when Convex refuses or fails: analytics
// must never show up as an error in the page.
import { NextRequest, NextResponse } from "next/server";
import { rateLimited, validationError } from "@/lib/api-errors";
import { MAX_EVENT_BATCH, MAX_EVENT_BODY_BYTES, optedOut, validVisitToken } from "@/backend/search/analytics-rules";
import { VISIT_HEADER, analyticsOn, recordClientEvents } from "@/backend/search/analytics-client";
import { clientKey } from "@/backend/search/rate-limit";
import { searchBackendUrl, searchLimiter } from "@/backend/search/search-client";

export async function POST(request: NextRequest) {
  const url = searchBackendUrl();
  if (!url || !analyticsOn()) return new NextResponse("Not Found", { status: 404 });
  if (optedOut(request.headers)) return new NextResponse(null, { status: 204 });
  const limit = searchLimiter.take(clientKey(request.headers));
  if (!limit.ok) return rateLimited("Too many requests. Please wait a moment.", limit.retryAfter);
  const visit = request.headers.get(VISIT_HEADER);
  if (!validVisitToken(visit)) return validationError([{ field: VISIT_HEADER, message: "A visit token is required" }], "invalid_request");
  const text = await request.text();
  if (text.length > MAX_EVENT_BODY_BYTES) return validationError([{ field: "events", message: "Too much data" }], "invalid_request");
  let events: unknown;
  try {
    events = (JSON.parse(text) as { events?: unknown }).events;
  } catch {
    events = undefined;
  }
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENT_BATCH) {
    return validationError([{ field: "events", message: `Send 1 to ${MAX_EVENT_BATCH} events` }], "invalid_request");
  }
  try {
    return NextResponse.json(await recordClientEvents(url, visit, events), { status: 202 });
  } catch {
    return NextResponse.json({ accepted: 0, dropped: events.length }, { status: 202 });
  }
}
