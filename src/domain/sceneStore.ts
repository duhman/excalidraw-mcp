import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureInsideRoot, ensureParentDirectory, sanitizeSceneId } from "../utils/pathSafety.js";
import { AppError } from "../utils/errors.js";
import type { SceneEnvelope, SceneMetadata } from "../types/contracts.js";

interface CachedScene {
  mtimeMs: number;
  scene: SceneEnvelope;
}

export class SceneStore {
  private readonly root: string;
  private readonly cache = new Map<string, CachedScene>();

  constructor(root: string) {
    this.root = root;
  }

  get rootPath(): string {
    return this.root;
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  private scenePath(sceneId: string): string {
    const safeId = sanitizeSceneId(sceneId);
    return ensureInsideRoot(this.root, join(this.root, `${safeId}.excalidraw.json`));
  }

  async listMetadata(): Promise<SceneMetadata[]> {
    await this.init();
    const files = await readdir(this.root, { withFileTypes: true });
    const sceneFiles = files.filter((entry) => entry.isFile() && entry.name.endsWith(".excalidraw.json"));

    const output: SceneMetadata[] = [];
    for (const file of sceneFiles) {
      const sceneId = file.name.replace(/\.excalidraw\.json$/, "");
      const scene = await this.load(sceneId);
      output.push(scene.metadata);
    }

    return output.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(sceneId: string): Promise<SceneEnvelope> {
    const fullPath = this.scenePath(sceneId);
    const fileStats = await stat(fullPath).catch(() => null);

    if (!fileStats) {
      throw new AppError("NOT_FOUND", `Scene not found: ${sceneId}`, 404, { sceneId });
    }

    const cached = this.cache.get(sceneId);
    if (cached && cached.mtimeMs === fileStats.mtimeMs) {
      return structuredClone(cached.scene);
    }

    const raw = await readFile(fullPath, "utf8");
    const parsed = JSON.parse(raw) as SceneEnvelope;

    this.cache.set(sceneId, {
      mtimeMs: fileStats.mtimeMs,
      scene: parsed
    });

    return structuredClone(parsed);
  }

  async save(scene: SceneEnvelope): Promise<void> {
    await this.init();

    const fullPath = this.scenePath(scene.metadata.sceneId);
    const tmpPath = `${fullPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await ensureParentDirectory(fullPath);

    const serialized = JSON.stringify(scene, null, 2);
    await writeFile(tmpPath, serialized, "utf8");
    await rename(tmpPath, fullPath);

    const fileStats = await stat(fullPath);
    this.cache.set(scene.metadata.sceneId, {
      mtimeMs: fileStats.mtimeMs,
      scene: structuredClone(scene)
    });
  }

  async exists(sceneId: string): Promise<boolean> {
    const fullPath = this.scenePath(sceneId);
    const fileStats = await stat(fullPath).catch(() => null);
    return Boolean(fileStats);
  }
}
