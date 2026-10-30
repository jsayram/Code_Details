// @vitest-environment jsdom
// D07x: a refused favorite surfaces. addProjectFavorite/removeProjectFavorite
// answer { success: false, error } instead of throwing; the list used to
// ignore that, show "Added to favorites" and move the card's count. It must
// show the error and leave the card as it was. The heavy children are
// stand-ins: the card view only exposes the toggle the real cards call.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/types/models/project";

const actions = vi.hoisted(() => ({
  addProjectFavorite: vi.fn(),
  removeProjectFavorite: vi.fn(),
  removeProject: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }));
const setProjects = vi.hoisted(() => vi.fn());

vi.mock("@/app/actions/projects", () => actions);
vi.mock("sonner", () => ({ toast }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: null }),
  useSession: () => ({ session: null }),
  SignInButton: () => null,
}));
vi.mock("@/components/auth/AuthGate", () => ({ useViewerId: () => "viewer-1" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/hooks/use-category-counts", () => ({ useCategoryCounts: () => ({ hasCategoryProjects: () => true }) }));
vi.mock("@/components/filters", () => ({ SortBySelect: () => null, CategorySelect: () => null }));
vi.mock("@/components/navigation/Pagination/PaginationControlComponent", () => ({ PaginationControls: () => null }));
vi.mock("@/components/Elements/CodeParticlesElement", () => ({ CodeParticlesElement: () => null }));
vi.mock("@/components/LoadingState/ProjectListLoadingState", () => ({ ProjectListLoadingState: () => null }));
vi.mock("@/components/auth/SignInButtonComponent", () => ({ SignInButtonComponent: () => null }));
vi.mock("@/components/Projects/ShareProjectsButton", () => ({ default: () => null }));
vi.mock("@/components/Projects/ProjectComponents/ProjectFormComponent", () => ({ ProjectForm: () => null }));
vi.mock("@/components/Projects/ProjectComponents/ProjectTableViewComponent", () => ({ ProjectTableView: () => null }));
vi.mock("@/components/Projects/ProjectComponents/ProjectCardViewComponent", () => ({
  ProjectCardView: ({ projects, onToggleFavorite }: { projects: Project[]; onToggleFavorite: (id: string, fav: boolean) => void }) => (
    <ul>
      {projects.map((p) => (
        <li key={p.id}>
          {p.title}: {String(p.total_favorites)}
          <button onClick={() => onToggleFavorite(p.id, !p.isFavorite)}>{p.isFavorite ? "Remove from favorites" : "Add to favorites"}</button>
        </li>
      ))}
    </ul>
  ),
}));

const project = { id: "k1", title: "Fixture One Tag", slug: "fixture-one-tag", total_favorites: "0", isFavorite: false, tags: [] } as unknown as Project;
vi.mock("@/providers/projects-provider", () => ({
  useProjects: () => ({
    projects: [project],
    loading: false,
    isAuthenticated: true,
    filters: { sortBy: "newest", category: "all", showMyProjects: false, showFavorites: false, showDeleted: false, page: 1, limit: 12 },
    setFilters: vi.fn(),
    setProjects,
    pagination: { total: 1, totalPages: 1, currentPage: 1 },
    handleProjectAdded: vi.fn(),
    handleProjectDeleted: vi.fn(),
    handleProjectUpdated: vi.fn(),
    refreshProjects: vi.fn(),
  }),
}));

import { ProjectList } from "@/components/Projects/ProjectComponents/ProjectListComponent";

describe("D07x a refused favorite on a list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("shows the action's error and leaves the card unchanged", async () => {
    actions.addProjectFavorite.mockResolvedValue({ success: false, error: "You must be signed in to favorite a project" });
    render(<ProjectList currentPage={1} onPageChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to favorites" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You must be signed in to favorite a project"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(setProjects).not.toHaveBeenCalled();
  });

  it("an accepted favorite still updates the card and says so", async () => {
    actions.addProjectFavorite.mockResolvedValue({ success: true, data: undefined });
    render(<ProjectList currentPage={1} onPageChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to favorites" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Added to favorites"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(setProjects).toHaveBeenCalledTimes(1);
  });
});
