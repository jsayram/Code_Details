// @vitest-environment jsdom
// D08f3c: "Continue with GitHub", "Connect GitHub" in the account menu, and
// the handover screen, with the development switch on. Nothing reaches
// GitHub: fetch is mocked and navigation is a spy.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const nav = vi.hoisted(() => ({ path: "/sign-in", search: "", push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
}));
vi.mock("next/image", () => ({
  default: ({ priority, ...props }: Record<string, unknown>) => {
    void priority;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));
const clerk = vi.hoisted(() => ({ userId: null as string | null, signInButtons: [] as unknown[] }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: clerk.userId }),
  useUser: () => ({ user: null, isLoaded: true }),
  UserButton: () => null,
  SignOutButton: ({ children }: { children: ReactNode }) => children,
  SignIn: () => null,
  SignUp: () => null,
  SignInButton: ({ children, ...props }: { children: ReactNode }) => (clerk.signInButtons.push(props), <span data-testid="clerk-sign-in-button">{children}</span>),
}));

import { AuthBackendProvider } from "@/backend/auth/context";
import { AccountButton } from "@/components/auth/AccountButton";
import { SignInComponent } from "@/components/auth/SignInComponent";
import { SignUpComponent } from "@/components/auth/SignUpComponent";
import { resetSessionForTests } from "@/lib/auth-session";

const USER = { id: "ba_user_fixture", name: "Synthetic Person", email: "d08f3c.person@synthetic.invalid", image: null };
type Reply = { status: number; body?: unknown };
let replies: Record<string, Reply> = {};
let sessionUser: typeof USER | null = null;
const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === "POST") calls.push({ url, body: JSON.parse(String(init.body)) });
  if (url === "/api/auth/get-session") return new Response(JSON.stringify(sessionUser ? { user: sessionUser } : null), { status: 200 });
  const r = replies[url] ?? { status: 200, body: {} };
  return new Response(JSON.stringify(r.body ?? null), { status: r.status });
});
const assign = vi.fn();

const on = (node: ReactNode) => render(<AuthBackendProvider backend="better-auth">{node}</AuthBackendProvider>);
const GITHUB_URL = "https://github.com/login/oauth/authorize?client_id=SYNTHETIC&state=s";

