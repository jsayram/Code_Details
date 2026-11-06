// @vitest-environment jsdom
// F02 slice 2: when a project list asks the server. A public list asks signed
// out; a personal list never does, even if the page asks for anonymous view,
// and neither does anything before the session is known.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetcher = vi.hoisted(() => vi.fn(async (url: string) => ({ url, data: [], pagination: { total: 0, totalPages: 1 } })));
vi.mock("@/lib/swr-fetchers", () => ({ projectsFetcher: fetcher }));

import { ProjectsProvider, useProjects, type ProjectFilters } from "@/providers/projects-provider";

function Probe({ set }: { set?: Partial<ProjectFilters> }) {
  const { loading, setFilters } = useProjects();
  useEffect(() => {
    if (set) setFilters(set);
  }, [set, setFilters]);
  return <p>{loading ? "loading" : "settled"}</p>;
}

type Props = Partial<React.ComponentProps<typeof ProjectsProvider>> & { set?: Partial<ProjectFilters> };
const show = ({ set, ...props }: Props) =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ProjectsProvider userId={null} {...props}>
        <Probe set={set} />
      </ProjectsProvider>
    </SWRConfig>,
  );

afterEach(() => {
  cleanup();
  fetcher.mockClear();
});

describe("F02 project list fetching", () => {
  it("a public list fetches signed out, with no personal filter", async () => {
    show({ allowAnonymousView: true });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    const url = fetcher.mock.calls[0][0];
    expect(url).toContain("showAll=true");
    expect(url).not.toContain("userId");
  });

  it("a list that didn't opt in doesn't fetch signed out", async () => {
    show({});
    await screen.findByText("settled");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([{ showFavorites: true }, { showDeleted: true }, { showMyProjects: true }])("a personal list never fetches signed out: %o", async (filter) => {
    show({ allowAnonymousView: true, initialFilters: filter });
    await screen.findByText("settled");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("nothing fetches while the session is loading, and the list stays in its loading state", async () => {
    show({ allowAnonymousView: true, isLoading: true });
    await screen.findByText("loading");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("a signed-in viewer still fetches any list", async () => {
    show({ userId: "viewer-1", initialFilters: { showFavorites: true } });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
  });

  it("a share page still fetches signed out by username", async () => {
    show({ initialFilters: { username: "fixture-alice" } });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
  });
});
