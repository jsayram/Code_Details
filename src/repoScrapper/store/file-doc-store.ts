// X2: DocStore on the local disk. Layout (unchanged from before X2):
//
//   <root>/<slug>/_meta.json       the metadata record, pretty-printed JSON
//   <root>/<slug>/<NN>_<title>.md  one file per chapter, YAML frontmatter first
//
// Every slug and chapter name is checked before it is joined onto the root,
// so no caller can read or write outside it. Server-only (node:fs).
import fs from "node:fs/promises";
import path from "node:path";
import {
  createChapterFilename,
  createFrontmatter,
  isSafeChapterFilename,
  isSafeDocSlug,
  type DocFile,
  type DocMeta,
  type DocStore,
  type NewChapter,
} from "./doc-store";

const META_FILE = "_meta.json";

/** The doc's directory under `root`; throws for an unsafe slug. */
export function docDir(slug: string, root: string): string {
  if (!isSafeDocSlug(slug)) throw new Error("unsafe doc slug");
  return path.join(root, slug);
}

const isMissing = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

export class FileDocStore<TMeta extends DocMeta = DocMeta> implements DocStore<TMeta> {
  constructor(readonly root: string) {}

  private dir(slug: string): string {
    return docDir(slug, this.root);
  }

  private async ensureDir(slug: string): Promise<string> {
    const dir = this.dir(slug);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private chapterPath(slug: string, filename: string): string {
    if (!isSafeChapterFilename(filename)) throw new Error("unsafe chapter filename");
    return path.join(this.dir(slug), filename);
  }

  async saveChapter(slug: string, chapter: NewChapter): Promise<string> {
    const filename = createChapterFilename(chapter.order, chapter.title);
    const filepath = this.chapterPath(slug, filename);
    await this.ensureDir(slug);
    const frontmatter = createFrontmatter({
      title: chapter.title,
      order: chapter.order,
      generatedAt: new Date().toISOString(),
      abstractionsCovered: chapter.abstractionsCovered,
    });
    await fs.writeFile(filepath, frontmatter + chapter.content, "utf-8");
    return filename;
  }

  async saveMeta(slug: string, meta: Omit<TMeta, "projectSlug">): Promise<void> {
    const dir = await this.ensureDir(slug);
    const fullMeta = { projectSlug: slug, ...meta };
    await fs.writeFile(path.join(dir, META_FILE), JSON.stringify(fullMeta, null, 2), "utf-8");
  }

  async readMeta(slug: string): Promise<TMeta | null> {
    try {
      const content = await fs.readFile(path.join(this.dir(slug), META_FILE), "utf-8");
      return JSON.parse(content) as TMeta;
    } catch {
      return null;
    }
  }

  async updateMeta(slug: string, updates: Partial<TMeta>): Promise<TMeta | null> {
    try {
      const current = await this.readMeta(slug);
      if (!current) return null;
      const updated: TMeta = { ...current, ...updates, projectSlug: slug };
      await fs.writeFile(path.join(this.dir(slug), META_FILE), JSON.stringify(updated, null, 2), "utf-8");
      return updated;
    } catch {
      return null;
    }
  }

  async listDocs(): Promise<TMeta[]> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      const docs: TMeta[] = [];
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const meta = await this.readMeta(entry.name);
          if (meta) docs.push(meta);
        }
      }
      docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return docs;
    } catch {
      return [];
    }
  }

  async readChapter(slug: string, filename: string): Promise<string | null> {
    if (!isSafeDocSlug(slug) || !isSafeChapterFilename(filename)) return null;
    try {
      return await fs.readFile(this.chapterPath(slug, filename), "utf-8");
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async writeChapter(slug: string, filename: string, raw: string): Promise<boolean> {
    if (!isSafeDocSlug(slug) || !isSafeChapterFilename(filename)) return false;
    const filepath = this.chapterPath(slug, filename);
    try {
      await fs.access(filepath);
    } catch {
      return false;
    }
    await fs.writeFile(filepath, raw, "utf-8");
    return true;
  }

  async exportFiles(slug: string): Promise<DocFile[]> {
    const dir = this.dir(slug);
    const files: DocFile[] = [];
    for (const name of await fs.readdir(dir)) {
      if (name.endsWith(".md") || name.endsWith(".json")) {
        files.push({ name, content: await fs.readFile(path.join(dir, name), "utf-8") });
      }
    }
    return files;
  }

  async deleteDoc(slug: string): Promise<boolean> {
    try {
      await fs.rm(this.dir(slug), { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
}
