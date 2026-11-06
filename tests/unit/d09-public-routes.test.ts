// D09 S02c: which paths the proxy lets signed-out visitors reach (Jose's
// decision 3 and the master's scope answer): search, tags, the community
// list and the per-tag and per-category lists, with their data routes; the
// user directory and every personal page stay behind sign-in.
import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/backend/auth/proxy-rules";

describe("public paths after S02c", () => {
  it.each([
    "/search", "/search/", "/tags", "/tags/Next.js", "/tags/c%23", "/categories", "/categories/web", "/projects",
    "/projects/fixture-listed", "/projects/users", "/shared-projects/fixture-alice", "/api/shared-projects/fixture-alice",
    "/api/projects", "/api/categories/counts", "/api/search", "/api/search/facets", "/api/search/events",
  ])("%s is public", (p) => {
    expect(isPublicPath(p)).toBe(true);
  });

  it.each([
    "/users", "/users/fixture-alice", "/api/profiles", "/api/profiles/fixture-alice",
    "/categoriesx", "/tags/a/b", "/categories/web/extra", "/dashboard", "/github-scrapper",
    "/api/projects/test", "/api/projects/slug/x", "/api/categories/counts/extra",
    // F02: a person's project page stays gated, so the rule matches the page.
    "/projects/users/fixture-alice", "/projects/users/fixture-alice/", "/projects/users/fixture-alice/extra",
    "/PROJECTS/USERS/fixture-alice", "/api/projects/users/fixture-alice",
  ])("%s still needs sign-in", (p) => {
    expect(isPublicPath(p)).toBe(false);
  });
});
