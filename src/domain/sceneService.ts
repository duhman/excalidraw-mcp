import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type { BrowserEngine } from "../engines/browserEngine.js";
import { JsonEngine } from "../engines/jsonEngine.js";
import type { SceneStore } from "./sceneStore.js";
import type {
  ExportOptions,
  SceneEnvelope,
  SceneMetadata,
  ScenePatchOperation,
} from "../types/contracts.js";
import { AppError } from "../utils/errors.js";
import {
  analyzeDiagram,
  type DiagramAnalysisResult,
} from "./diagramQuality.js";
import {
  FRAME_PADDING,
  NODE_PADDING,
  SPACING_SCALE,
  TEXT_SCALE,
  measureWrappedTextBlock,
  stylePatchForPreset,
  type StylePreset,
} from "./stylePresets.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type ArrangeMode = "align" | "distribute" | "stack" | "grid";
type ArrangeAxis = "x" | "y" | "both";
type ArrangeAnchor = "min" | "center" | "max";
type LayerDirection = "forward" | "backward" | "front" | "back";
type FrameKind = "frame" | "magicframe";
type Arrowhead =
  | "arrow"
  | "bar"
  | "dot"
  | "circle"
  | "circle_outline"
  | "triangle"
  | "triangle_outline"
  | "diamond"
  | "diamond_outline"
  | "crowfoot_one"
  | "crowfoot_many"
  | "crowfoot_one_or_many";

let mermaidParserModulePromise:
  | Promise<typeof import("@excalidraw/mermaid-to-excalidraw")>
  | null = null;

async function getMermaidParser() {
  mermaidParserModulePromise ??= import("@excalidraw/mermaid-to-excalidraw");
  return mermaidParserModulePromise;
}

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
      hasImages: false,
    },
    revisionHash: "",
  };
}

function getElementBounds(element: any): {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
} {
  const x = Number(element?.x ?? 0);
  const y = Number(element?.y ?? 0);
  const width = Math.max(0, Number(element?.width ?? 0));
  const height = Math.max(0, Number(element?.height ?? 0));
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

function dataUrlToBuffer(dataURL: string): Buffer | null {
  const normalized = String(dataURL ?? "").trim();
  const commaIndex = normalized.indexOf(",");
  if (commaIndex === -1) {
    return null;
  }

  const payload = normalized.slice(commaIndex + 1);
  try {
    return Buffer.from(payload, "base64");
  } catch {
    return null;
  }
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function seedFromId(id: string): number {
  const hash = createHash("sha256").update(id).digest();
  return hash.readUInt32BE(0) & 0x7fffffff;
}

function computeConnectorLayout(source: any, target: any) {
  const sourceBounds = getElementBounds(source);
  const targetBounds = getElementBounds(target);
  const dx = targetBounds.cx - sourceBounds.cx;
  const dy = targetBounds.cy - sourceBounds.cy;
  const horizontalDominant = Math.abs(dx) >= Math.abs(dy);

  const startX = horizontalDominant
    ? dx >= 0
      ? sourceBounds.x + sourceBounds.width
      : sourceBounds.x
    : sourceBounds.cx;
  const startY = horizontalDominant
    ? sourceBounds.cy
    : dy >= 0
      ? sourceBounds.y + sourceBounds.height
      : sourceBounds.y;
  const endX = horizontalDominant
    ? dx >= 0
      ? targetBounds.x
      : targetBounds.x + targetBounds.width
    : targetBounds.cx;
  const endY = horizontalDominant
    ? targetBounds.cy
    : dy >= 0
      ? targetBounds.y
      : targetBounds.y + targetBounds.height;

  const startBinding = horizontalDominant
    ? { elementId: source.id, fixedPoint: dx >= 0 ? [1, 0.5] : [0, 0.5] }
    : { elementId: source.id, fixedPoint: dy >= 0 ? [0.5, 1] : [0.5, 0] };
  const endBinding = horizontalDominant
    ? { elementId: target.id, fixedPoint: dx >= 0 ? [0, 0.5] : [1, 0.5] }
    : { elementId: target.id, fixedPoint: dy >= 0 ? [0.5, 0] : [0.5, 1] };

  return {
    startX,
    startY,
    endX,
    endY,
    startBinding,
    endBinding,
  };
}

function collectDependencyOrigins(elements: any[], rootIds: Set<string>): Map<string, string> {
  const idToElement = new Map<string, any>(
    elements.map((element) => [String(element.id ?? ""), element]),
  );
  const childrenByContainer = new Map<string, string[]>();
  const elementsByGroup = new Map<string, string[]>();

  for (const element of elements) {
    const containerId =
      typeof element.containerId === "string" ? element.containerId : null;
    if (containerId) {
      const existing = childrenByContainer.get(containerId) ?? [];
      existing.push(element.id);
      childrenByContainer.set(containerId, existing);
    }

    const groupIds = Array.isArray(element.groupIds) ? element.groupIds : [];
    for (const groupId of groupIds) {
      const normalizedGroupId = String(groupId ?? "");
      if (!normalizedGroupId) {
        continue;
      }
      const groupElements = elementsByGroup.get(normalizedGroupId) ?? [];
      groupElements.push(element.id);
      elementsByGroup.set(normalizedGroupId, groupElements);
    }
  }

  const dependencyOrigins = new Map<string, string>();
  const queue = [...rootIds].map((id) => ({ id, rootId: id }));
  const visited = new Set<string>(rootIds);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const currentElement = idToElement.get(current.id);
    if (!currentElement || currentElement.isDeleted) {
      continue;
    }

    const childIds = new Set<string>();
    if (Array.isArray(currentElement.boundElements)) {
      for (const entry of currentElement.boundElements) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const childId = String(entry.id ?? "");
        if (childId) {
          childIds.add(childId);
        }
      }
    }

    for (const childId of childrenByContainer.get(current.id) ?? []) {
      childIds.add(childId);
    }

    for (const groupId of Array.isArray(currentElement.groupIds)
      ? currentElement.groupIds
      : []) {
      const groupMemberIds = elementsByGroup.get(String(groupId ?? "")) ?? [];
      for (const memberId of groupMemberIds) {
        childIds.add(memberId);
      }
    }

    for (const childId of childIds) {
      if (rootIds.has(childId) || visited.has(childId)) {
        continue;
      }

      const child = idToElement.get(childId);
      if (!child || child.isDeleted) {
        continue;
      }

      visited.add(childId);
      dependencyOrigins.set(childId, current.rootId);
      queue.push({ id: childId, rootId: current.rootId });
    }
  }

  return dependencyOrigins;
}

function getConnectorLabelIds(connector: any, elements: any[]): string[] {
  const labelIds = new Set<string>();

  if (Array.isArray(connector.boundElements)) {
    for (const entry of connector.boundElements) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      if (String(entry.type ?? "") === "text") {
        const id = String(entry.id ?? "");
        if (id) {
          labelIds.add(id);
        }
      }
    }
  }

  for (const element of elements) {
    if (element.type === "text" && element.containerId === connector.id) {
      labelIds.add(element.id);
    }
  }

  return [...labelIds];
}

function connectorLength(connector: any): number {
  const points = Array.isArray(connector?.points) ? connector.points : [];
  if (points.length < 2) {
    return Math.hypot(Number(connector?.width ?? 0), Number(connector?.height ?? 0));
  }

  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1] ?? [0, 0];
    const current = points[index] ?? [0, 0];
    length += Math.hypot(
      Number(current[0] ?? 0) - Number(previous[0] ?? 0),
      Number(current[1] ?? 0) - Number(previous[1] ?? 0),
    );
  }
  return length;
}

function connectorLabelMaxWidth(connector: any): number {
  return Math.max(120, Math.min(220, Math.max(120, connectorLength(connector) * 0.55)));
}

function fitConnectorLabel(label: any, connector: any): void {
  const fontSize = Math.max(8, Number(label.fontSize ?? TEXT_SCALE.body));
  const lineHeight = Math.max(1, Number(label.lineHeight ?? 1.25));
  const measured = measureWrappedTextBlock(
    String(label.text ?? label.originalText ?? ""),
    fontSize,
    connectorLabelMaxWidth(connector),
    lineHeight,
  );

  label.text = measured.text;
  label.originalText = measured.text;
  label.width = measured.width;
  label.height = measured.height;
  label.lineHeight = measured.lineHeight;
  label.autoResize = false;
}

function syncConnectorGeometry(
  connector: any,
  idToElement: Map<string, any>,
  elements: any[],
): string[] {
  const startId = connector?.startBinding?.elementId;
  const endId = connector?.endBinding?.elementId;
  if (typeof startId !== "string" || typeof endId !== "string") {
    return [];
  }

  const source = idToElement.get(startId);
  const target = idToElement.get(endId);
  if (!source || !target || source.isDeleted || target.isDeleted) {
    return [];
  }

  const layout = computeConnectorLayout(source, target);
  connector.x = layout.startX;
  connector.y = layout.startY;
  connector.width = layout.endX - layout.startX;
  connector.height = layout.endY - layout.startY;
  connector.points = [
    [0, 0],
    [layout.endX - layout.startX, layout.endY - layout.startY],
  ];
  connector.startBinding = layout.startBinding;
  connector.endBinding = layout.endBinding;

  const labelIds = getConnectorLabelIds(connector, elements);
  for (const labelId of labelIds) {
    const label = idToElement.get(labelId);
    if (!label || label.isDeleted) {
      continue;
    }

    fitConnectorLabel(label, connector);
    const labelWidth = Number(label.width ?? 60);
    const labelHeight = Number(label.height ?? 24);
    label.x = layout.startX + (layout.endX - layout.startX) / 2 - labelWidth / 2;
    label.y =
      layout.startY + (layout.endY - layout.startY) / 2 - labelHeight / 2;
  }

  return labelIds;
}

