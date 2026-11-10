// @vitest-environment jsdom
// UI11: the project editor's link rows had two icon-only buttons (remove and
// check) with no name; the acceptance sweep found them on a project with a link.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ProjectLinksManager } from "@/components/Projects/ProjectComponents/ProjectLinksManager";

afterEach(cleanup);

it("names the remove and check buttons of every link row", () => {
  render(
    <ProjectLinksManager
      initialLinks={[
        { type: "repository", url: "https://example.synthetic.invalid/one" },
        { type: "demo", url: "https://example.synthetic.invalid/two" },
      ]}
      onChange={() => {}}
    />,
  );
  for (const n of [1, 2]) {
    expect(screen.getByRole("button", { name: `Remove link ${n}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Check link ${n}` })).toBeTruthy();
  }
  for (const b of screen.getAllByRole("button")) expect(b.getAttribute("aria-label") ?? b.textContent?.trim()).toBeTruthy();
});
