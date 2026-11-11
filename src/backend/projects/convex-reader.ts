// Convex implementation of the public project read (Phase C, C15). Calls the
// anonymous projects:getPublicBySlug query over HTTP from the server; no
// Convex client code or provider reaches the browser. Only ever constructed
// by getProjectReadBackend() when the development-only switch allows it.
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { ProjectReadBackend } from "./read";
import { type PublicProject, assertPublicProject } from "./public-project";

const getPublicBySlug = makeFunctionReference<"query", { slug: string }, PublicProject | null>("projects:getPublicBySlug");
const currentSlug = makeFunctionReference<"query", { slug: string }, string | null>("projects:currentSlug");

export function convexProjectReader(url: string): ProjectReadBackend {
  const client = new ConvexHttpClient(url, { skipConvexDeploymentUrlCheck: true });
  return {
    name: "convex",
    async getPublicProjectBySlug(slug: string): Promise<PublicProject | null> {
      const result = await client.query(getPublicBySlug, { slug });
      if (result !== null) assertPublicProject(result);
      return result;
    },
    async getCurrentSlug(slug: string): Promise<string | null> {
      return await client.query(currentSlug, { slug });
    },
  };
}
