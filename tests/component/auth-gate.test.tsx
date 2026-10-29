// @vitest-environment jsdom
// D08f2: the app's SignedIn/SignedOut. Server HTML and the first client render
// must match whatever Clerk already knows on the client, which is the race
// that made Clerk's own SignedOut fail hydration in the header.
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ userId: undefined as string | null | undefined }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ userId: auth.userId }) }));

import { SignedIn, SignedOut } from "@/components/auth/AuthGate";
import { useAuth } from "@clerk/nextjs";
import type { ReactNode } from "react";

/** How Clerk's own client SignedOut behaves: it reads auth during hydration. */
function ClerkLikeSignedOut({ children }: { children: ReactNode }) {
  return useAuth().userId === null ? <>{children}</> : null;
}

const Tree = () => (
  <header>
    <SignedOut>
      <div className="block">sign in</div>
    </SignedOut>
    <SignedIn>
      <span>menu</span>
    </SignedIn>
  </header>
);

/** Server-renders with one auth state, then hydrates with another, as clerk-js loading in between would. */
async function hydrateWith(server: string | null | undefined, client: string | null | undefined) {
  auth.userId = server;
  const html = renderToString(<Tree />);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  auth.userId = client;
  const errors: unknown[] = [];
  await act(async () => {
    hydrateRoot(container, <Tree />, { onRecoverableError: (e) => errors.push(e) });
  });
  return { html, container, errors };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AuthGate", () => {
  it("renders neither on the server, whatever the auth state", () => {
    for (const userId of [undefined, null, "user_fixture_a"]) {
      auth.userId = userId;
      expect(renderToString(<Tree />)).toBe("<header></header>");
    }
  });

  it.each([
    ["signed out", null, "sign in"],
    ["signed in", "user_fixture_a", "menu"],
  ])("hydrates without a mismatch when the client already knows it is %s, then shows only its part", async (_name, userId, shown) => {
    const { errors, container } = await hydrateWith(undefined, userId);
    expect(errors).toEqual([]);
    expect(container.textContent).toBe(shown);
  });

  it("shows neither while auth is still loading", async () => {
    const { errors, container } = await hydrateWith(undefined, undefined);
    expect(errors).toEqual([]);
    expect(container.textContent).toBe("");
  });

  it("(control) a gate that reads auth during hydration, like Clerk's, fails exactly this way", async () => {
    const ClerkLikeTree = () => (
      <header>
        <ClerkLikeSignedOut>
          <div className="block">sign in</div>
        </ClerkLikeSignedOut>
      </header>
    );
    auth.userId = undefined;
    const container = document.createElement("div");
    container.innerHTML = renderToString(<ClerkLikeTree />);
    document.body.appendChild(container);
    auth.userId = null;
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      hydrateRoot(container, <ClerkLikeTree />, { onRecoverableError: (e) => errors.push(e) });
    });
    consoleError.mockRestore();
    expect(errors.map(String).join("\n")).toMatch(/hydrat/i);
  });
});
