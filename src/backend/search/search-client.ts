// D09 S02b: the Next.js side of Code Details Search. GET /api/search and its
// facets route call the public Convex search queries with no token (results
// are the same for everyone) whenever project reads come from Convex. S02f
// (approved under Jose's delegation): search is on by default;
// CODEDETAILS_SEARCH=off turns it off (the rollback), and the routes answer 404.
import { makeFunctionReference } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { chooseProjectReadBackend } from "@/backend/projects";
import type { FacetsResult, SearchResult } from "../../../convex/search";
import type { SearchArgs } from "./search-rules";
import { TokenBucketLimiter } from "./rate-limit";

export type { FacetsResult, SearchResult };

const projectsRef = makeFunctionReference<"query", Record<string, unknown>, SearchResult>("search:projects");
const facetsRef = makeFunctionReference<"query", Record<string, unknown>, FacetsResult>("search:facets");

/** The Convex URL to search, or null when search is turned off or reads aren't on Convex (the routes answer 404). */
export function searchBackendUrl(env: Record<string, string | undefined> = process.env): string | null {
  if (env.CODEDETAILS_SEARCH === "off") return null;
  const read = chooseProjectReadBackend(env);
  return read.backend === "convex" ? read.url : null;
}

const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function runSearch(url: string, args: SearchArgs): Promise<SearchResult> {
  return fetchQuery(projectsRef, strip(args), { url });
}

export function runFacets(url: string, args: SearchArgs): Promise<FacetsResult> {
  const { q, handle, category, tags } = args;
  return fetchQuery(facetsRef, strip({ q, handle, category, tags }), { url });
}

/** The response body: the result without its ok flag. */
export function withoutOk<T extends { ok: true }>(result: T): Omit<T, "ok"> {
  const body: Partial<T> = { ...result };
  delete body.ok;
  return body as Omit<T, "ok">;
}

/** One limiter per server process, shared by both routes. */
export const searchLimiter = new TokenBucketLimiter();
