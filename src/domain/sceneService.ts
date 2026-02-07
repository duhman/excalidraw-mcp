import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import type { BrowserEngine } from "../engines/browserEngine.js";
import { JsonEngine } from "../engines/jsonEngine.js";
import type { SceneStore } from "./sceneStore.js";
import type { ExportOptions, SceneEnvelope, ScenePatchOperation, SceneMetadata } from "../types/contracts.js";
import { AppError } from "../utils/errors.js";
import { applyDiagramQuality } from "./diagramQuality.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function createSceneMetadata(sceneId: string, name: string): SceneMetadata {
  const now = nowIso();
  return {
    sceneId,
    name,
    createdAt: now,
    updatedAt: now,
    elementCount: 0,
    fileCount: 0,
    engineHints: {
      hasFrames: false,
      hasEmbeddables: false,
      hasImages: false
    },
    revisionHash: ""
  };
}

export class SceneService {
  private readonly store: SceneStore;
  private readonly jsonEngine: JsonEngine;
  private readonly browserEngine: BrowserEngine;
  private readonly sceneLocks = new Map<string, Promise<void>>();
  private readonly sessionActiveScene = new Map<string, string>();

  constructor(store: SceneStore, jsonEngine: JsonEngine, browserEngine: BrowserEngine) {
    this.store = store;
    this.jsonEngine = jsonEngine;
    this.browserEngine = browserEngine;
  }

  async createScene(input: { sceneId?: string; name?: string; elements?: any[]; appState?: Record<string, unknown> }): Promise<SceneEnvelope> {
    const sceneId = input.sceneId ?? uuidv4();

    if (await this.store.exists(sceneId)) {
      throw new AppError("CONFLICT", `Scene already exists: ${sceneId}`, 409, { sceneId });
    }

    const scene: SceneEnvelope = this.jsonEngine.normalize({
      metadata: createSceneMetadata(sceneId, input.name ?? `Scene ${sceneId.slice(0, 8)}`),
      elements: input.elements ?? [],
      appState: input.appState ?? {},
      files: {},
      libraryItems: []
    });

    await this.store.save(scene);
    return scene;
  }

  async listScenes(): Promise<SceneMetadata[]> {
    return this.store.listMetadata();
  }

  async openScene(sceneId: string, sessionId: string): Promise<SceneEnvelope> {
    const scene = await this.store.load(sceneId);
    this.sessionActiveScene.set(sessionId, sceneId);
    return scene;
  }

  async closeScene(sceneId: string, sessionId: string): Promise<{ closed: boolean }> {
    const current = this.sessionActiveScene.get(sessionId);
    if (current === sceneId) {
      this.sessionActiveScene.delete(sessionId);
    }

    return { closed: true };
  }

  async getScene(sceneId: string): Promise<SceneEnvelope> {
    return this.store.load(sceneId);
  }

  async getActiveScene(sessionId: string): Promise<SceneEnvelope | null> {
    const activeId = this.sessionActiveScene.get(sessionId);
    if (!activeId) {
      return null;
    }

    return this.getScene(activeId);
  }

  async saveScene(sceneId: string): Promise<SceneEnvelope> {
    const scene = await this.store.load(sceneId);
    await this.store.save(scene);
    return scene;
  }