function reorderElements(
  elements: any[],
  selectedIds: Set<string>,
  direction: LayerDirection,
): any[] {
  const result = [...elements];

  if (direction === "front") {
    return [
      ...result.filter((element) => !selectedIds.has(element.id)),
      ...result.filter((element) => selectedIds.has(element.id)),
    ];
  }

  if (direction === "back") {
    return [
      ...result.filter((element) => selectedIds.has(element.id)),
      ...result.filter((element) => !selectedIds.has(element.id)),
    ];
  }

  const blocks: Array<{ start: number; end: number }> = [];
  let blockStart = -1;
  for (let index = 0; index < result.length; index += 1) {
    const selected = selectedIds.has(result[index].id);
    if (selected && blockStart === -1) {
      blockStart = index;
    }
    if (!selected && blockStart !== -1) {
      blocks.push({ start: blockStart, end: index - 1 });
      blockStart = -1;
    }
  }
  if (blockStart !== -1) {
    blocks.push({ start: blockStart, end: result.length - 1 });
  }

  if (direction === "forward") {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      const nextIndex = block.end + 1;
      if (nextIndex >= result.length || selectedIds.has(result[nextIndex].id)) {
        continue;
      }

      const nextItem = result[nextIndex];
      const blockItems = result.slice(block.start, block.end + 1);
      result.splice(block.start, blockItems.length + 1, nextItem, ...blockItems);
    }
    return result;
  }

  for (const block of blocks) {
    const previousIndex = block.start - 1;
    if (previousIndex < 0 || selectedIds.has(result[previousIndex].id)) {
      continue;
    }

    const previousItem = result[previousIndex];
    const blockItems = result.slice(block.start, block.end + 1);
    result.splice(previousIndex, blockItems.length + 1, ...blockItems, previousItem);
  }

  return result;
}

function buildIdToElement(elements: any[]): Map<string, any> {
  return new Map(
    elements.map((element) => [String(element.id ?? ""), element]),
  );
}

function isConnectorElement(element: any): boolean {
  return element?.type === "arrow" || element?.type === "line";
}

function isFrameElement(element: any): boolean {
  return element?.type === "frame" || element?.type === "magicframe";
}

function getTextContent(element: any): string {
  return String(element?.text ?? element?.originalText ?? "");
}

function getSemanticRole(element: any): string {
  return String(element?.customData?.semanticRole ?? "");
}

function getSemanticRootId(element: any): string | null {
  const rootId = String(element?.customData?.semanticRootId ?? "");
  return rootId || null;
}

function moveRootsWithDependents(
  elements: any[],
  rootIds: Set<string>,
  nextPositionsByRootId: Map<string, { x: number; y: number }>,
): Set<string> {
  const dependencyOrigins = collectDependencyOrigins(elements, rootIds);
  const idToElement = buildIdToElement(elements);
  const movedIds = new Set<string>();

  for (const rootId of rootIds) {
    const root = idToElement.get(rootId);
    const nextPosition = nextPositionsByRootId.get(rootId);
    if (!root || root.isDeleted || !nextPosition) {
      continue;
    }

    const currentX = Number(root.x ?? 0);
    const currentY = Number(root.y ?? 0);
    const dx = nextPosition.x - currentX;
    const dy = nextPosition.y - currentY;

    if (dx === 0 && dy === 0) {
      continue;
    }

    root.x = nextPosition.x;
    root.y = nextPosition.y;
    movedIds.add(rootId);

    for (const [dependentId, originId] of dependencyOrigins.entries()) {
      if (originId !== rootId) {
        continue;
      }

      const dependent = idToElement.get(dependentId);
      if (!dependent || dependent.isDeleted) {
        continue;
      }

      dependent.x = Number(dependent.x ?? 0) + dx;
      dependent.y = Number(dependent.y ?? 0) + dy;
      movedIds.add(dependentId);
    }
  }

  const refreshedConnectorIds = refreshConnectorsForMovedElements(elements, movedIds);
  for (const connectorId of refreshedConnectorIds) {
    movedIds.add(connectorId);
  }

  return movedIds;
}

function refreshConnectorsForMovedElements(
  elements: any[],
  movedIds: Set<string>,
): Set<string> {
  const idToElement = buildIdToElement(elements);
  const changedIds = new Set<string>();

  for (const connector of elements) {
    if (!isConnectorElement(connector) || connector.isDeleted) {
      continue;
    }

    const startId = String(connector?.startBinding?.elementId ?? "");
    const endId = String(connector?.endBinding?.elementId ?? "");
    if (
      !movedIds.has(String(connector.id ?? "")) &&
      !(startId && movedIds.has(startId)) &&
      !(endId && movedIds.has(endId))
    ) {
      continue;
    }

    const labelIds = syncConnectorGeometry(connector, idToElement, elements);
    changedIds.add(String(connector.id ?? ""));
    for (const labelId of labelIds) {
      changedIds.add(labelId);
    }
  }

  return changedIds;
}

