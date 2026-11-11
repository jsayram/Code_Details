// @vitest-environment jsdom
// D04f: useUserTier shows the tier the route answers. The route answers
// { success: true, data: { tier } } (success() in src/lib/api-errors.ts); the
// hook used to read result.tier, so a paid account showed as "free". This
// test fails on that old client.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUserTier } from "@/hooks/use-user-tier";

function Probe({ id }: { id: string | null }) {
  const { userTier, loading } = useUserTier(id);
  return <output data-loading={String(loading)}>{userTier}</output>;
}

const renderFresh = (id: string | null) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Probe id={id} />
    </SWRConfig>,
  );

function answer(body: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })));
}

describe("D04f useUserTier", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(["pro", "diamond"])("shows %s from the route's real answer shape", async (tier) => {
    answer({ success: true, data: { tier } });
    renderFresh("viewer-1");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(tier));
  });

  it("falls back to free for an unknown tier, a failed request, or nobody signed in", async () => {
    answer({ success: true, data: { tier: "platinum" } });
    renderFresh("viewer-2");
    await waitFor(() => expect(screen.getByRole("status").dataset.loading).toBe("false"));
    expect(screen.getByRole("status").textContent).toBe("free");
    cleanup();

    answer({}, false);
    renderFresh("viewer-3");
    await waitFor(() => expect(screen.getByRole("status").dataset.loading).toBe("false"));
    expect(screen.getByRole("status").textContent).toBe("free");
    cleanup();

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderFresh(null);
    expect(screen.getByRole("status").textContent).toBe("free");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