beforeEach(() => {
  resetSessionForTests();
  replies = {};
  calls.length = 0;
  sessionUser = null;
  clerk.userId = null;
  clerk.signInButtons = [];
  nav.path = "/sign-in";
  nav.search = "";
  fetchMock.mockClear();
  assign.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { ...window.location, assign, origin: "http://localhost:3100" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Continue with GitHub", () => {
  it.each([
    ["sign-in", () => <SignInComponent />, "/sign-in", "redirect_url=%2Fprojects%2Fx", "/projects/x"],
    ["sign-up", () => <SignUpComponent />, "/sign-up", "", "/"],
  ])("on %s starts social sign-in and goes to GitHub", async (_n, el, path, search, callbackURL) => {
    nav.path = path;
    nav.search = search;
    replies["/api/auth/sign-in/social"] = { status: 200, body: { url: GITHUB_URL, redirect: false } };
    on(el());
    await userEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect(calls).toEqual([
      { url: "/api/auth/sign-in/social", body: { provider: "github", callbackURL, errorCallbackURL: "/sign-in/error", disableRedirect: true } },
    ]);
    expect(assign).toHaveBeenCalledWith(GITHUB_URL);
  });

  it.each([
    [404, { code: "PROVIDER_NOT_FOUND" }, "GitHub sign-in isn't available here."],
    [429, {}, "Too many attempts. Wait a minute and try again."],
    [500, {}, "We couldn't reach GitHub. Please try again."],
    [200, { url: "javascript:alert(1)" }, "We couldn't reach GitHub. Please try again."],
  ])("%i %j shows a message and goes nowhere", async (status, body, text) => {
    replies["/api/auth/sign-in/social"] = { status, body };
    on(<SignInComponent />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect((await screen.findByRole("alert")).textContent).toBe(text);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("Connect GitHub in the account menu", () => {
  beforeEach(() => {
    sessionUser = USER;
    nav.path = "/projects/x";
  });

  it("offers Connect GitHub when it isn't linked, and starts link-social back to this page", async () => {
    replies["/api/auth/list-accounts"] = { status: 200, body: [{ providerId: "credential" }] };
    replies["/api/auth/link-social"] = { status: 200, body: { url: GITHUB_URL, redirect: false } };
    on(<AccountButton />);
    await userEvent.click(await screen.findByRole("button", { name: "Open account menu" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Connect GitHub" }));
    expect(calls.at(-1)).toEqual({
      url: "/api/auth/link-social",
      body: { provider: "github", callbackURL: "/projects/x", errorCallbackURL: "/sign-in/error", disableRedirect: true },
    });
    expect(assign).toHaveBeenCalledWith(GITHUB_URL);
  });

  it("shows GitHub connected, disabled, when it is", async () => {
    replies["/api/auth/list-accounts"] = { status: 200, body: [{ providerId: "credential" }, { providerId: "github" }] };
    on(<AccountButton />);
    await userEvent.click(await screen.findByRole("button", { name: "Open account menu" }));
    expect((await screen.findByRole("menuitem", { name: "GitHub connected" })).getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("menuitem", { name: "Connect GitHub" })).toBeNull();
  });

  it("shows neither when the accounts can't be read", async () => {
    replies["/api/auth/list-accounts"] = { status: 401 };
    on(<AccountButton />);
    await userEvent.click(await screen.findByRole("button", { name: "Open account menu" }));
    await screen.findByRole("menuitem", { name: "Sign out" });
    expect(screen.queryByText(/GitHub/)).toBeNull();
  });
});

describe("handover screen /sign-in/handover", () => {
  beforeEach(() => {
    nav.path = "/sign-in/handover";
  });

  it("with neither login, shows both steps undone, the old sign-in, and no link button", async () => {
    on(<SignInComponent />);
    expect(await screen.findByRole("heading", { name: "Set up your new login" })).toBeTruthy();
    expect(screen.getByText("Your existing account").parentElement!.textContent).toMatch(/not done yet/);
    expect(screen.getByTestId("clerk-sign-in-button").textContent).toBe("Sign in with the old login");
    expect(clerk.signInButtons[0]).toMatchObject({ mode: "modal", forceRedirectUrl: "/sign-in/handover" });
    expect(screen.getByRole("link", { name: "Create it" }).getAttribute("href")).toBe("/sign-up?redirect_url=%2Fsign-in%2Fhandover");
    expect(screen.getByRole("link", { name: "sign in" }).getAttribute("href")).toBe("/sign-in?redirect_url=%2Fsign-in%2Fhandover");
    expect(screen.queryByRole("button", { name: "Link my account" })).toBeNull();
  });

  it("with only one login, still no link button", async () => {
    clerk.userId = "user_clerk_fixture";
    on(<SignInComponent />);
    await screen.findByText("Signed in with the old login.");
    expect(screen.queryByRole("button", { name: "Link my account" })).toBeNull();
  });

  it("with both, links the account", async () => {
    clerk.userId = "user_clerk_fixture";
    sessionUser = USER;
    replies["/api/account/handover"] = { status: 200, body: { linked: true } };
    on(<SignInComponent />);
    expect(await screen.findByText(`Signed in as ${USER.email}.`)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Link my account" }));
    expect(calls.at(-1)).toEqual({ url: "/api/account/handover", body: {} });
    expect(await screen.findByRole("heading", { name: "Your account is linked" })).toBeTruthy();
  });

  it.each([
    [401, /One of the logins is no longer signed in/],
    [409, /We couldn't link these\. The new login may already belong to an account/],
    [404, /Linking isn't available here/],
    [503, /Linking isn't available here/],
    [500, /We couldn't link these\. Please try again/],
  ])("%i shows its message", async (status, text) => {
    clerk.userId = "user_clerk_fixture";
    sessionUser = USER;
    replies["/api/account/handover"] = { status, body: { linked: false } };
    on(<SignInComponent />);
    await userEvent.click(await screen.findByRole("button", { name: "Link my account" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(text);
    expect(screen.queryByRole("heading", { name: "Your account is linked" })).toBeNull();
  });
});

describe("linking errors", () => {
  it.each(["account_already_linked_to_different_user", "email_doesn't_match", "unable_to_link_account"])("%s → couldn't be connected", async (code) => {
    nav.path = "/sign-in/error";
    nav.search = `error=${encodeURIComponent(code)}`;
    on(<SignInComponent />);
    expect(screen.getByRole("heading", { name: "That GitHub account couldn't be connected" })).toBeTruthy();
  });
});