function sortElementIdsByAxis(elements: any[], ids: string[], axis: "x" | "y"): string[] {
  return [...ids].sort((leftId, rightId) => {
    const left = elements.find((element) => element.id === leftId);
    const right = elements.find((element) => element.id === rightId);
    if (!left || !right) {
      return 0;
    }

    const leftBounds = getElementBounds(left);
    const rightBounds = getElementBounds(right);
    return axis === "x"
      ? leftBounds.x - rightBounds.x
      : leftBounds.y - rightBounds.y;
  });
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

  async createScene(input: {
    sceneId?: string;
    name?: string;
    elements?: any[];
    appState?: Record<string, unknown>;
  }): Promise<SceneEnvelope> {
    const sceneId = input.sceneId ?? uuidv4();

    if (await this.store.exists(sceneId)) {
      throw new AppError("CONFLICT", `Scene already exists: ${sceneId}`, 409, {
        sceneId,
      });
    }

    const scene: SceneEnvelope = this.jsonEngine.normalize({
      metadata: createSceneMetadata(
        sceneId,
        input.name ?? `Scene ${sceneId.slice(0, 8)}`,
      ),
      elements: input.elements ?? [],
      appState: input.appState ?? {},
      files: {},
      libraryItems: [],
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

  async closeScene(
    sceneId: string,
    sessionId: string,
  ): Promise<{ closed: boolean }> {
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

  async patchScene(
    sceneId: string,
    operations: ScenePatchOperation[],
  ): Promise<{ scene: SceneEnvelope; changedElementIds: string[] }> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const patched = this.jsonEngine.applyPatch(scene, operations);
      await this.store.save(patched.scene);
      return patched;
    });
  }

  async createElementsFromSkeletons(
    sceneId: string,
    skeletons: any[],
  ): Promise<{ scene: SceneEnvelope; changedElementIds: string[] }> {
    const scene = await this.store.load(sceneId);
    const missingFileIds = skeletons
      .filter((skeleton) => skeleton?.type === "image" && skeleton.fileId)
      .map((skeleton) => String(skeleton.fileId))
      .filter((fileId) => !scene.files[fileId]);

    if (missingFileIds.length > 0) {
      throw new AppError("BAD_REQUEST", "Image skeleton references missing files", 400, {
        sceneId,
        fileIds: missingFileIds,
      });
    }

    return this.patchScene(sceneId, [
      {
        op: "addElements",
        elements: skeletons,
      },
    ] as any);
  }

  async analyzeScene(sceneId: string): Promise<DiagramAnalysisResult> {
    const scene = await this.store.load(sceneId);
    return analyzeDiagram(scene);
  }

  async validateScene(sceneId: string): Promise<{
    valid: boolean;
    issues: string[];
    qualityIssues: DiagramAnalysisResult["issues"];
    qualityScore: number;
    summary: DiagramAnalysisResult["summary"];
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

    for (const [fileId, file] of Object.entries(scene.files)) {
      if (!file?.dataURL || !String(file.dataURL).startsWith("data:")) {
        issues.push(`Invalid file data URL: ${fileId}`);
      }
    }

    const analysis = analyzeDiagram(scene);

    return {
      valid:
        issues.length === 0 &&
        analysis.issues.every((issue) => issue.severity !== "error"),
      issues,
      qualityIssues: analysis.issues,
      qualityScore: analysis.score,
      summary: analysis.summary,
      revisionHash: scene.metadata.revisionHash,
    };
  }

  async qualityGate(
    sceneId: string,
    input: {
      minScore?: number;
      requireTitle?: boolean;
      requireLegend?: boolean;
      failOnIssueCodes?: string[];
    } = {},
  ): Promise<{
    passed: boolean;
    failures: Array<{
      code: string;
      message: string;
      severity?: string;
      elementId?: string;
      details?: Record<string, unknown>;
    }>;
    analysis: DiagramAnalysisResult;
    validation: Awaited<ReturnType<SceneService["validateScene"]>>;
    thresholds: {
      minScore: number;
      requireTitle: boolean;
      requireLegend: boolean;
      failOnIssueCodes: string[];
    };
  }> {
    const scene = await this.store.load(sceneId);
    const analysis = analyzeDiagram(scene);
    const validation = await this.validateScene(sceneId);
    const minScore = input.minScore ?? 90;
    const visibleCount = analysis.summary.visibleElementCount;
    const requireTitle = input.requireTitle ?? visibleCount > 0;
    const hasMultipleBackgrounds =
      new Set(
        scene.elements
          .filter((element) => !element.isDeleted)
          .map((element) => String(element.backgroundColor ?? ""))
          .filter((color) => color && color !== "transparent"),
      ).size > 2;
    const requireLegend =
      input.requireLegend ??
      (analysis.summary.graph.connectorCount >= 2 || hasMultipleBackgrounds);
    const failOnIssueCodes = [
      "ELEMENT_OVERLAP",
      "CONNECTOR_CROSSING",
      "TEXT_OVERFLOW",
      ...(input.failOnIssueCodes ?? []),
    ];
    const failCodeSet = new Set(failOnIssueCodes);
    const failures: Array<{
      code: string;
      message: string;
      severity?: string;
      elementId?: string;
      details?: Record<string, unknown>;
    }> = [];

    if (analysis.score < minScore) {
      failures.push({
        code: "QUALITY_SCORE_BELOW_TARGET",
        message: `Scene score ${analysis.score} is below required ${minScore}`,
        details: { score: analysis.score, minScore },
      });
    }

    for (const issue of analysis.issues) {
      if (
        issue.severity === "error" ||
        failCodeSet.has(issue.code) ||
        (requireTitle && issue.code === "MISSING_TITLE") ||
        (requireLegend && issue.code === "MISSING_LEGEND")
      ) {
        failures.push(issue);
      }
    }

    for (const issue of validation.issues) {
      failures.push({
        code: "VALIDATION_ERROR",
        message: issue,
        severity: "error",
      });
    }

    return {
      passed: failures.length === 0,
      failures,
      analysis,
      validation,
      thresholds: {
        minScore,
        requireTitle,
        requireLegend,
        failOnIssueCodes,
      },
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

  async listElements(
    sceneId: string,
    options: { includeDeleted?: boolean; type?: string; limit?: number },
  ): Promise<any[]> {
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

  async patchAppState(
    sceneId: string,
    appState: Record<string, unknown>,
    merge = true,
  ): Promise<Record<string, unknown>> {
    const result = await this.patchScene(sceneId, [
      {
        op: "setAppState",
        appState,
        merge,
      },
    ]);

    return result.scene.appState;
  }

  async attachFile(
    sceneId: string,
    input: {
      fileId?: string;
      mimeType: string;
      base64: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ fileId: string; deduplicated: boolean; sizeBytes: number }> {
    const buffer = Buffer.from(input.base64, "base64");
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new AppError("BAD_REQUEST", "File exceeds max size", 400, {
        maxBytes: MAX_FILE_BYTES,
        actualBytes: buffer.byteLength,
      });
    }

    const hash = hashBuffer(buffer);

    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);

      for (const [existingId, existing] of Object.entries(scene.files)) {
        const existingBuffer = dataUrlToBuffer(String((existing as any).dataURL ?? ""));
        if (!existingBuffer) {
          continue;
        }

        if (hashBuffer(existingBuffer) === hash) {
          return {
            fileId: existingId,
            deduplicated: true,
            sizeBytes: buffer.byteLength,
          };
        }
      }

      const fileId = input.fileId ?? uuidv4();
      const dataURL = `data:${input.mimeType};base64,${input.base64}`;
      const nextFile = {
        ...(input.metadata ?? {}),
        id: fileId,
        mimeType: input.mimeType,
        dataURL,
        created: Date.now(),
        lastRetrieved: Date.now(),
        version: 1,
      };

      const nextScene = this.jsonEngine.normalize({
        ...scene,
        files: {
          ...scene.files,
          [fileId]: nextFile,
        },
      });

      await this.store.save(nextScene);
      return {
        fileId,
        deduplicated: false,
        sizeBytes: buffer.byteLength,
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
        files: nextFiles,
      });

      await this.store.save(nextScene);
      return { removed: true };
    });
  }

  async getLibrary(sceneId: string): Promise<any[]> {
    const scene = await this.store.load(sceneId);
    return scene.libraryItems;
  }

  async updateLibrary(
    sceneId: string,
    libraryItems: any[],
    merge: boolean,
  ): Promise<any[]> {
    const result = await this.patchScene(sceneId, [
      {
        op: "setLibrary",
        libraryItems,
        merge,
      },
    ]);

    return result.scene.libraryItems;
  }

  async importSceneFromJson(input: {
    sceneId?: string;
    payload: any;
    merge?: boolean;
    name?: string;
    openInSessionId?: string;
  }): Promise<{ scene: SceneEnvelope; createdScene: boolean }> {
    const payload = input.payload ?? {};
    const elements = Array.isArray(payload.elements) ? payload.elements : [];
    const appState =
      typeof payload.appState === "object" && payload.appState
        ? payload.appState
        : {};
    const files =
      typeof payload.files === "object" && payload.files ? payload.files : {};
    const libraryItems = Array.isArray(payload?.libraryItems)
      ? payload.libraryItems
      : Array.isArray(payload)
        ? payload
        : [];

    if (!input.sceneId) {
      const scene = this.jsonEngine.normalize({
        metadata: createSceneMetadata(
          uuidv4(),
          input.name ?? payload.name ?? "Imported Scene",
        ),
        elements,
        appState,
        files,
        libraryItems,
      });
      await this.store.save(scene);
      if (input.openInSessionId) {
        this.sessionActiveScene.set(input.openInSessionId, scene.metadata.sceneId);
      }
      return { scene, createdScene: true };
    }

    if (!(await this.store.exists(input.sceneId))) {
      const scene = this.jsonEngine.normalize({
        metadata: createSceneMetadata(
          input.sceneId,
          input.name ?? payload.name ?? `Scene ${input.sceneId.slice(0, 8)}`,
        ),
        elements,
        appState,
        files,
        libraryItems,
      });
      await this.store.save(scene);
      if (input.openInSessionId) {
        this.sessionActiveScene.set(input.openInSessionId, input.sceneId);
      }
      return { scene, createdScene: true };
    }

    return this.withSceneLock(input.sceneId, async () => {
      const existing = await this.store.load(input.sceneId!);
      const scene = this.jsonEngine.normalize({
        ...existing,
        metadata: {
          ...existing.metadata,
          name: input.name ?? existing.metadata.name,
        },
        elements:
          input.merge === false ? elements : [...existing.elements, ...elements],
        appState:
          input.merge === false
            ? appState
            : { ...existing.appState, ...appState },
        files:
          input.merge === false ? files : { ...existing.files, ...files },
        libraryItems:
          input.merge === false
            ? libraryItems
            : [...existing.libraryItems, ...libraryItems],
      });
      await this.store.save(scene);
      if (input.openInSessionId) {
        this.sessionActiveScene.set(input.openInSessionId, input.sceneId!);
      }
      return { scene, createdScene: false };
    });
  }

  async importLibraryFromJson(input: {
    sceneId: string;
    payload: any;
    merge?: boolean;
  }): Promise<any[]> {
    const libraryItems = Array.isArray(input.payload?.libraryItems)
      ? input.payload.libraryItems
      : Array.isArray(input.payload)
        ? input.payload
        : [];
    return this.updateLibrary(input.sceneId, libraryItems, input.merge ?? true);
  }

  async arrangeElements(
    sceneId: string,
    input: {
      elementIds: string[];
      mode: ArrangeMode;
      axis?: ArrangeAxis;
      gap?: number;
      anchor?: ArrangeAnchor;
      columns?: number;
      includeDependents?: boolean;
    },
  ): Promise<{ scene: SceneEnvelope; changedElementIds: string[] }> {
    const axis = input.axis ?? "x";
    const gap = Number(input.gap ?? 24);
    const anchor = input.anchor ?? "min";
    const includeDependents = input.includeDependents ?? true;

    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const rootIds = new Set(input.elementIds);
      const elements = scene.elements.map((element) => ({ ...element }));
      const rootElements = elements.filter(
        (element) => rootIds.has(element.id) && !element.isDeleted,
      );

      if (rootElements.length === 0) {
        throw new AppError("BAD_REQUEST", "No matching elements to arrange", 400, {
          elementIds: input.elementIds,
        });
      }

      const dependencyOrigins = includeDependents
        ? collectDependencyOrigins(elements, rootIds)
        : new Map<string, string>();
      const selectedIds = new Set([
        ...rootIds,
        ...dependencyOrigins.keys(),
      ]);
      const idToElement = new Map(elements.map((element) => [element.id, element]));

      const bounds = rootElements.map((element) => ({
        element,
        ...getElementBounds(element),
      }));
      const minX = Math.min(...bounds.map((item) => item.x));
      const minY = Math.min(...bounds.map((item) => item.y));
      const maxX = Math.max(...bounds.map((item) => item.x + item.width));
      const maxY = Math.max(...bounds.map((item) => item.y + item.height));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const deltaByRootId = new Map<string, { dx: number; dy: number }>();

      const setAlignedCrossAxis = (
        element: any,
        itemBounds: ReturnType<typeof getElementBounds>,
      ) => {
        if (axis === "y") {
          if (anchor === "center") {
            element.x = centerX - itemBounds.width / 2;
          } else if (anchor === "max") {
            element.x = maxX - itemBounds.width;
          } else {
            element.x = minX;
          }
        } else {
          if (anchor === "center") {
            element.y = centerY - itemBounds.height / 2;
          } else if (anchor === "max") {
            element.y = maxY - itemBounds.height;
          } else {
            element.y = minY;
          }
        }
      };

      if (input.mode === "stack") {
        const ordered = [...bounds].sort((left, right) =>
          axis === "y" ? left.y - right.y : left.x - right.x,
        );
        let cursor = axis === "y" ? minY : minX;
        for (const item of ordered) {
          const previous = { x: item.element.x, y: item.element.y };
          if (axis === "y") {
            item.element.y = cursor;
          } else {
            item.element.x = cursor;
          }
          setAlignedCrossAxis(item.element, item);
          deltaByRootId.set(item.element.id, {
            dx: Number(item.element.x) - previous.x,
            dy: Number(item.element.y) - previous.y,
          });
          cursor += (axis === "y" ? item.height : item.width) + gap;
        }
      } else if (input.mode === "align") {
        for (const item of bounds) {
          const previous = { x: item.element.x, y: item.element.y };
          if (axis === "x" || axis === "both") {
            if (anchor === "center") {
              item.element.x = centerX - item.width / 2;
            } else if (anchor === "max") {
              item.element.x = maxX - item.width;
            } else {
              item.element.x = minX;
            }
          }
          if (axis === "y" || axis === "both") {
            if (anchor === "center") {
              item.element.y = centerY - item.height / 2;
            } else if (anchor === "max") {
              item.element.y = maxY - item.height;
            } else {
              item.element.y = minY;
            }
          }
          deltaByRootId.set(item.element.id, {
            dx: Number(item.element.x) - previous.x,
            dy: Number(item.element.y) - previous.y,
          });
        }
      } else if (input.mode === "distribute") {
        const ordered = [...bounds].sort((left, right) =>
          axis === "y" ? left.y - right.y : left.x - right.x,
        );
        const start = axis === "y" ? minY : minX;
        const end = axis === "y" ? maxY : maxX;
        const totalSize = ordered.reduce(
          (sum, item) => sum + (axis === "y" ? item.height : item.width),
          0,
        );
        const free = Math.max(0, end - start - totalSize);
        const stepGap = ordered.length > 1 ? free / (ordered.length - 1) : 0;
        let cursor = start;
        for (const item of ordered) {
          const previous = { x: item.element.x, y: item.element.y };
          if (axis === "y") {
            item.element.y = cursor;
          } else {
            item.element.x = cursor;
          }
          setAlignedCrossAxis(item.element, item);
          deltaByRootId.set(item.element.id, {
            dx: Number(item.element.x) - previous.x,
            dy: Number(item.element.y) - previous.y,
          });
          cursor += (axis === "y" ? item.height : item.width) + stepGap;
        }
      } else if (input.mode === "grid") {
        const columns = Math.max(
          1,
          Number(input.columns ?? Math.ceil(Math.sqrt(rootElements.length))),
        );
        const maxWidth = Math.max(...bounds.map((item) => item.width));
        const maxHeight = Math.max(...bounds.map((item) => item.height));
        const ordered = [...bounds].sort((left, right) => left.y - right.y || left.x - right.x);
        ordered.forEach((item, index) => {
          const previous = { x: item.element.x, y: item.element.y };
          const col = index % columns;
          const row = Math.floor(index / columns);
          item.element.x = minX + col * (maxWidth + gap);
          item.element.y = minY + row * (maxHeight + gap);
          deltaByRootId.set(item.element.id, {
            dx: Number(item.element.x) - previous.x,
            dy: Number(item.element.y) - previous.y,
          });
        });
      }

      for (const [dependentId, rootId] of dependencyOrigins.entries()) {
        const dependent = idToElement.get(dependentId);
        const delta = deltaByRootId.get(rootId);
        if (!dependent || !delta) {
          continue;
        }

        dependent.x = Number(dependent.x ?? 0) + delta.dx;
        dependent.y = Number(dependent.y ?? 0) + delta.dy;
      }

      const connectorsToRefresh = new Set<string>();
      for (const rootId of rootIds) {
        const root = idToElement.get(rootId);
        if (!root || !Array.isArray(root.boundElements)) {
          continue;
        }

        for (const entry of root.boundElements) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          if (String(entry.type ?? "") === "arrow" || String(entry.type ?? "") === "line") {
            connectorsToRefresh.add(String(entry.id ?? ""));
          }
        }
      }

      for (const dependentId of dependencyOrigins.keys()) {
        const dependent = idToElement.get(dependentId);
        if (
          dependent &&
          (dependent.type === "arrow" || dependent.type === "line")
        ) {
          connectorsToRefresh.add(dependent.id);
        }
      }

      for (const connectorId of connectorsToRefresh) {
        const connector = idToElement.get(connectorId);
        if (!connector || connector.isDeleted) {
          continue;
        }
        const labelIds = syncConnectorGeometry(connector, idToElement, elements);
        for (const labelId of labelIds) {
          selectedIds.add(labelId);
        }
        selectedIds.add(connectorId);
      }

      const nextScene = this.jsonEngine.normalize({ ...scene, elements });
      await this.store.save(nextScene);
      return {
        scene: nextScene,
        changedElementIds: [...selectedIds].sort(),
      };
    });
  }

  async createConnector(
    sceneId: string,
    input: {
      sourceElementId: string;
      targetElementId: string;
      label?: string;
      connectorType?: "arrow" | "line";
      startArrowhead?: Arrowhead | null;
      endArrowhead?: Arrowhead | null;
      points?: Array<[number, number]>;
      strokeStyle?: "solid" | "dashed" | "dotted";
      strokeColor?: string;
    },
  ): Promise<{ scene: SceneEnvelope; connectorId: string; labelId?: string }> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const source = scene.elements.find(
        (element) =>
          element.id === input.sourceElementId && !element.isDeleted,
      );
      const target = scene.elements.find(
        (element) =>
          element.id === input.targetElementId && !element.isDeleted,
      );
      if (!source || !target) {
        throw new AppError(
          "NOT_FOUND",
          "Source or target element not found",
          404,
          input,
        );
      }

      const layout = computeConnectorLayout(source, target);
      const connectorId = uuidv4();
      const labelId = input.label ? uuidv4() : undefined;
      const connector: any = {
        id: connectorId,
        type: input.connectorType ?? "arrow",
        x: layout.startX,
        y: layout.startY,
        width: layout.endX - layout.startX,
        height: layout.endY - layout.startY,
        points: input.points ?? [
          [0, 0],
          [layout.endX - layout.startX, layout.endY - layout.startY],
        ],
        startBinding: layout.startBinding,
        endBinding: layout.endBinding,
        startArrowhead:
          input.connectorType === "line" ? null : input.startArrowhead ?? null,
        endArrowhead:
          input.connectorType === "line" ? null : input.endArrowhead ?? "arrow",
        strokeStyle: input.strokeStyle ?? "solid",
        strokeColor: input.strokeColor ?? "#1e1e1e",
        seed: seedFromId(connectorId),
      };
      if (labelId) {
        connector.boundElements = [{ id: labelId, type: "text" }];
      }

      const additions = [connector];
      if (labelId) {
        const labelMetrics = measureWrappedTextBlock(
          input.label ?? "",
          TEXT_SCALE.body,
          connectorLabelMaxWidth(connector),
        );
        additions.push({
          id: labelId,
          type: "text",
          x: layout.startX + (layout.endX - layout.startX) / 2 - labelMetrics.width / 2,
          y: layout.startY + (layout.endY - layout.startY) / 2 - labelMetrics.height / 2,
          width: labelMetrics.width,
          height: labelMetrics.height,
          text: labelMetrics.text,
          originalText: labelMetrics.text,
          containerId: connectorId,
          fontSize: 16,
          fontFamily: 1,
          lineHeight: labelMetrics.lineHeight,
          textAlign: "center",
          verticalAlign: "middle",
          autoResize: false,
          strokeColor: "#1e1e1e",
          seed: seedFromId(labelId),
        });
      }

      const result = this.jsonEngine.applyPatch(scene, [
        { op: "addElements", elements: additions },
      ]);
      await this.store.save(result.scene);
      return { scene: result.scene, connectorId, labelId };
    });
  }

  async createFrame(
    sceneId: string,
    input: {
      frameId?: string;
      kind?: FrameKind;
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      children?: string[];
      elementIds?: string[];
    },
  ): Promise<{ scene: SceneEnvelope; frameId: string; changedElementIds: string[] }> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const frameId = input.frameId ?? uuidv4();
      const kind = input.kind ?? "frame";
      const frame = {
        id: frameId,
        type: kind,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        name: input.name ?? "Frame",
        seed: seedFromId(frameId),
      };

      const elementIds = new Set([...(input.children ?? []), ...(input.elementIds ?? [])]);
      const elements = [...scene.elements.map((element) => ({ ...element })), frame];
      for (const element of elements) {
        if (elementIds.has(element.id)) {
          element.frameId = frame.id;
        }
      }

      const nextScene = this.jsonEngine.normalize({ ...scene, elements });
      await this.store.save(nextScene);
      return {
        scene: nextScene,
        frameId: frame.id,
        changedElementIds: [frame.id, ...elementIds].sort(),
      };
    });
  }

  async assignElementsToFrame(
    sceneId: string,
    input: { frameId: string; elementIds: string[] },
  ): Promise<{ scene: SceneEnvelope; changedElementIds: string[] }> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const frame = scene.elements.find(
        (element) =>
          element.id === input.frameId &&
          !element.isDeleted &&
          (element.type === "frame" || element.type === "magicframe"),
      );

      if (!frame) {
        throw new AppError("NOT_FOUND", "Frame not found", 404, {
          frameId: input.frameId,
        });
      }

      const selectedIds = new Set(input.elementIds);
      const elements = scene.elements.map((element) => {
        if (!selectedIds.has(element.id)) {
          return { ...element };
        }

        return {
          ...element,
          frameId: input.frameId,
        };
      });

      const nextScene = this.jsonEngine.normalize({ ...scene, elements });
      await this.store.save(nextScene);
      return {
        scene: nextScene,
        changedElementIds: [input.frameId, ...selectedIds].sort(),
      };
    });
  }

  async applyStylePreset(
    sceneId: string,
    input: {
      elementIds: string[];
      preset: StylePreset;
      includeDependents?: boolean;
    },
  ): Promise<{ scene: SceneEnvelope; changedElementIds: string[] }> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const rootIds = new Set(input.elementIds);
      const dependencyOrigins =
        input.includeDependents === false
          ? new Map<string, string>()
          : collectDependencyOrigins(scene.elements, rootIds);
      const selectedIds = new Set([...rootIds, ...dependencyOrigins.keys()]);

      const elements = scene.elements.map((element) => {
        if (!selectedIds.has(element.id) || element.isDeleted) {
          return { ...element };
        }

        return {
          ...element,
          ...stylePatchForPreset(element, input.preset),
        };
      });

      const nextScene = this.jsonEngine.normalize({ ...scene, elements });
      await this.store.save(nextScene);
      return {
        scene: nextScene,
        changedElementIds: [...selectedIds].sort(),
      };
    });
  }

  async reorderLayers(
    sceneId: string,
    input: {
      elementIds: string[];
      direction: LayerDirection;
      includeDependents?: boolean;
    },
  ): Promise<{ scene: SceneEnvelope; changedElementIds: string[] }> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const rootIds = new Set(input.elementIds);
      const dependencyOrigins =
        input.includeDependents === false
          ? new Map<string, string>()
          : collectDependencyOrigins(scene.elements, rootIds);
      const selectedIds = new Set([...rootIds, ...dependencyOrigins.keys()]);

      const reordered = reorderElements(
        scene.elements.map((element) => ({ ...element })),
        selectedIds,
        input.direction,
      );
      const nextScene = this.jsonEngine.normalize({ ...scene, elements: reordered });
      await this.store.save(nextScene);
      return {
        scene: nextScene,
        changedElementIds: [...selectedIds].sort(),
      };
    });
  }

  async createNodes(
    sceneId: string,
    input: {
      nodes: Array<{
        id?: string;
        label: string;
        body?: string;
        shape?: "rectangle" | "ellipse" | "diamond";
        x: number;
        y: number;
        width?: number;
        height?: number;
      }>;
      preset?: StylePreset;
    },
  ): Promise<{ scene: SceneEnvelope; changedElementIds: string[] }> {
    const result = await this.composeNodes(sceneId, {
      preset: input.preset ?? "process",
      nodes: input.nodes.map((node) => ({
        nodeId: node.id,
        x: node.x,
        y: node.y,
        width: node.width,
        minHeight: node.height,
        title: node.label,
        body: node.body,
        shape: node.shape,
      })),
    });

    return {
      scene: result.scene,
      changedElementIds: result.changedElementIds,
    };
  }

  async composeNodes(
    sceneId: string,
    input: {
      preset: StylePreset;
      nodes: Array<{
        nodeId?: string;
        x: number;
        y: number;
        width?: number;
        minHeight?: number;
        title: string;
        body?: string;
        iconText?: string;
        imageFileId?: string;
        frameId?: string;
        shape?: "rectangle" | "ellipse" | "diamond";
      }>;
    },
  ): Promise<{
    scene: SceneEnvelope;
    nodes: Array<{
      nodeId: string;
      containerId: string;
      titleTextId: string;
      bodyTextId?: string;
      iconElementId?: string;
      imageElementId?: string;
    }>;
    changedElementIds: string[];
  }> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const nextElements = scene.elements.map((element) => ({ ...element }));
      const changedElementIds = new Set<string>();
      const composedNodes: Array<{
        nodeId: string;
        containerId: string;
        titleTextId: string;
        bodyTextId?: string;
        iconElementId?: string;
        imageElementId?: string;
      }> = [];

      for (const node of input.nodes) {
        const containerId = node.nodeId ?? uuidv4();
        const groupId = uuidv4();
        const containerWidth = Math.max(180, Number(node.width ?? 220));
        const minHeight = Math.max(96, Number(node.minHeight ?? 120));
        const contentWidth = Math.max(96, containerWidth - NODE_PADDING * 2);
        const frameId = node.frameId ?? null;
        const nodeElements: any[] = [];

        if (node.imageFileId && !scene.files[node.imageFileId]) {
          throw new AppError("BAD_REQUEST", "Node references a missing image file", 400, {
            sceneId,
            imageFileId: node.imageFileId,
          });
        }

        let cursorY = Number(node.y) + NODE_PADDING;
        let iconElementId: string | undefined;
        let imageElementId: string | undefined;
        let mediaRowHeight = 0;

        if (node.iconText) {
          iconElementId = uuidv4();
          const iconWidth = Math.max(
            40,
            Math.min(
              72,
              Math.ceil(
                measureWrappedTextBlock(node.iconText, TEXT_SCALE.body, 72).width +
                  NODE_PADDING,
              ),
            ),
          );
          const iconElement = {
            id: iconElementId,
            type: "rectangle",
            x: Number(node.x) + NODE_PADDING,
            y: cursorY,
            width: iconWidth,
            height: 32,
            groupIds: [groupId],
            frameId,
            seed: seedFromId(iconElementId),
            customData: {
              semanticRole: "node-icon",
              semanticRootId: containerId,
            },
            ...stylePatchForPreset(
              { type: "rectangle", customData: { semanticRole: "node-icon" } },
              "accent",
            ),
            label: {
              text: node.iconText,
              fontSize: TEXT_SCALE.body,
              fontFamily: 1,
            },
          };
          nodeElements.push(iconElement);
          changedElementIds.add(iconElementId);
          mediaRowHeight = Math.max(mediaRowHeight, Number(iconElement.height ?? 0));
        }

        if (node.imageFileId) {
          imageElementId = uuidv4();
          const imageSize = 48;
          const imageElement = {
            id: imageElementId,
            type: "image",
            x: Number(node.x) + containerWidth - NODE_PADDING - imageSize,
            y: cursorY,
            width: imageSize,
            height: imageSize,
            groupIds: [groupId],
            frameId,
            fileId: node.imageFileId,
            status: "saved",
            scale: [1, 1],
            seed: seedFromId(imageElementId),
            customData: {
              semanticRole: "node-image",
              semanticRootId: containerId,
            },
          };
          nodeElements.push(imageElement);
          changedElementIds.add(imageElementId);
          mediaRowHeight = Math.max(mediaRowHeight, imageSize);
        }

        if (mediaRowHeight > 0) {
          cursorY += mediaRowHeight + SPACING_SCALE.xs;
        }

        const titleMetrics = measureWrappedTextBlock(
          node.title,
          TEXT_SCALE.title,
          contentWidth,
        );
        const titleTextId = uuidv4();
        const titleElement = {
          id: titleTextId,
          type: "text",
          x: Number(node.x) + NODE_PADDING,
          y: cursorY,
          width: titleMetrics.width,
          height: titleMetrics.height,
          text: titleMetrics.text,
          originalText: titleMetrics.text,
          fontSize: TEXT_SCALE.title,
          fontFamily: 1,
          lineHeight: titleMetrics.lineHeight,
          autoResize: false,
          groupIds: [groupId],
          frameId,
          seed: seedFromId(titleTextId),
          customData: {
            semanticRole: "node-title",
            semanticRootId: containerId,
          },
          ...stylePatchForPreset(
            { type: "text", customData: { semanticRole: "node-title" } },
            input.preset,
          ),
        };
        nodeElements.push(titleElement);
        changedElementIds.add(titleTextId);
        cursorY += titleMetrics.height;

        let bodyTextId: string | undefined;
        if (node.body) {
          cursorY += SPACING_SCALE.xxs;
          const bodyMetrics = measureWrappedTextBlock(
            node.body,
            TEXT_SCALE.body,
            contentWidth,
          );
          bodyTextId = uuidv4();
          const bodyElement = {
            id: bodyTextId,
            type: "text",
            x: Number(node.x) + NODE_PADDING,
            y: cursorY,
            width: bodyMetrics.width,
            height: bodyMetrics.height,
            text: bodyMetrics.text,
            originalText: bodyMetrics.text,
            fontSize: TEXT_SCALE.body,
            fontFamily: 1,
            lineHeight: bodyMetrics.lineHeight,
            autoResize: false,
            groupIds: [groupId],
            frameId,
            opacity: 92,
            seed: seedFromId(bodyTextId),
            customData: {
              semanticRole: "node-body",
              semanticRootId: containerId,
            },
            ...stylePatchForPreset(
              { type: "text", customData: { semanticRole: "node-body" } },
              input.preset,
            ),
          };
          nodeElements.push(bodyElement);
          changedElementIds.add(bodyTextId);
          cursorY += bodyMetrics.height;
        }

        const containerHeight = Math.max(
          minHeight,
          Math.ceil(cursorY - Number(node.y) + NODE_PADDING),
        );

        const containerElement = {
          id: containerId,
          type: node.shape ?? "rectangle",
          x: Number(node.x),
          y: Number(node.y),
          width: containerWidth,
          height: containerHeight,
          groupIds: [groupId],
          frameId,
          seed: seedFromId(containerId),
          customData: {
            semanticRole: "node-container",
            semanticRootId: containerId,
            authoringPreset: input.preset,
          },
          ...stylePatchForPreset(
            { type: node.shape ?? "rectangle", customData: { semanticRole: "node-container" } },
            input.preset,
          ),
        };
        nextElements.push(containerElement, ...nodeElements);
        changedElementIds.add(containerId);

        composedNodes.push({
          nodeId: containerId,
          containerId,
          titleTextId,
          bodyTextId,
          iconElementId,
          imageElementId,
        });
      }

      const nextScene = this.jsonEngine.normalize({ ...scene, elements: nextElements });
      await this.store.save(nextScene);
      return {
        scene: nextScene,
        nodes: composedNodes,
        changedElementIds: [...changedElementIds].sort(),
      };
    });
  }

  async layoutSwimlanes(
    sceneId: string,
    input: {
      laneArrangement: "columns" | "rows";
      originX: number;
      originY: number;
      laneWidth: number;
      laneHeight: number;
      gap?: number;
      flowDirection?: "horizontal" | "vertical";
      lanes: Array<{
        laneId?: string;
        label: string;
        elementIds?: string[];
      }>;
    },
  ): Promise<{
    scene: SceneEnvelope;
    laneFrameIds: string[];
    laneHeaderIds: string[];
    changedElementIds: string[];
  }> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const elements = scene.elements.map((element) => ({ ...element }));
      const gap = Number(input.gap ?? SPACING_SCALE.sm);
      const flowDirection =
        input.flowDirection ??
        (input.laneArrangement === "columns" ? "vertical" : "horizontal");
      const changedElementIds = new Set<string>();
      const laneFrameIds: string[] = [];
      const laneHeaderIds: string[] = [];

      for (let index = 0; index < input.lanes.length; index += 1) {
        const lane = input.lanes[index]!;
        const frameId = lane.laneId ?? uuidv4();
        const groupId = uuidv4();
        const frameX =
          input.laneArrangement === "columns"
            ? Number(input.originX) + index * (Number(input.laneWidth) + gap)
            : Number(input.originX);
        const frameY =
          input.laneArrangement === "rows"
            ? Number(input.originY) + index * (Number(input.laneHeight) + gap)
            : Number(input.originY);
        const frameWidth = Number(input.laneWidth);
        const frameHeight = Number(input.laneHeight);

        let frame = elements.find((element) => element.id === frameId);
        if (!frame) {
          frame = {
            id: frameId,
            type: "frame",
          };
          elements.push(frame);
        }

        Object.assign(frame, {
          id: frameId,
          type: "frame",
          x: frameX,
          y: frameY,
          width: frameWidth,
          height: frameHeight,
          name: lane.label,
          groupIds: [groupId],
          seed: seedFromId(frameId),
          customData: {
            semanticRole: "lane-frame",
            semanticRootId: frameId,
          },
          ...stylePatchForPreset(
            { type: "frame", customData: { semanticRole: "lane-frame" } },
            "swimlane",
          ),
        });
        laneFrameIds.push(frameId);
        changedElementIds.add(frameId);

        const headerMetrics = measureWrappedTextBlock(
          lane.label,
          TEXT_SCALE.title,
          Math.max(64, frameWidth - FRAME_PADDING * 2),
        );
        let header = elements.find(
          (element) =>
            element.type === "text" &&
            element.customData?.semanticRole === "lane-header" &&
            element.customData?.laneFrameId === frameId,
        );
        if (!header) {
          header = {
            id: uuidv4(),
            type: "text",
          };
          elements.push(header);
        }

        Object.assign(header, {
          x: frameX + FRAME_PADDING,
          y: frameY + FRAME_PADDING,
          width: headerMetrics.width,
          height: headerMetrics.height,
          text: headerMetrics.text,
          originalText: headerMetrics.text,
          fontSize: TEXT_SCALE.title,
          fontFamily: 1,
          lineHeight: headerMetrics.lineHeight,
          autoResize: false,
          frameId,
          groupIds: [groupId],
          seed: seedFromId(String(header.id)),
          customData: {
            semanticRole: "lane-header",
            semanticRootId: frameId,
            laneFrameId: frameId,
          },
          ...stylePatchForPreset(
            { type: "text", customData: { semanticRole: "lane-header" } },
            "swimlane",
          ),
        });
        laneHeaderIds.push(String(header.id));
        changedElementIds.add(String(header.id));

        const rootIds = new Set(lane.elementIds ?? []);
        if (rootIds.size === 0) {
          continue;
        }

        const dependencyOrigins = collectDependencyOrigins(elements, rootIds);
        const allAssignedIds = new Set([...rootIds, ...dependencyOrigins.keys()]);
        for (const element of elements) {
          if (!allAssignedIds.has(String(element.id ?? ""))) {
            continue;
          }
          element.frameId = frameId;
          changedElementIds.add(String(element.id ?? ""));
        }

        const rootElements = elements.filter(
          (element) => rootIds.has(String(element.id ?? "")) && !element.isDeleted,
        );
        const orderedRootElements = [...rootElements].sort((left, right) => {
          const leftBounds = getElementBounds(left);
          const rightBounds = getElementBounds(right);
          return flowDirection === "horizontal"
            ? leftBounds.x - rightBounds.x || leftBounds.y - rightBounds.y
            : leftBounds.y - rightBounds.y || leftBounds.x - rightBounds.x;
        });

        const contentX = frameX + FRAME_PADDING;
        const contentY =
          frameY + FRAME_PADDING + headerMetrics.height + SPACING_SCALE.xs;
        const contentWidth = Math.max(96, frameWidth - FRAME_PADDING * 2);
        const contentHeight = Math.max(
          96,
          frameHeight - headerMetrics.height - FRAME_PADDING * 2 - SPACING_SCALE.xs,
        );

        const nextPositionsByRootId = new Map<string, { x: number; y: number }>();
        if (flowDirection === "horizontal") {
          let cursorX = contentX;
          let cursorY = contentY;
          let rowHeight = 0;

          for (const element of orderedRootElements) {
            const bounds = getElementBounds(element);
            if (
              cursorX > contentX &&
              cursorX + bounds.width > contentX + contentWidth
            ) {
              cursorX = contentX;
              cursorY += rowHeight + SPACING_SCALE.xs;
              rowHeight = 0;
            }
            nextPositionsByRootId.set(String(element.id), {
              x: cursorX,
              y: cursorY + Math.max(0, (contentHeight - bounds.height) / 2),
            });
            cursorX += bounds.width + SPACING_SCALE.sm;
            rowHeight = Math.max(rowHeight, bounds.height);
          }
        } else {
          let cursorX = contentX;
          let cursorY = contentY;
          let columnWidth = 0;

          for (const element of orderedRootElements) {
            const bounds = getElementBounds(element);
            if (
              cursorY > contentY &&
              cursorY + bounds.height > contentY + contentHeight
            ) {
              cursorY = contentY;
              cursorX += columnWidth + SPACING_SCALE.sm;
              columnWidth = 0;
            }
            nextPositionsByRootId.set(String(element.id), {
              x: cursorX + Math.max(0, (contentWidth - bounds.width) / 2),
              y: cursorY,
            });
            cursorY += bounds.height + SPACING_SCALE.sm;
            columnWidth = Math.max(columnWidth, bounds.width);
          }
        }

        const movedIds = moveRootsWithDependents(elements, rootIds, nextPositionsByRootId);
        for (const elementId of movedIds) {
          changedElementIds.add(elementId);
        }
      }

      const nextScene = this.jsonEngine.normalize({ ...scene, elements });
      await this.store.save(nextScene);
      return {
        scene: nextScene,
        laneFrameIds,
        laneHeaderIds,
        changedElementIds: [...changedElementIds].sort(),
      };
    });
  }

  async layoutPolish(
    sceneId: string,
    input: {
      issueCodes?: string[];
      elementIds?: string[];
      mode?: "safe";
    },
  ): Promise<{
    scene: SceneEnvelope;
    appliedActions: string[];
    changedElementIds: string[];
  }> {
    return this.withSceneLock(sceneId, async () => {
      const scene = await this.store.load(sceneId);
      const elements = scene.elements.map((element) => ({ ...element }));
      const analysis = analyzeDiagram({ ...scene, elements });
      const issueCodeFilter = input.issueCodes ? new Set(input.issueCodes) : null;
      const elementFilter = input.elementIds ? new Set(input.elementIds) : null;
      const issues = analysis.issues.filter((issue) => {
        if (issueCodeFilter && !issueCodeFilter.has(issue.code)) {
          return false;
        }
        if (!elementFilter) {
          return true;
        }
        const otherElementId = String(issue.details?.otherElementId ?? "");
        return (
          (issue.elementId ? elementFilter.has(issue.elementId) : false) ||
          (otherElementId ? elementFilter.has(otherElementId) : false)
        );
      });

      const changedElementIds = new Set<string>();
      const appliedActions: string[] = [];
      const currentIdToElement = () => buildIdToElement(elements);
      const summaryBounds = analysis.summary.bounds;

      const offCanvasRootIds = [
        ...new Set(
          issues
            .filter((issue) => issue.code === "ELEMENT_OFF_CANVAS" && issue.elementId)
            .map((issue) => {
              const element = currentIdToElement().get(issue.elementId!);
              return getSemanticRootId(element) ?? issue.elementId!;
            }),
        ),
      ];
      if (offCanvasRootIds.length > 0 && summaryBounds) {
        const nextPositionsByRootId = new Map<string, { x: number; y: number }>();
        let cursorY = summaryBounds.y + SPACING_SCALE.md;
        const stagingX = summaryBounds.x + summaryBounds.width + SPACING_SCALE.lg;
        for (const rootId of offCanvasRootIds) {
          const root = currentIdToElement().get(rootId);
          if (!root) {
            continue;
          }
          const bounds = getElementBounds(root);
          nextPositionsByRootId.set(rootId, { x: stagingX, y: cursorY });
          cursorY += bounds.height + SPACING_SCALE.sm;
        }
        const movedIds = moveRootsWithDependents(
          elements,
          new Set(offCanvasRootIds),
          nextPositionsByRootId,
        );
        for (const elementId of movedIds) {
          changedElementIds.add(elementId);
        }
        appliedActions.push("repositioned_off_canvas_elements");
      }

      const handledPairs = new Set<string>();
      const overlapIssues = issues.filter((issue) => issue.code === "ELEMENT_OVERLAP");
      for (const issue of overlapIssues) {
        const leftId = issue.elementId;
        const rightId = String(issue.details?.otherElementId ?? "");
        if (!leftId || !rightId) {
          continue;
        }
        const pairKey = [leftId, rightId].sort().join(":");
        if (handledPairs.has(pairKey)) {
          continue;
        }
        handledPairs.add(pairKey);

        const idToElement = currentIdToElement();
        const leftRootId = getSemanticRootId(idToElement.get(leftId)) ?? leftId;
        const rightRootId = getSemanticRootId(idToElement.get(rightId)) ?? rightId;
        if (leftRootId === rightRootId) {
          continue;
        }

        const left = idToElement.get(leftRootId);
        const right = idToElement.get(rightRootId);
        if (!left || !right || isFrameElement(left) || isFrameElement(right)) {
          continue;
        }

        const leftBounds = getElementBounds(left);
        const rightBounds = getElementBounds(right);
        const overlapWidth =
          Math.min(leftBounds.x + leftBounds.width, rightBounds.x + rightBounds.width) -
          Math.max(leftBounds.x, rightBounds.x);
        const overlapHeight =
          Math.min(leftBounds.y + leftBounds.height, rightBounds.y + rightBounds.height) -
          Math.max(leftBounds.y, rightBounds.y);
        if (overlapWidth <= 0 || overlapHeight <= 0) {
          continue;
        }

        const moveRight =
          rightBounds.y > leftBounds.y ||
          (rightBounds.y === leftBounds.y && rightBounds.x >= leftBounds.x);
        const target = moveRight ? right : left;
        const targetId = moveRight ? rightRootId : leftRootId;
        const targetBounds = moveRight ? rightBounds : leftBounds;
        const anchorBounds = moveRight ? leftBounds : rightBounds;
        const moveOnX = overlapWidth <= overlapHeight;
        const dx = moveOnX
          ? (targetBounds.cx >= anchorBounds.cx ? 1 : -1) * (overlapWidth + SPACING_SCALE.sm)
          : 0;
        const dy = moveOnX
          ? 0
          : (targetBounds.cy >= anchorBounds.cy ? 1 : -1) * (overlapHeight + SPACING_SCALE.sm);
        const movedIds = moveRootsWithDependents(
          elements,
          new Set([targetId]),
          new Map([
            [
              targetId,
              {
                x: Number(target.x ?? 0) + dx,
                y: Number(target.y ?? 0) + dy,
              },
            ],
          ]),
        );
        for (const elementId of movedIds) {
          changedElementIds.add(elementId);
        }
      }
      if (overlapIssues.length > 0) {
        appliedActions.push("resolved_overlaps");
      }

      if (issues.some((issue) => issue.code === "DENSE_CLUSTER")) {
        const roots = elements
          .filter((element) => {
            if (element.isDeleted || isConnectorElement(element) || isFrameElement(element)) {
              return false;
            }
            if (element.type === "text") {
              return false;
            }
            const semanticRootId = getSemanticRootId(element);
            return !semanticRootId || semanticRootId === String(element.id ?? "");
          })
          .sort((left, right) => {
            const leftBounds = getElementBounds(left);
            const rightBounds = getElementBounds(right);
            return leftBounds.y - rightBounds.y || leftBounds.x - rightBounds.x;
          });
        if (roots.length > 1 && summaryBounds) {
          const centerX = summaryBounds.x + summaryBounds.width / 2;
          const centerY = summaryBounds.y + summaryBounds.height / 2;
          const nextPositionsByRootId = new Map<string, { x: number; y: number }>();
          roots.forEach((root, index) => {
            const bounds = getElementBounds(root);
            let vectorX = bounds.cx - centerX;
            let vectorY = bounds.cy - centerY;
            if (vectorX === 0 && vectorY === 0) {
              vectorX = index % 2 === 0 ? 1 : -1;
              vectorY = index < roots.length / 2 ? -1 : 1;
            }
            const magnitude = Math.sqrt(vectorX * vectorX + vectorY * vectorY) || 1;
            const distance = Math.min(
              SPACING_SCALE.xl,
              Math.max(SPACING_SCALE.sm, magnitude * 0.12 + SPACING_SCALE.xs),
            );
            nextPositionsByRootId.set(String(root.id), {
              x: Number(root.x ?? 0) + (vectorX / magnitude) * distance,
              y: Number(root.y ?? 0) + (vectorY / magnitude) * distance,
            });
          });
          const movedIds = moveRootsWithDependents(
            elements,
            new Set(roots.map((root) => String(root.id))),
            nextPositionsByRootId,
          );
          for (const elementId of movedIds) {
            changedElementIds.add(elementId);
          }
          appliedActions.push("expanded_dense_cluster");
        }
      }

      if (summaryBounds) {
        const titleElements = elements.filter((element) => {
          const role = getSemanticRole(element);
          return (
            element.type === "text" &&
            !element.isDeleted &&
            (role === "scene-title" || (!role && Number(element.fontSize ?? 0) >= TEXT_SCALE.display))
          );
        });
        const legendElements = elements.filter((element) => {
          const role = getSemanticRole(element);
          const content = getTextContent(element);
          return (
            element.type === "text" &&
            !element.isDeleted &&
            (role === "scene-legend" || /legend|key/i.test(content))
          );
        });

        for (const title of titleElements) {
          title.x = summaryBounds.x;
          title.y = summaryBounds.y - TEXT_SCALE.display - SPACING_SCALE.xs;
          title.customData = {
            ...(title.customData ?? {}),
            semanticRole: "scene-title",
          };
          changedElementIds.add(String(title.id));
        }

        for (const legend of legendElements) {
          legend.x = summaryBounds.x;
          legend.y = summaryBounds.y + summaryBounds.height + SPACING_SCALE.sm;
          legend.customData = {
            ...(legend.customData ?? {}),
            semanticRole: "scene-legend",
          };
          changedElementIds.add(String(legend.id));
        }

        if (titleElements.length > 0 || legendElements.length > 0) {
          appliedActions.push("rebalanced_supporting_text");
        }
      }

      const refreshedConnectorIds = refreshConnectorsForMovedElements(
        elements,
        changedElementIds,
      );
      for (const connectorId of refreshedConnectorIds) {
        changedElementIds.add(connectorId);
      }
      if (refreshedConnectorIds.size > 0) {
        appliedActions.push("refreshed_connector_geometry");
      }

      const nextScene = this.jsonEngine.normalize({ ...scene, elements });
      await this.store.save(nextScene);
      return {
        scene: nextScene,
        appliedActions,
        changedElementIds: [...changedElementIds].sort(),
      };
    });
  }

  async layoutFlow(
    sceneId: string,
    input: {
      elementIds: string[];
      direction?: "horizontal" | "vertical";
      gap?: number;
      connect?: boolean;
      connectorType?: "arrow" | "line";
      preset?: StylePreset;
    },
  ): Promise<{ scene: SceneEnvelope; changedElementIds: string[] }> {
    const direction = input.direction ?? "horizontal";
    const arranged = await this.arrangeElements(sceneId, {
      elementIds: input.elementIds,
      mode: "stack",
      axis: direction === "horizontal" ? "x" : "y",
      anchor: "center",
      gap: input.gap ?? 80,
      includeDependents: true,
    });

    let scene = arranged.scene;
    const changedElementIds = new Set(arranged.changedElementIds);

    if (input.preset) {
      const styled = await this.applyStylePreset(sceneId, {
        elementIds: input.elementIds,
        preset: input.preset,
        includeDependents: true,
      });
      scene = styled.scene;
      for (const elementId of styled.changedElementIds) {
        changedElementIds.add(elementId);
      }
    }

    if (input.connect) {
      const orderedIds = sortElementIdsByAxis(
        scene.elements,
        input.elementIds,
        direction === "horizontal" ? "x" : "y",
      );

      for (let index = 0; index < orderedIds.length - 1; index += 1) {
        const connector = await this.createConnector(sceneId, {
          sourceElementId: orderedIds[index]!,
          targetElementId: orderedIds[index + 1]!,
          connectorType: input.connectorType ?? "arrow",
        });
        scene = connector.scene;
        changedElementIds.add(connector.connectorId);
        if (connector.labelId) {
          changedElementIds.add(connector.labelId);
        }
      }
    }

    return {
      scene,
      changedElementIds: [...changedElementIds].sort(),
    };
  }

  async composeDiagram(input: {
    sceneId?: string;
    title: string;
    diagramType?: "flow" | "swimlane" | "architecture" | "board";
    stylePreset?: StylePreset;
    qualityTarget?: number;
    nodes: Array<{
      id?: string;
      title: string;
      body?: string;
      laneId?: string;
      frameId?: string;
      iconText?: string;
      imageFileId?: string;
    }>;
    edges?: Array<{
      source: string;
      target: string;
      label?: string;
      connectorType?: "arrow" | "line";
    }>;
    frames?: Array<{
      id?: string;
      title: string;
      kind?: FrameKind;
      nodeIds?: string[];
    }>;
    lanes?: Array<{
      id?: string;
      label: string;
      nodeIds?: string[];
    }>;
    legend?: string;
    openInSessionId?: string;
  }): Promise<{
    scene: SceneEnvelope;
    nodeIds: string[];
    connectorIds: string[];
    validation: Awaited<ReturnType<SceneService["validateScene"]>>;
    qualityGate: Awaited<ReturnType<SceneService["qualityGate"]>>;
  }> {
    const sceneId = input.sceneId ?? uuidv4();
    const stylePreset = input.stylePreset ?? "process";
    const existing = await this.store.exists(sceneId);

    if (!existing) {
      await this.createScene({ sceneId, name: input.title });
    } else {
      await this.patchScene(sceneId, [{ op: "setName", name: input.title }]);
    }

    if (input.openInSessionId) {
      this.sessionActiveScene.set(input.openInSessionId, sceneId);
    }

    const nodeIds = input.nodes.map((node) => node.id ?? uuidv4());
    const titleId = `${sceneId}-title`;
    await this.createElementsFromSkeletons(sceneId, [
      {
        id: titleId,
        type: "text",
        x: 48,
        y: 32,
        text: input.title,
        fontSize: TEXT_SCALE.display,
        fontFamily: 1,
        customData: { semanticRole: "scene-title" },
      },
    ]);
    await this.applyStylePreset(sceneId, {
      elementIds: [titleId],
      preset: "title",
      includeDependents: false,
    });

    const columns =
      input.diagramType === "architecture" || input.diagramType === "board"
        ? Math.ceil(Math.sqrt(input.nodes.length))
        : input.nodes.length;
    const composed = await this.composeNodes(sceneId, {
      preset: stylePreset,
      nodes: input.nodes.map((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
          nodeId: nodeIds[index],
          x: 80 + column * 280,
          y: 140 + row * 180,
          width: 220,
          minHeight: 120,
          title: node.title,
          body: node.body,
          iconText: node.iconText,
          imageFileId: node.imageFileId,
          frameId: node.frameId,
        };
      }),
    });
    let scene = composed.scene;

    if (input.lanes && input.lanes.length > 0) {
      const lanes = input.lanes.map((lane, index) => ({
        laneId: lane.id ?? `lane-${index + 1}`,
        label: lane.label,
        elementIds:
          lane.nodeIds ??
          input.nodes
            .map((node, nodeIndex) =>
              node.laneId === lane.id || node.laneId === lane.label
                ? nodeIds[nodeIndex]
                : null,
            )
            .filter((id): id is string => Boolean(id)),
      }));
      const laneLayout = await this.layoutSwimlanes(sceneId, {
        laneArrangement: "columns",
        originX: 48,
        originY: 104,
        laneWidth: 280,
        laneHeight: Math.max(260, 160 + input.nodes.length * 16),
        lanes,
      });
      scene = laneLayout.scene;
    } else if (input.frames && input.frames.length > 0) {
      for (let index = 0; index < input.frames.length; index += 1) {
        const frame = input.frames[index]!;
        const frameId = frame.id ?? `frame-${index + 1}`;
        const children = frame.nodeIds ?? nodeIds;
        const frameX = 48 + index * 360;
        await this.createFrame(sceneId, {
          frameId,
          kind: frame.kind,
          name: frame.title,
          x: frameX,
          y: 104,
          width: 320,
          height: 300,
          children,
        });
      }
      scene = await this.getScene(sceneId);
    } else if (nodeIds.length > 1) {
      const flow = await this.layoutFlow(sceneId, {
        elementIds: nodeIds,
        direction: "horizontal",
        gap: 80,
        connect: false,
        preset: stylePreset,
      });
      scene = flow.scene;
    }

    const connectorIds: string[] = [];
    const edges: Array<{
      source: string;
      target: string;
      label?: string;
      connectorType?: "arrow" | "line";
    }> =
      input.edges ??
      nodeIds.slice(0, -1).map((source, index) => ({
        source,
        target: nodeIds[index + 1]!,
      }));
    for (const edge of edges) {
      const connector = await this.createConnector(sceneId, {
        sourceElementId: edge.source,
        targetElementId: edge.target,
        label: edge.label,
        connectorType: edge.connectorType,
      });
      connectorIds.push(connector.connectorId);
      scene = connector.scene;
    }

    const legend =
      input.legend ??
      (connectorIds.length > 0 ? "Legend: arrows show relationships or flow" : undefined);
    if (legend) {
      const bounds = analyzeDiagram(scene).summary.bounds;
      const legendId = `${sceneId}-legend`;
      await this.createElementsFromSkeletons(sceneId, [
        {
          id: legendId,
          type: "text",
          x: bounds?.x ?? 48,
          y: bounds ? bounds.y + bounds.height + SPACING_SCALE.sm : 520,
          text: legend,
          fontSize: TEXT_SCALE.supporting,
          fontFamily: 1,
          customData: { semanticRole: "scene-legend" },
        },
      ]);
      await this.applyStylePreset(sceneId, {
        elementIds: [legendId],
        preset: "legend",
        includeDependents: false,
      });
      scene = await this.getScene(sceneId);
    }

    await this.layoutPolish(sceneId, { mode: "safe" });
    scene = await this.fitToContent(sceneId);
    const validation = await this.validateScene(sceneId);
    const qualityGate = await this.qualityGate(sceneId, {
      minScore: input.qualityTarget ?? 90,
    });

    return {
      scene,
      nodeIds,
      connectorIds,
      validation,
      qualityGate,
    };
  }

  async diagramFromMermaid(input: {
    sceneId?: string;
    definition: string;
    merge?: boolean;
    name?: string;
  }): Promise<{ scene: SceneEnvelope; createdScene: boolean }> {
    const { parseMermaidToExcalidraw } = await getMermaidParser();
    const parsed = await parseMermaidToExcalidraw(input.definition);

    if (!input.sceneId) {
      const scene = await this.createScene({
        name: input.name ?? "Mermaid Diagram",
        elements: parsed.elements,
      });

      if (parsed.files) {
        const withFiles = this.jsonEngine.normalize({
          ...scene,
          files: parsed.files as any,
        });
        await this.store.save(withFiles);
        return { scene: withFiles, createdScene: true };
      }

      return {
        scene,
        createdScene: true,
      };
    }

    return this.withSceneLock(input.sceneId, async () => {
      const scene = await this.store.load(input.sceneId!);
      const nextScene = this.jsonEngine.normalize({
        ...scene,
        elements:
          input.merge === false
            ? parsed.elements
            : [...scene.elements, ...(parsed.elements as any[])],
        files:
          input.merge === false
            ? (parsed.files as any) ?? {}
            : { ...scene.files, ...(parsed.files as any) },
      });

      await this.store.save(nextScene);

      return {
        scene: nextScene,
        createdScene: false,
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

  async exportScene(
    sceneId: string,
    options: ExportOptions,
  ): Promise<{
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
      storeRoot: this.store.rootPath,
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
