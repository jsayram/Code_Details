// @vitest-environment jsdom
// D08f3a: the gates and the header's account controls follow the Better Auth
// session (D08g4g: the only login).
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { SignedIn, SignedOut } from "@/components/auth/AuthGate";
import { AccountButton, AccountSignOutButton, useAccountSignOut, useAccountSummary } from "@/components/auth/AccountButton";
import { resetSessionForTests } from "@/lib/auth-session";

const SYNTHETIC_USER = { id: "ba_user_fixture", name: "Synthetic Person", email: "d08f3a.person@synthetic.invalid", image: null };

let sessionUser: typeof SYNTHETIC_USER | null = null;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === "/api/auth/get-session") return new Response(JSON.stringify(sessionUser ? { user: sessionUser, session: {} } : null), { status: 200 });
  if (url === "/api/auth/sign-out" && init?.method === "POST") {
    sessionUser = null;
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  return new Response(null, { status: 404 });
});

const Gates = () => (
  <header>
    <SignedOut>
      <div>sign in</div>
    </SignedOut>
    <SignedIn>
      <span>menu</span>
    </SignedIn>
  </header>
);
const withBackend = (_backend: "better-auth", node: ReactNode) => <>{node}</>;

function Summary() {
  const s = useAccountSummary();
  return <output>{JSON.stringify(s)}</output>;
}

beforeEach(() => {
  resetSessionForTests();
  sessionUser = null;
  fetchMock.mockClear();
  router.push.mockClear();
  router.refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("gates with the switch on", () => {
  it("render neither on the server", () => {
    sessionUser = SYNTHETIC_USER;
    expect(renderToString(withBackend("better-auth", <Gates />))).toBe("<header></header>");
  });

  it("show the signed-in part for a Better Auth session", async () => {
    sessionUser = SYNTHETIC_USER;
    render(withBackend("better-auth", <Gates />));
    expect(await screen.findByText("menu")).toBeTruthy();
    expect(screen.queryByText("sign in")).toBeNull();
  });

  it("show the signed-out part without a session", async () => {
    render(withBackend("better-auth", <Gates />));
    expect(await screen.findByText("sign in")).toBeTruthy();
    expect(screen.queryByText("menu")).toBeNull();
  });

  it("show neither while the session is loading", async () => {
    let release!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(new Response("null", { status: 200 })))));
    const { container } = render(withBackend("better-auth", <Gates />));
    expect(container.textContent).toBe("");
    await act(async () => release());
    expect(container.textContent).toBe("sign in");
  });

  it("treat a failed session request as signed out", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("nope", { status: 500 }));
    render(withBackend("better-auth", <Gates />));
    expect(await screen.findByText("sign in")).toBeTruthy();
  });
});

describe("account controls with the switch on", () => {
  it("the menu shows the account and signs out through /api/auth/sign-out", async () => {
    sessionUser = SYNTHETIC_USER;
    const user = userEvent.setup();
    render(withBackend("better-auth", <><AccountButton appearance={{ elements: { userButtonAvatarBox: "w-9 h-9" } }} /><Gates /></>));
    const trigger = await screen.findByRole("button", { name: "Open account menu" });
    expect(trigger.querySelector('[data-slot="avatar"]')?.className).toContain("w-9 h-9");
    // UI05: the name now comes from screen-reader text; the initials are what shows.
    expect(trigger.querySelector('[data-slot="avatar"]')?.textContent).toBe("SP");
    await screen.findByText("menu");
    await user.click(trigger);
    expect(await screen.findByText("Synthetic Person")).toBeTruthy();
    expect(screen.getByText(SYNTHETIC_USER.email)).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByText("sign in")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", expect.objectContaining({ method: "POST" }));
    expect(router.push).toHaveBeenCalledWith("/");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("AccountSignOutButton signs out with its own child", async () => {
    sessionUser = SYNTHETIC_USER;
    const user = userEvent.setup();
    render(withBackend("better-auth", <><AccountSignOutButton><button>Sign Out</button></AccountSignOutButton><Gates /></>));
    await screen.findByText("menu");
    await user.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(await screen.findByText("sign in")).toBeTruthy();
    expect(router.push).toHaveBeenCalledWith("/");
  });

  it("useAccountSummary reads the Better Auth user", async () => {
    sessionUser = SYNTHETIC_USER;
    render(withBackend("better-auth", <Summary />));
    await screen.findByText(/Synthetic Person/);
    expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual({ isLoaded: true, hasUser: true, name: SYNTHETIC_USER.name, email: SYNTHETIC_USER.email });
  });
});

// D08g4e1: the sidebar's account menu (nav-user) signs out through this hook.
function SignOutWith({ to }: { to?: string }) {
  const signOut = useAccountSignOut(to);
  return <button onClick={() => void signOut()}>out</button>;
}

describe("useAccountSignOut", () => {
  it("with the switch on, signs out of Better Auth and goes to the page given", async () => {
    sessionUser = SYNTHETIC_USER;
    render(withBackend("better-auth", <SignOutWith to="/bye" />));
    await userEvent.click(screen.getByRole("button", { name: "out" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", expect.objectContaining({ method: "POST" }));
    expect(router.push).toHaveBeenCalledWith("/bye");
  });

});
