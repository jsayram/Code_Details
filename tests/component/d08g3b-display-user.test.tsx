// @vitest-environment jsdom
// D08g3b: useDisplayUser gives Clerk's own values by default and the Better
// Auth session's with the development switch on.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({
  isLoaded: true,
  user: null as null | Record<string, unknown>,
}));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: clerk.user, isLoaded: clerk.isLoaded }) }));

import { AuthBackendProvider, type AuthBackend } from "@/backend/auth/context";
import { useDisplayUser } from "@/components/auth/useDisplayUser";
import { resetSessionForTests } from "@/lib/auth-session";

let sessionUser: Record<string, unknown> | null = null;
function Probe() {
  return <output>{JSON.stringify(useDisplayUser())}</output>;
}
const read = () => JSON.parse(screen.getByRole("status").textContent!);
const on = (backend: AuthBackend) => render(<AuthBackendProvider backend={backend}><Probe /></AuthBackendProvider>);

beforeEach(() => {
  resetSessionForTests();
  clerk.isLoaded = true;
  clerk.user = null;
  sessionUser = null;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(sessionUser ? { user: sessionUser } : null), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useDisplayUser with the switch on", () => {
  it("is loading first, then the Better Auth user with the name split", async () => {
    sessionUser = { id: "ba_1", name: "Synthetic  Person Jones", email: "s@synthetic.invalid", image: null };
    clerk.isLoaded = false; // Clerk never loading must not matter
    on("better-auth");
    expect(read()).toEqual({ isLoaded: false, user: null });
    await screen.findByText(/Synthetic/);
    expect(read()).toEqual({
      isLoaded: true,
      user: { fullName: "Synthetic  Person Jones", firstName: "Synthetic", lastName: "Person Jones", email: "s@synthetic.invalid", imageUrl: null, username: null },
    });
  });

  it("signed out is loaded with no user, whatever Clerk says", async () => {
    clerk.user = { fullName: "Clerk Fixture" };
    on("better-auth");
    await vi.waitFor(() => expect(read()).toEqual({ isLoaded: true, user: null }));
  });

  it("a one-word name has no last name", async () => {
    sessionUser = { id: "ba_2", name: "Mono", email: "m@synthetic.invalid", image: null };
    on("better-auth");
    await screen.findByText(/Mono/);
    expect(read().user).toMatchObject({ fullName: "Mono", firstName: "Mono", lastName: null });
  });
});
