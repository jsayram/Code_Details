// @vitest-environment jsdom
// D08f3c: "Continue with GitHub" and "Connect GitHub" in the account menu,
// with the development switch on (the handover screen went in D08g4b). Nothing reaches
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

// D08g4b: the handover screen is gone; its old path falls through to sign-in.
describe("/sign-in/handover after D08g4b", () => {
  it("shows the plain sign-in screen, with no old-login button and no link call", async () => {
    nav.path = "/sign-in/handover";
    clerk.userId = "user_clerk_fixture";
    sessionUser = USER;
    on(<SignInComponent />);
    expect(await screen.findByRole("heading", { name: "Sign in to Code Details" })).toBeTruthy();
    expect(screen.queryByText("Set up your new login")).toBeNull();
    expect(screen.queryByTestId("clerk-sign-in-button")).toBeNull();
    expect(clerk.signInButtons).toEqual([]);
    expect(calls.some((c) => c.url === "/api/account/handover")).toBe(false);
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
