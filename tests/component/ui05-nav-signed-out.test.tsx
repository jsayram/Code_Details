// @vitest-environment jsdom
// UI05 security containment: the sidebar's signed-in group label and entries
// appear only once the session says someone is signed in. Before, NavMain
// treated "still loading" as signed in, so the server HTML and the first
// client render showed them to every signed-out visitor.
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/projects" }));

import { NavMain } from "@/components/sidebar/nav-main";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DocChaptersProvider } from "@/providers/doc-chapters-provider";
import { resetSessionForTests } from "@/lib/auth-session";
import { NAV_MAIN } from "@/components/sidebar/app-sidebar";

const SYNTHETIC_USER = { id: "ba_user_ui05", name: "Synthetic Person", email: "ui05.person@synthetic.invalid", image: null };
const SIGNED_IN_ONLY = ["Explore", "Dashboard", "GitHub Scraper", "My Projects Portfolio", "My Favorites", "Graveyard"];
const PUBLIC = ["Search", "Projects", "Community Projects"];

let sessionUser: typeof SYNTHETIC_USER | null = null;
let hold: Promise<void> | null = null;
const fetchMock = vi.fn(async (url: string) => {
  if (hold) await hold;
  if (url === "/api/auth/get-session") return new Response(JSON.stringify(sessionUser ? { user: sessionUser, session: {} } : null), { status: 200 });
  return new Response(null, { status: 404 });
});

function stubMatchMedia() {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })));
}

const Nav = () => (
  <DocChaptersProvider>
    <SidebarProvider>
      <NavMain items={NAV_MAIN} />
    </SidebarProvider>
  </DocChaptersProvider>
);

const visible = (name: string) => screen.queryAllByText(name, { exact: true }).length > 0;

beforeEach(() => {
  resetSessionForTests();
  sessionUser = null;
  hold = null;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  stubMatchMedia();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NavMain before the session is known", () => {
  it("leaves signed-in entries out of the server HTML", () => {
    const html = renderToString(<Nav />);
    for (const name of SIGNED_IN_ONLY) expect(html).not.toContain(`>${name}<`);
    for (const name of PUBLIC) expect(html).toContain(`>${name}<`);
  });

  it("leaves them out while the session request is in flight", async () => {
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    render(<Nav />);
    await act(async () => {});
    for (const name of SIGNED_IN_ONLY) expect(visible(name)).toBe(false);
    for (const name of PUBLIC) expect(visible(name)).toBe(true);
    await act(async () => release());
  });
});

describe("NavMain once the session is known", () => {
  it("keeps them hidden for a signed-out visitor", async () => {
    render(<Nav />);
    await screen.findByText("Search");
    await act(async () => {});
    for (const name of SIGNED_IN_ONLY) expect(visible(name)).toBe(false);
  });

  it("shows every entry to a signed-in user", async () => {
    sessionUser = SYNTHETIC_USER;
    render(<Nav />);
    expect(await screen.findByText("Explore", { exact: true })).toBeTruthy();
    for (const name of SIGNED_IN_ONLY) expect(visible(name)).toBe(true);
  });
});
