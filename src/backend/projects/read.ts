// Project read backend (Phase C, C05). One small interface the project page
// calls for anonymous visitors; each backend implements it and returns the
// C02 public contract. Deliberately not a "use server" module: Next 16 would
// expose every export of one as a callable server action (Phase B, B13).
import type { PublicProject } from "./public-project";

export interface ProjectReadBackend {
  readonly name: "supabase" | "convex";
  /**
   * The public projection of a listed project, or null. Private, deleted,
   * purged and missing projects all return null, so callers can't tell them
   * apart. Takes no viewer identity: this is the anonymous read only.
   */
  getPublicProjectBySlug(slug: string): Promise<PublicProject | null>;
}
