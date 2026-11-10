// @vitest-environment jsdom
// UI07.3: what the projects provider reports while a page or filter changes.
// The previous list stays on screen while the next one loads (no skeleton, so
// the pager keeps focus), and a failed change says so even though an older
// list is still showing.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ page2: "ok" as "ok" | "fail" | "hang" }));
const fetcher = vi.hoisted(() =>
  vi.fn(async (url: string) => {
    const page = Number(new URL(url, "http://x").searchParams.get("page") ?? 1);
    if (page === 2 && gate.page2 === "fail") throw new Error("forced");
    if (page === 2 && gate.page2 === "hang") await new Promise(() => {});
    return { success: true, data: [{ id: `p${page}`, title: `Project on page ${page}` }], pagination: { total: 40, totalPages: 2 } };
  }),
);
vi.mock("@/lib/swr-fetchers", () => ({ projectsFetcher: fetcher }));

import { ProjectsProvider, useProjects } from "@/providers/projects-provider";

let api: ReturnType<typeof useProjects> | null = null;
function Probe() {
  api = useProjects();
  const { projects, loading, refreshing, error, staleAfterError } = api;
  return (
    <p>
      {[projects.map((p) => p.title).join(","), loading && "loading", refreshing && "refreshing", error && "error", staleAfterError && "stale"].filter(Boolean).join(" | ")}
    </p>
  );
}

const show = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}>
      <ProjectsProvider userId={null} allowAnonymousView>
        <Probe />
      </ProjectsProvider>
    </SWRConfig>,
  );

afterEach(() => {
  cleanup();
  fetcher.mockClear();
  gate.page2 = "ok";
  api = null;
});

describe("UI07.3 list states", () => {
  it("the first load shows the loading state; a page change keeps the old list, marked refreshing", async () => {
    gate.page2 = "hang";
    show();
    expect(screen.getByText("loading")).toBeTruthy();
    await screen.findByText("Project on page 1");
    act(() => api!.setFilters({ page: 2 }));
    await screen.findByText("Project on page 1 | refreshing");
    expect(screen.queryByText(/loading/)).toBeNull();
  });

  it("a page change that fails reports the error and that the list on screen is the old one", async () => {
    gate.page2 = "fail";
    show();
    await screen.findByText("Project on page 1");
    act(() => api!.setFilters({ page: 2 }));
    await screen.findByText("Project on page 1 | error | stale");
  });

  it("a successful page change replaces the list and clears the state", async () => {
    show();
    await screen.findByText("Project on page 1");
    act(() => api!.setFilters({ page: 2 }));
    await screen.findByText("Project on page 2");
    await waitFor(() => expect(api!.error).toBe(false));
  });
});
