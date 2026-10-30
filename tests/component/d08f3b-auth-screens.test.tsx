// @vitest-environment jsdom
// D08f3b: the app's sign-in, sign-up, reset and error screens (D08g4g: the
// only ones; Clerk's are gone).
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

import { SignInComponent } from "@/components/auth/SignInComponent";
import { SignUpComponent } from "@/components/auth/SignUpComponent";
import { SignInButtonComponent } from "@/components/auth/SignInButtonComponent";
import { resetSessionForTests } from "@/lib/auth-session";

type Reply = { status: number; body?: unknown };
let replies: Record<string, Reply> = {};
const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const path = url.replace(/^\/api\/auth/, "");
  if (init?.method === "POST") calls.push({ path, body: JSON.parse(String(init.body)) });
  const r = replies[path] ?? { status: 200, body: path === "/get-session" ? null : { status: true } };
  return new Response(JSON.stringify(r.body ?? null), { status: r.status });
});

const on = (node: ReactNode) => render(<>{node}</>);
const at = (path: string, search = "") => {
  nav.path = path;
  nav.search = search;
};

beforeEach(() => {
  resetSessionForTests();
  replies = {};
  calls.length = 0;
  fetchMock.mockClear();
  nav.push.mockClear();
  nav.refresh.mockClear();
  at("/sign-in");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fill(label: string, value: string) {
  await userEvent.type(screen.getByLabelText(label), value);
}

describe("sign-in (switch on)", () => {
  it("signs in and goes to a same-site redirect_url", async () => {
    at("/sign-in", "redirect_url=%2Fprojects%2Fx");
    on(<SignInComponent />);
    await fill("Email address", "a@synthetic.invalid");
    await fill("Password", "synthetic-Password-123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(calls).toContainEqual({ path: "/sign-in/email", body: { email: "a@synthetic.invalid", password: "synthetic-Password-123" } });
    await vi.waitFor(() => expect(nav.push).toHaveBeenCalledWith("/projects/x"));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("ignores a redirect_url to another site", async () => {
    at("/sign-in", "redirect_url=https%3A%2F%2Fevil.example%2F");
    on(<SignInComponent />);
    await fill("Email address", "a@synthetic.invalid");
    await fill("Password", "synthetic-Password-123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(nav.push).toHaveBeenCalledWith("/"));
  });

  it.each([
    [401, "Email or password is incorrect."],
    [429, "Too many attempts. Wait a minute and try again."],
    [500, "We couldn't sign you in. Please try again."],
  ])("%i shows %s", async (status, text) => {
    replies["/sign-in/email"] = { status, body: { code: "X" } };
    on(<SignInComponent />);
    await fill("Email address", "a@synthetic.invalid");
    await fill("Password", "wrong-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toBe(text);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("an unconfirmed email gets 'Send a new link' with the address filled in", async () => {
    replies["/sign-in/email"] = { status: 403, body: { code: "EMAIL_NOT_VERIFIED" } };
    on(<SignInComponent />);
    await fill("Email address", "a@synthetic.invalid");
    await fill("Password", "synthetic-Password-123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Confirm your email first/);
    await userEvent.click(screen.getByRole("button", { name: "Send a new link" }));
    expect(calls.at(-1)).toEqual({ path: "/send-verification-email", body: { email: "a@synthetic.invalid", callbackURL: "/sign-in?verified=1" } });
    expect(await screen.findByText(/If that email needs a link, we've sent a new one/)).toBeTruthy();
  });

  it("?verified=1 says the email is confirmed", () => {
    at("/sign-in", "verified=1");
    on(<SignInComponent />);
    expect(screen.getByRole("status").textContent).toBe("Email confirmed. Sign in to continue.");
  });

  it("?error= from a failed verify link shows the f6 screen", () => {
    at("/sign-in", "verified=1&error=TOKEN_EXPIRED");
    on(<SignInComponent />);
    expect(screen.getByRole("heading", { name: "This link has expired or was already used" })).toBeTruthy();
  });
});

describe("error screen /sign-in/error (switch on)", () => {
  it("f3: account_not_linked points to the password, with no other detail", () => {
    at("/sign-in/error", "error=account_not_linked&error_description=leak%40synthetic.invalid");
    const { container } = on(<SignInComponent />);
    expect(screen.getByText(/This email is already used by a Code Details account/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in with your password" }).getAttribute("href")).toBe("/sign-in");
    expect(container.textContent).not.toMatch(/leak|account_not_linked/);
  });

  it("f6: invalid_link offers a new verification link", async () => {
    at("/sign-in/error", "error=invalid_link");
    on(<SignInComponent />);
    expect(screen.getByText(/Some mail apps open links ahead of you/)).toBeTruthy();
    await fill("Email address", "b@synthetic.invalid");
    await userEvent.click(screen.getByRole("button", { name: "Send a new link" }));
    expect(calls.at(-1)?.path).toBe("/send-verification-email");
  });

  it.each([
    ["state_mismatch", "Let's start that again"],
    ["anything_else", "Something went wrong"],
    ["", "Something went wrong"],
  ])("%s → %s", (code, heading) => {
    at("/sign-in/error", `error=${code}`);
    on(<SignInComponent />);
    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/sign-in");
  });
});

describe("sign-up (switch on)", () => {
  it("creates the account and shows 'Check your inbox' with the typed address", async () => {
    on(<SignUpComponent />);
    await fill("Name", "Synthetic Person");
    await fill("Email address", "c@synthetic.invalid");
    await fill("Password", "synthetic-Password-123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(calls).toContainEqual({
      path: "/sign-up/email",
      body: { name: "Synthetic Person", email: "c@synthetic.invalid", password: "synthetic-Password-123", callbackURL: "/sign-in?verified=1" },
    });
    expect(await screen.findByRole("heading", { name: "Check your inbox" })).toBeTruthy();
    expect(screen.getByText("c@synthetic.invalid")).toBeTruthy();
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("c@synthetic.invalid");
  });

  it("a short password is refused before anything is sent", async () => {
    on(<SignUpComponent />);
    await fill("Name", "S");
    await fill("Email address", "c@synthetic.invalid");
    const pw = screen.getByLabelText("Password") as HTMLInputElement;
    pw.removeAttribute("minLength");
    await userEvent.type(pw, "short");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least 8 characters/);
    expect(calls).toEqual([]);
  });

  it("429 shows the rate-limit message", async () => {
    replies["/sign-up/email"] = { status: 429 };
    on(<SignUpComponent />);
    await fill("Name", "S");
    await fill("Email address", "c@synthetic.invalid");
    await fill("Password", "synthetic-Password-123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Too many attempts. Wait a minute and try again.");
  });
});

describe("reset (switch on)", () => {
  it("the request answers the same way for any address", async () => {
    at("/sign-in/reset-password");
    on(<SignInComponent />);
    await fill("Email address", "d@synthetic.invalid");
    await userEvent.click(screen.getByRole("button", { name: "Send a new link" }));
    expect(calls.at(-1)).toEqual({ path: "/request-password-reset", body: { email: "d@synthetic.invalid", redirectTo: "/sign-in/reset-password" } });
    expect(await screen.findByText(/If that email needs a link, we've sent a new one/)).toBeTruthy();
  });

  it("with a token, sets the new password", async () => {
    at("/sign-in/reset-password", "token=tok123");
    on(<SignInComponent />);
    await fill("New password", "synthetic-New-Password-456");
    await fill("Confirm new password", "synthetic-New-Password-456");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(calls.at(-1)).toEqual({ path: "/reset-password", body: { newPassword: "synthetic-New-Password-456", token: "tok123" } });
    expect(await screen.findByRole("heading", { name: "Password changed" })).toBeTruthy();
  });

  it("mismatched passwords are refused before anything is sent", async () => {
    at("/sign-in/reset-password", "token=tok123");
    on(<SignInComponent />);
    await fill("New password", "synthetic-New-Password-456");
    await fill("Confirm new password", "synthetic-New-Password-789");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The passwords don't match.");
    expect(calls).toEqual([]);
  });

  it.each([
    ["an expired link (?error=INVALID_TOKEN)", "error=INVALID_TOKEN", false],
    ["a token refused on submit", "token=used", true],
  ])("%s shows f6 and offers a new reset link", async (_name, search, submit) => {
    at("/sign-in/reset-password", search);
    replies["/reset-password"] = { status: 400, body: { code: "INVALID_TOKEN" } };
    on(<SignInComponent />);
    if (submit) {
      await fill("New password", "synthetic-New-Password-456");
      await fill("Confirm new password", "synthetic-New-Password-456");
      await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    }
    expect(await screen.findByRole("heading", { name: "This link has expired or was already used" })).toBeTruthy();
    await fill("Email address", "d@synthetic.invalid");
    await userEvent.click(screen.getByRole("button", { name: "Send a new link" }));
    expect(calls.at(-1)?.path).toBe("/request-password-reset");
  });
});

describe("sign-in button", () => {
  it("switch on: goes to /sign-in and back to this page", async () => {
    at("/projects/x");
    on(<SignInButtonComponent text="Sign In" useTypingEffect={false} variant="plain" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(nav.push).toHaveBeenCalledWith("/sign-in?redirect_url=%2Fprojects%2Fx");
  });
});

