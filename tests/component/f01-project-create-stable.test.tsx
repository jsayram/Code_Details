// @vitest-environment jsdom
// F01-15: ProjectContent resets its form whenever its project prop changes, and
// /projects/new re-renders on every session refresh with a new userProfile
// object. The create component must keep handing it the same empty project.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelectUserWithProject } from "@/types/rows";

const seen = vi.hoisted(() => [] as unknown[]);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/Projects/ProjectComponents/ProjectContent", () => ({
  ProjectContent: ({ project }: { project: unknown }) => {
    seen.push(project);
    return null;
  },
}));

import { ProjectCreateComponent } from "@/components/Projects/ProjectComponents/ProjectCreateComponent";

const profile = (userId: string, name: string) => ({ user_id: userId, full_name: name }) as unknown as SelectUserWithProject;

afterEach(() => {
  cleanup();
  seen.length = 0;
});

describe("F01-15 ProjectCreateComponent", () => {
  it("passes the same empty project across re-renders for the same user", () => {
    const { rerender } = render(<ProjectCreateComponent userProfile={profile("ba_1", "Synthetic Person")} />);
    rerender(<ProjectCreateComponent userProfile={profile("ba_1", "Synthetic Person")} />);
    rerender(<ProjectCreateComponent userProfile={profile("ba_1", "Renamed Person")} />);
    expect(seen.length).toBe(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
  });

  it("a different user gets a fresh empty project", () => {
    const { rerender } = render(<ProjectCreateComponent userProfile={profile("ba_1", "A")} />);
    rerender(<ProjectCreateComponent userProfile={profile("ba_2", "B")} />);
    expect(seen[1]).not.toBe(seen[0]);
    expect((seen[1] as { user_id: string }).user_id).toBe("ba_2");
  });
});
