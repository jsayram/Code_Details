// @vitest-environment jsdom
// FLAKE-HYD-HOME: the home page and HeroSection pick the hero or its loading
// skeleton from useDisplayUser().isLoaded. The server always renders the login
// as not loaded; when the session is known before React hydrates, the first
// client render must still match that HTML, then show the hero. D08g4f2: the
// session is Better Auth's (Clerk is gone); the race is the same one clerk-js
// loading early caused.
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

type User = { id: string; name: string; email: string; image: string | null };
const auth = vi.hoisted(() => ({ state: { status: "loading" } as { status: "loading" } | { status: "ready"; user: User | null } }));
vi.mock("@/lib/auth-session", () => ({ useBetterAuthSession: () => auth.state }));

import { useDisplayUser } from "@/components/auth/useDisplayUser";

/** The home page's gate, as in src/app/page.tsx and HeroSection. */
function HomeGate() {
  const { isLoaded, user } = useDisplayUser();
  return isLoaded ? <h1>{`Hello ${user?.firstName ?? "guest"}`}</h1> : <div className="skeleton" />;
}

async function hydrateWith(client: typeof auth.state) {
  auth.state = { status: "loading" };
  const container = document.createElement("div");
  container.innerHTML = renderToString(<HomeGate />);
  document.body.appendChild(container);
  auth.state = client;
  const errors: unknown[] = [];
  await act(async () => {
    hydrateRoot(container, <HomeGate />, { onRecoverableError: (e) => errors.push(e) });
  });
  return { errors, container };
}

afterEach(() => {
  document.body.innerHTML = "";
});

const fixture: User = { id: "u1", name: "Synthetic Fixture", email: "a@synthetic.invalid", image: null };

describe("FLAKE-HYD-HOME: useDisplayUser during hydration", () => {
  it("server HTML is the skeleton, even with the session known", () => {
    auth.state = { status: "ready", user: fixture };
    expect(renderToString(<HomeGate />)).toBe('<div class="skeleton"></div>');
  });

  it("hydrates without a mismatch when the session is known before hydration (signed out), then shows the hero", async () => {
    const { errors, container } = await hydrateWith({ status: "ready", user: null });
    expect(errors).toEqual([]);
    expect(container.textContent).toBe("Hello guest");
  });

  it("hydrates without a mismatch when the session is known before hydration (signed in), then greets the user", async () => {
    const { errors, container } = await hydrateWith({ status: "ready", user: fixture });
    expect(errors).toEqual([]);
    expect(container.textContent).toBe("Hello Synthetic");
  });

  it("stays on the skeleton while the session is still loading", async () => {
    const { errors, container } = await hydrateWith({ status: "loading" });
    expect(errors).toEqual([]);
    expect(container.innerHTML).toBe('<div class="skeleton"></div>');
  });
});
