// D04c: what a profile's public statistics should be, computed straight from
// the fixture spec (B09) rather than from either backend. `countsPrivate` is
// true for Supabase, which has no visibility column (every active project is
// public there); Convex counts listed (active and public) projects only.
import type { FixtureSet, PersonaKey } from "../fixtures/generate";

export function expectedProfileStats(set: FixtureSet, key: PersonaKey, countsPrivate: boolean) {
  const shown = (p: FixtureSet["projects"][number]) => !p.purged && !p.deletedAt && (countsPrivate || p.visibility === "public");
  const favs = (projectId: string) => set.favorites.filter((f) => f.projectId === projectId).length;
  const own = set.projects.filter((p) => p.ownerKey === key && shown(p));
  const given = set.favorites
    .map((f) => ({ f, project: set.projects.find((p) => p.id === f.projectId)! }))
    .filter(({ f, project }) => f.personaKey === key && shown(project));
  const likes = own.reduce((n, p) => n + favs(p.id), 0);
  const top = [...own].sort((a, b) => favs(b.id) - favs(a.id))[0];
  return {
    activeProjects: own.length,
    totalProjects: own.length,
    totalLikes: likes,
    projectsReceivedFavorites: likes,
    totalTags: new Set(own.flatMap((p) => p.tagIds)).size,
    projectsFavorited: new Set(given.map(({ project }) => project.id)).size,
    communityProjects: new Set(given.filter(({ project }) => project.ownerKey !== key).map(({ project }) => project.id)).size,
    mostLikedFavorites: top ? favs(top.id) : null,
  };
}
