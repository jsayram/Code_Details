// D06-b: project images on Convex, behind the development switches. Reads go
// to Convex whenever the project read does (the page hands the client a
// Convex project ID); writes only when project writes do (both switches on
// the same local backend, projectWritesToConvex). The mutations learn the
// caller from the Better Auth session (getViewer); no user, path or URL is
// ever sent. Server-side only; src/app/actions/project-images.ts calls it.
//
// Results are mapped onto the row shape the image components already read
// (SelectProjectImage). storage_path is "" and uploaded_by is "": Convex never
// exposes either, and an empty path tells the client there is no file for the
// browser to delete (the server deletes it).
import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { viewerMutation, viewerQueryWithArgs } from "@/lib/auth-server";
import {
  forbiddenError,
  notFoundError,
  unauthorizedError,
  validationError,
  type ActionError,
} from "@/lib/action-errors";
import type { ImageType, SelectProjectImage } from "@/types/project-images";
import { chooseProjectReadBackend } from "./index";
import { personalReadsFromConvex } from "./personal";
import { projectWritesToConvex } from "./project-update";

interface ImageView {
  id: string;
  projectId: string;
  kind: ImageType;
  url: string | null;
  displayOrder: number;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  altText: string | null;
  caption: string | null;
  createdAt: number;
}
type Failure = { ok: false; code: "not_found" | "private_project" | "limit" | "invalid"; message?: string };

export type AttachInput = {
  projectId: string;
  storageId: string;
  kind: ImageType;
  fileName: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  altText?: string;
  caption?: string;
};

const refs = {
  list: makeFunctionReference<"query", { projectId: string; kind?: ImageType }, ImageView[] | null>("projectImages:listForProject"),
  cover: makeFunctionReference<"query", { projectId: string }, ImageView | null>("projectImages:coverForProject"),
  uploadUrl: makeFunctionReference<"mutation", { projectId: string; kind: ImageType }, { ok: true; uploadUrl: string } | Failure>(
    "projectImages:generateUploadUrl",
  ),
  attach: makeFunctionReference<"mutation", AttachInput, { ok: true; image: ImageView } | Failure>("projectImages:attach"),
  reorder: makeFunctionReference<
    "mutation",
    { projectId: string; order: { imageId: string; displayOrder: number }[] },
    { ok: true } | Failure
  >("projectImages:reorder"),
  setCover: makeFunctionReference<"mutation", { imageId: string }, { ok: true; image: ImageView } | Failure>("projectImages:setCover"),
  softDelete: makeFunctionReference<"mutation", { imageId: string }, { ok: true } | Failure>("projectImages:softDelete"),
  purge: makeFunctionReference<"mutation", { imageId: string }, { ok: true } | Failure>("projectImages:purge"),
};

/** True when image reads come from Convex: the project read does, so the client holds Convex IDs. */
export function imageReadsFromConvex(env: Record<string, string | undefined> = process.env): boolean {
  return chooseProjectReadBackend(env).backend === "convex";
}

/** True when image writes go to Convex (the same rule as the other project writes). */
export function imageWritesToConvex(env: Record<string, string | undefined> = process.env): boolean {
  return projectWritesToConvex(env);
}

function toRow(image: ImageView): SelectProjectImage {
  return {
    id: image.id,
    project_id: image.projectId,
    storage_path: "",
    storage_url: image.url ?? "",
    file_name: image.fileName,
    file_size: image.size,
    mime_type: image.mimeType,
    width: image.width,
    height: image.height,
    image_type: image.kind,
    aspect_ratio: image.aspectRatio,
    display_order: image.displayOrder,
    alt_text: image.altText,
    caption: image.caption,
    uploaded_by: "",
    created_at: new Date(image.createdAt),
    deleted_at: null,
  };
}

function failure(result: Failure, what: string): ActionError {
  switch (result.code) {
    case "private_project":
      return forbiddenError("Private projects can't have images yet");
    case "limit":
      return validationError(`Maximum number of ${what} images reached. Please delete an existing image first.`);
    case "invalid":
      return validationError(result.message ?? "Invalid image");
    default:
      return notFoundError(what === "project" ? "Project" : "Image");
  }
}

// A signed-in owner needs the session (a deleted project's images are theirs
// only); everyone else reads anonymously from the read backend's URL.
async function read<Args extends Record<string, unknown>, R>(
  ref: Parameters<typeof viewerQueryWithArgs<Args, R>>[0],
  args: Args,
): Promise<R> {
  if (personalReadsFromConvex()) {
    const answer = await viewerQueryWithArgs(ref, args);
    if (answer) return answer.result;
  }
  const choice = chooseProjectReadBackend();
  if (choice.backend !== "convex") throw new Error("image read from Convex without the read switch");
  const anonymous = ref as unknown as FunctionReference<"query", "public", Record<string, unknown>, R>;
  return (await fetchQuery(anonymous, args, { url: choice.url })) as R;
}

export async function listImagesOnConvex(projectId: string, kind?: ImageType): Promise<SelectProjectImage[] | null> {
  const images = await read(refs.list, kind ? { projectId, kind } : { projectId });
  return images ? images.map(toRow) : null;
}

export async function coverImageOnConvex(projectId: string): Promise<SelectProjectImage | null> {
  const cover = await read(refs.cover, { projectId });
  return cover ? toRow(cover) : null;
}

async function write<Args extends Record<string, unknown>, R>(
  ref: Parameters<typeof viewerMutation<Args, R>>[0],
  args: Args,
): Promise<R | null> {
  return (await viewerMutation(ref, args))?.result ?? null;
}

const signedOut = () => unauthorizedError("Authentication required to change images");

export async function imageUploadUrlOnConvex(projectId: string, kind: ImageType): Promise<{ uploadUrl: string } | ActionError> {
  const r = await write(refs.uploadUrl, { projectId, kind });
  if (!r) return signedOut();
  return r.ok ? { uploadUrl: r.uploadUrl } : failure(r, r.code === "limit" ? kind : "project");
}

export async function attachImageOnConvex(input: AttachInput): Promise<SelectProjectImage | ActionError> {
  const r = await write(refs.attach, input);
  if (!r) return signedOut();
  return r.ok ? toRow(r.image) : failure(r, r.code === "limit" ? input.kind : "project");
}

export async function reorderImagesOnConvex(
  projectId: string,
  order: { imageId: string; order: number }[],
): Promise<true | ActionError> {
  const r = await write(refs.reorder, { projectId, order: order.map((o) => ({ imageId: o.imageId, displayOrder: o.order })) });
  if (!r) return signedOut();
  return r.ok ? true : failure(r, "project");
}

export async function setCoverOnConvex(imageId: string): Promise<SelectProjectImage | ActionError> {
  const r = await write(refs.setCover, { imageId });
  if (!r) return signedOut();
  return r.ok ? toRow(r.image) : failure(r, "image");
}

export async function deleteImageOnConvex(imageId: string, permanent: boolean): Promise<true | ActionError> {
  const r = await write(permanent ? refs.purge : refs.softDelete, { imageId });
  if (!r) return signedOut();
  return r.ok ? true : failure(r, "image");
}
