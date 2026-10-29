// @vitest-environment jsdom
// FLAKE-HYD-HOME: the home page and HeroSection pick the hero or its loading
// skeleton from useDisplayUser().isLoaded. The server always renders Clerk as
// not loaded; when clerk-js has loaded before React hydrates, the first client
// render must still match that HTML, then show the hero.
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({ isLoaded: false, user: null as null | Record<string, unknown> }));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: clerk.user, isLoaded: clerk.isLoaded }),
  useAuth: () => ({ userId: clerk.user ? "user_fixture_a" : clerk.isLoaded ? null : undefined }),
}));

import { AuthBackendProvider, type AuthBackend } from "@/backend/auth/context";
import { useDisplayUser } from "@/components/auth/useDisplayUser";

/** The home page's gate, as in src/app/page.tsx and HeroSection. */
function HomeGate() {
  const { isLoaded, user } = useDisplayUser();
  return isLoaded ? <h1>{`Hello ${user?.firstName ?? "guest"}`}</h1> : <div className="skeleton" />;
}

async function hydrateWith(backend: AuthBackend, client: { isLoaded: boolean; user: Record<string, unknown> | null }) {
  const tree = (
    <AuthBackendProvider backend={backend}>
      <HomeGate />
    </AuthBackendProvider>
  );
  clerk.isLoaded = false;
  clerk.user = null;
  const container = document.createElement("div");
  container.innerHTML = renderToString(tree);
  document.body.appendChild(container);
  Object.assign(clerk, client);
  const errors: unknown[] = [];
  await act(async () => {
    hydrateRoot(container, tree, { onRecoverableError: (e) => errors.push(e) });
  });
  return { errors, container };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FLAKE-HYD-HOME: useDisplayUser during hydration", () => {
  it("server HTML is the skeleton", () => {
    clerk.isLoaded = true;
    clerk.user = { firstName: "Clerk" };
    expect(renderToString(<AuthBackendProvider backend="clerk"><HomeGate /></AuthBackendProvider>)).toBe('<div class="skeleton"></div>');
  });

  it("hydrates without a mismatch when Clerk loaded before hydration (signed out), then shows the hero", async () => {
    const { errors, container } = await hydrateWith("clerk", { isLoaded: true, user: null });
    expect(errors).toEqual([]);
    expect(container.textContent).toBe("Hello guest");
  });

  it("hydrates without a mismatch when Clerk loaded before hydration (signed in), then greets the user", async () => {
    const { errors, container } = await hydrateWith("clerk", { isLoaded: true, user: { firstName: "Clerk", fullName: "Clerk Fixture" } });
    expect(errors).toEqual([]);
    expect(container.textContent).toBe("Hello Clerk");
  });

  it("stays on the skeleton while Clerk is still loading", async () => {
    const { errors, container } = await hydrateWith("clerk", { isLoaded: false, user: null });
    expect(errors).toEqual([]);
    expect(container.innerHTML).toBe('<div class="skeleton"></div>');
  });
});
