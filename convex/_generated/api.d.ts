/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountDeletion from "../accountDeletion.js";
import type * as accountRules from "../accountRules.js";
import type * as accounts from "../accounts.js";
import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as authRules from "../authRules.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as emailLinks from "../emailLinks.js";
import type * as favorites from "../favorites.js";
import type * as fixtures from "../fixtures.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as importCore from "../importCore.js";
import type * as importer from "../importer.js";
import type * as profiles from "../profiles.js";
import type * as projectImages from "../projectImages.js";
import type * as projectLifecycle from "../projectLifecycle.js";
import type * as projects from "../projects.js";
import type * as roles from "../roles.js";
import type * as tagWriter from "../tagWriter.js";
import type * as tags from "../tags.js";
import type * as viewer from "../viewer.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountDeletion: typeof accountDeletion;
  accountRules: typeof accountRules;
  accounts: typeof accounts;
  admin: typeof admin;
  auth: typeof auth;
  authRules: typeof authRules;
  crons: typeof crons;
  email: typeof email;
  emailLinks: typeof emailLinks;
  favorites: typeof favorites;
  fixtures: typeof fixtures;
  http: typeof http;
  identity: typeof identity;
  importCore: typeof importCore;
  importer: typeof importer;
  profiles: typeof profiles;
  projectImages: typeof projectImages;
  projectLifecycle: typeof projectLifecycle;
  projects: typeof projects;
  roles: typeof roles;
  tagWriter: typeof tagWriter;
  tags: typeof tags;
  viewer: typeof viewer;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
