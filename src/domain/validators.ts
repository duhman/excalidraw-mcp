import { createHash, randomUUID } from "node:crypto";
import {
  restore,
  restoreElements,
  restoreLibraryItems,
} from "../excalidraw/native/excalidrawNodeApi.bundle.js";
import type { SceneEnvelope, SceneMetadata } from "../types/contracts.js";
import { applyDiagramQuality } from "./diagramQuality.js";

function ensureObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function ensureArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBinaryFiles(filesInput: unknown): Record<string, any> {
  const files = ensureObject(filesInput);
  const normalized: Record<string, any> = {};

  for (const [fileId, rawValue] of Object.entries(files)) {
    const value = ensureObject(rawValue);
    const id =
      typeof value.id === "string" && value.id.length > 0 ? value.id : fileId;
    const dataURL =
      typeof value.dataURL === "string" ? value.dataURL.trim() : "";
    const mimeType =
      typeof value.mimeType === "string" && value.mimeType.length > 0
        ? value.mimeType
        : "application/octet-stream";

    normalized[fileId] = {
      ...value,
      id,
      dataURL,
      mimeType,
      created: finiteNumber(value.created, Date.now()),
      lastRetrieved: finiteNumber(value.lastRetrieved, Date.now()),
      version: Math.max(1, finiteNumber(value.version, 1)),
    };
  }

  return normalized;
}

function detectEngineHints(elements: any[]): SceneMetadata["engineHints"] {
  return {
    hasFrames: elements.some(
      (element) =>
        element?.type === "frame" || element?.type === "magicframe",
    ),
    hasEmbeddables: elements.some((element) => element?.type === "embeddable"),
    hasImages: elements.some((element) => element?.type === "image"),
  };
}

function normalizeMetadata(
  metadataInput: unknown,
  elements: any[],
  appState: Record<string, unknown>,
  files: Record<string, any>,
  libraryItems: any[],
): SceneMetadata {
  const metadata = ensureObject(metadataInput);
  const now = new Date().toISOString();
  const sceneId =
    typeof metadata.sceneId === "string" && metadata.sceneId.length > 0
      ? metadata.sceneId
      : randomUUID();

  return {
    sceneId,
    name:
      typeof metadata.name === "string" && metadata.name.length > 0
        ? metadata.name
        : `Scene ${sceneId.slice(0, 8)}`,
    createdAt:
      typeof metadata.createdAt === "string" && metadata.createdAt.length > 0
        ? metadata.createdAt
        : now,
    updatedAt: now,
    elementCount: elements.length,
    fileCount: Object.keys(files).length,
    engineHints: detectEngineHints(elements),
    revisionHash: computeRevisionHash(elements, appState, files, libraryItems),
  };
}

export function normalizeElements(elements: any[]): any[] {
  return restoreElements(ensureArray(elements) as any, undefined, {
    refreshDimensions: true,
    repairBindings: true,
  }) as any[];
}

export function normalizeScene(scene: SceneEnvelope): SceneEnvelope {
  const files = normalizeBinaryFiles(scene.files);
  const restored = restore(
    {
      elements: ensureArray(scene.elements) as any,
      appState: ensureObject(scene.appState) as any,
      files: files as any,
    },
    ensureObject(scene.appState) as any,
    undefined,
    {
      refreshDimensions: true,
      repairBindings: true,
    },
  );

  const libraryItems = restoreLibraryItems(
    ensureArray(scene.libraryItems) as any,
    "unpublished",
  ) as any[];

  const quality = applyDiagramQuality(
    {
      ...scene,
      elements: restored.elements as any[],
      appState: restored.appState as Record<string, unknown>,
      files: restored.files as Record<string, any>,
      libraryItems,
    },
    true,
  );

  const metadata = normalizeMetadata(
    scene.metadata,
    quality.scene.elements,
    quality.scene.appState,
    quality.scene.files,
    quality.scene.libraryItems,
  );

  return {
    metadata,
    elements: quality.scene.elements,
    appState: quality.scene.appState,
    files: quality.scene.files,
    libraryItems: quality.scene.libraryItems,
  };
}

export function computeRevisionHash(
  elements: any[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
  libraryItems: any[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ elements, appState, files, libraryItems }))
    .digest("hex");
}
