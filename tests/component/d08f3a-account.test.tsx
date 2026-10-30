// @vitest-environment jsdom
// D08f3a: the gates and the header's account controls follow the Better Auth
// session when the development switch is on, and are exactly Clerk's otherwise.
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const clerk = vi.hoisted(() => ({
  userId: null as string | null | undefined,
  user: null as null | { fullName: string | null; username: string | null; primaryEmailAddress: { emailAddress: string } | null },
  userButtonProps: [] as unknown[],
  signOutButtonProps: [] as unknown[],
  signOut: vi.fn(async () => {}),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: clerk.userId }),
  useUser: () => ({ user: clerk.user, isLoaded: clerk.userId !== undefined }),
  useClerk: () => ({ signOut: clerk.signOut }),
  UserButton: (props: object) => {
    clerk.userButtonProps.push(props);
    return <span data-testid="clerk-user-button" />;
  },
  SignOutButton: ({ children, ...props }: { children: ReactNode }) => {
    clerk.signOutButtonProps.push(props);
    return <span data-testid="clerk-sign-out">{children}</span>;
  },
}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import { AuthBackendProvider, type AuthBackend } from "@/backend/auth/context";
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
const withBackend = (backend: AuthBackend, node: ReactNode) => <AuthBackendProvider backend={backend}>{node}</AuthBackendProvider>;

function Summary() {
  const s = useAccountSummary();
  return <output>{JSON.stringify(s)}</output>;
}

beforeEach(() => {
  resetSessionForTests();
  sessionUser = null;
  clerk.userId = null;
  clerk.user = null;
  clerk.userButtonProps = [];
  clerk.signOutButtonProps = [];
  clerk.signOut.mockClear();
  fetchMock.mockClear();
  router.push.mockClear();
  router.refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuthBackendProvider", () => {
  it("adds no markup of its own", () => {
    expect(renderToString(withBackend("better-auth", <p>x</p>))).toBe(renderToString(<p>x</p>));
    expect(renderToString(withBackend("clerk", <p>x</p>))).toBe(renderToString(<p>x</p>));
  });
});

describe("gates with the switch on", () => {
  it("render neither on the server", () => {
    sessionUser = SYNTHETIC_USER;
    expect(renderToString(withBackend("better-auth", <Gates />))).toBe("<header></header>");
  });

  it("show the signed-in part for a Better Auth session, whatever Clerk says", async () => {
    sessionUser = SYNTHETIC_USER;
    clerk.userId = null;
    render(withBackend("better-auth", <Gates />));
    expect(await screen.findByText("menu")).toBeTruthy();
    expect(screen.queryByText("sign in")).toBeNull();
  });

  it("show the signed-out part without a session, even when Clerk has a user", async () => {
    clerk.userId = "user_clerk_fixture";
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
    expect(clerk.userButtonProps).toEqual([]);
    const trigger = await screen.findByRole("button", { name: "Open account menu" });
    expect(trigger.querySelector('[data-slot="avatar"]')?.className).toContain("w-9 h-9");
    expect(trigger.textContent).toBe("SP");
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
    expect(clerk.signOutButtonProps).toEqual([]);
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
    expect(clerk.signOut).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/bye");
  });

});
