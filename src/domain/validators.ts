import { createHash, randomUUID } from "node:crypto";
import type { SceneEnvelope, SceneMetadata } from "../types/contracts.js";

function ensureObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function ensureArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizeElement(element: any): any {
  const next = ensureObject(element);

  return {
    id: typeof next.id === "string" && next.id.length > 0 ? next.id : randomUUID(),
    type: typeof next.type === "string" ? next.type : "rectangle",
    x: Number(next.x ?? 0),
    y: Number(next.y ?? 0),
    width: Number(next.width ?? 100),
    height: Number(next.height ?? 100),
    angle: Number(next.angle ?? 0),
    isDeleted: Boolean(next.isDeleted),
    version: Number(next.version ?? 1),
    versionNonce: Number(next.versionNonce ?? Math.floor(Math.random() * 1_000_000_000)),
    ...next
  };
}

function detectEngineHints(elements: any[]): SceneMetadata["engineHints"] {
  return {
    hasFrames: elements.some((element) => element?.type === "frame" || element?.type === "magicframe"),
    hasEmbeddables: elements.some((element) => element?.type === "embeddable"),
    hasImages: elements.some((element) => element?.type === "image")
  };
}

export function normalizeScene(scene: SceneEnvelope): SceneEnvelope {
  const elements = ensureArray(scene.elements).map(normalizeElement);
  const appState = ensureObject(scene.appState);
  const files = ensureObject(scene.files) as Record<string, any>;
  const libraryItems = ensureArray(scene.libraryItems).map((item) => ensureObject(item));

  const metadata: SceneMetadata = {
    ...scene.metadata,
    updatedAt: new Date().toISOString(),
    elementCount: elements.length,
    fileCount: Object.keys(files).length,
    engineHints: detectEngineHints(elements),
    revisionHash: computeRevisionHash(elements, appState, files, libraryItems)
  };

  return {
    metadata,
    elements,
    appState,
    files,
    libraryItems
  };
}

export function normalizeElements(elements: any[]): any[] {
  return ensureArray(elements).map(normalizeElement);
}

export function computeRevisionHash(
  elements: any[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
  libraryItems: any[]
): string {
  return createHash("sha256")
    .update(JSON.stringify({ elements, appState, files, libraryItems }))
    .digest("hex");
}
