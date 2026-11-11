// @vitest-environment jsdom
// S04-URL audit findings 1 and 2 on ProjectSearchResults, with fetch stubbed:
// 1. A "Show more" answer that arrives after the query or category changed
//    belongs to the old search and must be dropped, never appended.
// 2. Capped facets (over 1,024 matches) count only part of the results, so a
//    category with 0 there may still have matches: none is disabled.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSearchResults } from "@/components/search/ProjectSearchResults";

// The real select is a Radix portal; this stand-in shows which keys it would disable.
vi.mock("@/components/filters/CategorySelect", () => ({
  CategorySelect: ({ hasCategoryProjects }: { hasCategoryProjects?: (k: string) => boolean }) => (
    <ul data-testid="category-select">
      {["web", "mobile"].map((k) => (
        <li key={k} data-key={k} data-disabled={hasCategoryProjects && !hasCategoryProjects(k) ? "true" : "false"} />
      ))}
    </ul>
  ),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const hit = (id: string) => ({ entityId: id, route: `/projects/${id}`, title: `Project ${id}`, description: null, category: "web", tags: [], owner: null, favoriteCount: 0 });
const page = (ids: string[], nextCursor: string | null = null) => ({ data: { hits: ids.map(hit), nextCursor, total: null, receipt: null, applied: {} } });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

type Handler = (url: URL) => Promise<Response> | Response;
let handler: Handler;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((input: string) => Promise.resolve(handler(new URL(input, "http://localhost")))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProjectSearchResults: late Show more (audit 1)", () => {
  it("drops a Show more answer that arrives after the category changed", async () => {
    let releaseMore: (r: Response) => void = () => undefined;
    handler = (url) => {
      if (url.pathname === "/api/search/facets") return json({ data: { category: { web: 3 }, facetCounts: "exact" } });
      if (url.searchParams.get("cursor")) return new Promise<Response>((resolve) => (releaseMore = resolve));
      if (url.searchParams.get("category") === "web") return json(page(["web-1"]));
      return json(page(["all-1"], "cursor-1"));
    };
    const onCategoryChange = vi.fn();
    const { rerender } = render(<ProjectSearchResults query="fixture" onCategoryChange={onCategoryChange} />);
    await screen.findByText("Project all-1");
    fireEvent.click(screen.getByRole("button", { name: "Show more projects" }));

    rerender(<ProjectSearchResults query="fixture" category="web" onCategoryChange={onCategoryChange} />);
    await screen.findByText("Project web-1");
    await act(async () => {
      releaseMore(json(page(["all-2"])));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText("Project all-2")).toBeNull();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/projects/web-1"]);
  });
});

describe("ProjectSearchResults: capped facets (audit 2)", () => {
  it("disables empty categories only when the counts are exact", async () => {
    let capped = false;
    handler = (url) =>
      url.pathname === "/api/search/facets"
        ? json({ data: { category: { web: capped ? 1024 : 3 }, facetCounts: capped ? "capped" : "exact" } })
        : json(page(["p-1"]));
    const props = { onCategoryChange: vi.fn() };
    const { rerender } = render(<ProjectSearchResults query="exact" {...props} />);
    await waitFor(() => expect(screen.getByTestId("category-select").querySelector('[data-key="mobile"]')!.getAttribute("data-disabled")).toBe("true"));

    capped = true;
    rerender(<ProjectSearchResults query="capped" {...props} />);
    await screen.findByText("Project p-1");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const keys = [...screen.getByTestId("category-select").querySelectorAll("li")].map((li) => li.getAttribute("data-disabled"));
    expect(keys).toEqual(["false", "false"]);
  });
});
