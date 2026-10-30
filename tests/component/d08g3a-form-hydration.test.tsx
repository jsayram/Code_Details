// @vitest-environment jsdom
// f7 (D08g3a): what the browser holds in the auth forms when React hydrates
// (typed early, or autofilled) survives hydration, and nothing can submit the
// form natively before its handler exists.
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const nav = vi.hoisted(() => ({ path: "/sign-up", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

const tree = (node: ReactNode) => <>{node}</>;

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function typeThenHydrate(node: ReactNode, values: Record<string, string>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("null", { status: 200 })));
  const html = renderToString(tree(node));
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const serverDisabled = submit.disabled;
  for (const [name, value] of Object.entries(values)) container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value = value;
  const errors: unknown[] = [];
  await act(async () => {
    hydrateRoot(container, tree(node), { onRecoverableError: (e) => errors.push(e) });
  });
  return { container, serverDisabled, submit, errors };
}

describe("f7: auth forms keep input typed before hydration", () => {
  it("sign-up: name, email and password survive, and Continue is disabled until hydrated", async () => {
    nav.path = "/sign-up";
    const values = { name: "Early Person", email: "early@synthetic.invalid", password: "typed-before-hydration" };
    const { container, serverDisabled, submit, errors } = await typeThenHydrate(<SignUpComponent />, values);
    expect(errors).toEqual([]);
    for (const [name, value] of Object.entries(values)) expect(container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value, name).toBe(value);
    expect(serverDisabled).toBe(true);
    expect(submit.disabled).toBe(false);
  });

  it("sign-in: email and password survive", async () => {
    nav.path = "/sign-in";
    const values = { email: "early@synthetic.invalid", password: "typed-before-hydration" };
    const { container, serverDisabled, errors } = await typeThenHydrate(<SignInComponent />, values);
    expect(errors).toEqual([]);
    for (const [name, value] of Object.entries(values)) expect(container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value, name).toBe(value);
    expect(serverDisabled).toBe(true);
  });

  it("the forms post (never GET) if they were ever sent natively", () => {
    nav.path = "/sign-in";
    const html = renderToString(tree(<SignInComponent />));
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form(?![^>]*method="post")[^>]*>/);
  });
});
