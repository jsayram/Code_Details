// @vitest-environment jsdom
// D08g3b: useDisplayUser gives the Better Auth session's values (D08g4g: the
// only login).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


import { useDisplayUser } from "@/components/auth/useDisplayUser";
import { resetSessionForTests } from "@/lib/auth-session";

let sessionUser: Record<string, unknown> | null = null;
function Probe() {
  return <output>{JSON.stringify(useDisplayUser())}</output>;
}
const read = () => JSON.parse(screen.getByRole("status").textContent!);
const on = () => render(<Probe />);

beforeEach(() => {
  resetSessionForTests();
  sessionUser = null;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(sessionUser ? { user: sessionUser } : null), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useDisplayUser", () => {
  it("is loading first, then the Better Auth user with the name split", async () => {
    sessionUser = { id: "ba_1", name: "Synthetic  Person Jones", email: "s@synthetic.invalid", image: null };
    on();
    expect(read()).toEqual({ isLoaded: false, user: null });
    await screen.findByText(/Synthetic/);
    expect(read()).toEqual({
      isLoaded: true,
      user: { fullName: "Synthetic  Person Jones", firstName: "Synthetic", lastName: "Person Jones", email: "s@synthetic.invalid", imageUrl: null, username: null },
    });
  });

  it("signed out is loaded with no user", async () => {
    on();
    await vi.waitFor(() => expect(read()).toEqual({ isLoaded: true, user: null }));
  });

  it("a one-word name has no last name", async () => {
    sessionUser = { id: "ba_2", name: "Mono", email: "m@synthetic.invalid", image: null };
    on();
    await screen.findByText(/Mono/);
    expect(read().user).toMatchObject({ fullName: "Mono", firstName: "Mono", lastName: null });
  });
});