  async patchScene(sceneId: string, operations: ScenePatchOperation[]): Promise<{ scene: SceneEnvelope; changedElementIds: string[] }> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const patched = this.jsonEngine.applyPatch(scene, operations);
      await this.store.save(patched.scene);
      return patched;
    });
  }

  async validateScene(
    sceneId: string
  ): Promise<{
    valid: boolean;
    issues: string[];
    qualityIssues: Array<{
      code: string;
      severity: string;
      message: string;
      elementId: string;
      details?: Record<string, unknown>;
    }>;
    revisionHash: string;
  }> {
    const scene = await this.store.load(sceneId);
    const issues: string[] = [];

    const elementIds = new Set<string>();
    for (const element of scene.elements) {
      if (!element?.id) {
        issues.push("Element missing id");
        continue;
      }

      if (elementIds.has(element.id)) {
        issues.push(`Duplicate element id: ${element.id}`);
      }
      elementIds.add(element.id);
    }

    for (const fileId of Object.keys(scene.files)) {
      const file = scene.files[fileId];
      if (!file?.dataURL || !String(file.dataURL).startsWith("data:")) {
        issues.push(`Invalid file data URL: ${fileId}`);
      }
    }
    const quality = applyDiagramQuality(scene, false);

    return {
      valid: issues.length === 0 && quality.issues.filter((issue) => issue.severity === "error").length === 0,
      issues,
      qualityIssues: quality.issues,
      revisionHash: scene.metadata.revisionHash
    };
  }

  async normalizeScene(sceneId: string): Promise<SceneEnvelope> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const normalized = this.jsonEngine.normalize(scene);
      await this.store.save(normalized);
      return normalized;
    });
  }

  async listElements(sceneId: string, options: { includeDeleted?: boolean; type?: string; limit?: number }): Promise<any[]> {
    const scene = await this.store.load(sceneId);
    let elements = scene.elements;

    if (!options.includeDeleted) {
      elements = elements.filter((element) => !element.isDeleted);
    }

    if (options.type) {
      elements = elements.filter((element) => element.type === options.type);
    }

    if (options.limit && options.limit > 0) {
      elements = elements.slice(0, options.limit);
    }

    return elements;
  }

  async getAppState(sceneId: string): Promise<Record<string, unknown>> {
    const scene = await this.store.load(sceneId);
    return scene.appState;
  }

  async patchAppState(sceneId: string, appState: Record<string, unknown>, merge = true): Promise<Record<string, unknown>> {
    const result = await this.patchScene(sceneId, [
      {
        op: "setAppState",
        appState,
        merge
      }
    ]);

    return result.scene.appState;
  }

  async attachFile(
    sceneId: string,
    input: { fileId?: string; mimeType: string; base64: string }
  ): Promise<{ fileId: string; deduplicated: boolean; sizeBytes: number }> {
    const buffer = Buffer.from(input.base64, "base64");
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new AppError("BAD_REQUEST", "File exceeds max size", 400, {
        maxBytes: MAX_FILE_BYTES,
        actualBytes: buffer.byteLength
      });
    }

    const hash = createHash("sha256").update(buffer).digest("hex");

    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);

      for (const [existingId, existing] of Object.entries(scene.files)) {
        if (createHash("sha256").update(String((existing as any).dataURL ?? "")).digest("hex") === hash) {
          return {
            fileId: existingId,
            deduplicated: true,
            sizeBytes: buffer.byteLength
          };
        }
      }

      const fileId = input.fileId ?? uuidv4();
      const dataURL = `data:${input.mimeType};base64,${input.base64}`;
      const nextFile = {
        id: fileId,
        mimeType: input.mimeType,
        dataURL,
        created: Date.now(),
        lastRetrieved: Date.now(),
        version: 1
      };

      const nextScene = this.jsonEngine.normalize({
        ...scene,
        files: {
          ...scene.files,
          [fileId]: nextFile
        }
      });

      await this.store.save(nextScene);
      return {
        fileId,
        deduplicated: false,
        sizeBytes: buffer.byteLength
      };
    });
  }

  async detachFile(sceneId: string, fileId: string): Promise<{ removed: boolean }> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      if (!scene.files[fileId]) {
        return { removed: false };
      }

      const nextFiles = { ...scene.files };
      delete nextFiles[fileId];

      const nextScene = this.jsonEngine.normalize({
        ...scene,
        files: nextFiles
      });

      await this.store.save(nextScene);
      return { removed: true };
    });
  }

  async getLibrary(sceneId: string): Promise<any[]> {
    const scene = await this.store.load(sceneId);
    return scene.libraryItems;
  }

  async updateLibrary(sceneId: string, libraryItems: any[], merge: boolean): Promise<any[]> {
    const result = await this.patchScene(sceneId, [
      {
        op: "setLibrary",
        libraryItems,
        merge
      }
    ]);

    return result.scene.libraryItems;
  }

  async diagramFromMermaid(input: {
    sceneId?: string;
    definition: string;
    merge?: boolean;
    name?: string;
  }): Promise<{ scene: SceneEnvelope; createdScene: boolean }> {
    const parsed = await parseMermaidToExcalidraw(input.definition);

    if (!input.sceneId) {
      const scene = await this.createScene({
        name: input.name ?? "Mermaid Diagram",
        elements: parsed.elements
      });

      if (parsed.files) {
        const withFiles = this.jsonEngine.normalize({
          ...scene,
          files: parsed.files as any
        });
        await this.store.save(withFiles);
        return { scene: withFiles, createdScene: true };
      }

      return {
        scene,
        createdScene: true
      };
    }

    return this.withSceneLock(input.sceneId, async () => {
      const scene = await this.store.load(input.sceneId!);
      const nextScene = this.jsonEngine.normalize({
        ...scene,
        elements: input.merge === false ? parsed.elements : [...scene.elements, ...(parsed.elements as any[])],
        files: input.merge === false ? (parsed.files as any) ?? {} : { ...scene.files, ...(parsed.files as any) }
      });

      await this.store.save(nextScene);

      return {
        scene: nextScene,
        createdScene: false
      };
    });
  }

  async fitToContent(sceneId: string): Promise<SceneEnvelope> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const fitted = this.jsonEngine.fitToContent(scene);
      await this.store.save(fitted);
      return fitted;
    });
  }

  async scrollToContent(sceneId: string): Promise<{ appState: Record<string, unknown> }> {
    const fitted = await this.fitToContent(sceneId);
    return { appState: fitted.appState };
  }

  async exportScene(sceneId: string, options: ExportOptions): Promise<{
    mimeType: string;
    base64: string;
    width: number;
    height: number;
  }> {
    const scene = await this.store.load(sceneId);
    return this.browserEngine.exportScene(scene, options);
  }

  async resetSession(sessionId: string): Promise<{ clearedActiveScene: boolean }> {
    const hadScene = this.sessionActiveScene.delete(sessionId);
    return { clearedActiveScene: hadScene };
  }

  async health(): Promise<{
    browser: { ready: boolean; details: string };
    storeRoot: string;
  }> {
    return {
      browser: await this.browserEngine.health(),
      storeRoot: this.store.rootPath
    };
  }

  private async withSceneLock<T>(sceneId: string, fn: () => Promise<T>): Promise<T> {
    const current = this.sceneLocks.get(sceneId) ?? Promise.resolve();
    let release: ((value?: void | PromiseLike<void>) => void) | undefined;

    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.sceneLocks.set(sceneId, current.then(() => next));

    try {
      await current;
      return await fn();
    } finally {
      release?.();
      if (this.sceneLocks.get(sceneId) === next) {
        this.sceneLocks.delete(sceneId);
      }
    }
  }
}
