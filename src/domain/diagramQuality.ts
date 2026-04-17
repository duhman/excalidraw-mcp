import type { SceneEnvelope } from "../types/contracts.js";
import {
  estimateTextWidth,
  measureWrappedTextBlock,
} from "./stylePresets.js";

export type QualitySeverity = "error" | "warning" | "info";

export type DiagramQualityIssueCode =
  | "CONNECTOR_UNBOUND"
  | "CONNECTOR_CROSSING"
  | "CONTAINER_MISSING"
  | "CONTAINER_TEXT_UNBOUND"
  | "DENSE_CLUSTER"
  | "ELEMENT_OFF_CANVAS"
  | "ELEMENT_OVERLAP"
  | "FRAME_TARGET_MISSING"
  | "GEOMETRY_INVALID"
  | "IMAGE_FILE_MISSING"
  | "MISSING_LEGEND"
  | "MISSING_TITLE"
  | "TEXT_OVERFLOW"
  | "TEXT_UNREADABLE"
  | "TYPOGRAPHY_INCONSISTENT";

export interface DiagramQualityIssue {
  code: DiagramQualityIssueCode;
  severity: QualitySeverity;
  message: string;
  elementId?: string;
  details?: Record<string, unknown>;
}

export interface DiagramQualityResult {
  scene: SceneEnvelope;
  issues: DiagramQualityIssue[];
  fixesApplied: number;
}

export interface DiagramAnalysisSummary {
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  elementCount: number;
  visibleElementCount: number;
  deletedElementCount: number;
  typeHistogram: Record<string, number>;
  graph: {
    nodeCount: number;
    connectorCount: number;
    boundConnectorCount: number;
    frameCount: number;
  };
  typography: {
    fontFamilies: number[];
    fontSizes: number[];
  };
  density: {
    elementArea: number;
    canvasArea: number;
    ratio: number;
  };
}

export interface DiagramAnalysisResult extends DiagramQualityResult {
  score: number;
  summary: DiagramAnalysisSummary;
  recommendedActions: DiagramRecommendedAction[];
}

export interface DiagramRecommendedAction {
  tool: "scene_normalize" | "styles_apply_preset" | "layout_polish";
  issueCodes: DiagramQualityIssueCode[];
  elementIds?: string[];
  reason: string;
}

type Point = { x: number; y: number };
type Bounds = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
};

const CONNECTOR_TYPES = new Set(["arrow", "line"]);
const DEFAULT_FONT_SIZE = 20;
const DEFAULT_LINE_HEIGHT = 1.25;
const CONTAINER_PADDING = 16;

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isVisibleElement(element: Record<string, unknown>): boolean {
  return !element.isDeleted;
}

function isConnector(element: Record<string, unknown>): boolean {
  return CONNECTOR_TYPES.has(String(element.type ?? ""));
}

function boundsFor(element: Record<string, unknown>): Bounds {
  const x = num(element.x);
  const y = num(element.y);
  const width = Math.max(0, num(element.width));
  const height = Math.max(0, num(element.height));

  const x1 = Math.min(x, x + width);
  const y1 = Math.min(y, y + height);
  const x2 = Math.max(x, x + width);
  const y2 = Math.max(y, y + height);

  return {
    x1,
    y1,
    x2,
    y2,
    width: x2 - x1,
    height: y2 - y1,
    cx: (x1 + x2) / 2,
    cy: (y1 + y2) / 2,
  };
}

function pointInsideBounds(point: Point, bounds: Bounds, tolerance = 8): boolean {
  return (
    point.x >= bounds.x1 - tolerance &&
    point.x <= bounds.x2 + tolerance &&
    point.y >= bounds.y1 - tolerance &&
    point.y <= bounds.y2 + tolerance
  );
}

function semanticRootId(element: Record<string, unknown>): string | null {
  const value =
    element.customData &&
    typeof element.customData === "object"
      ? (element.customData as Record<string, unknown>).semanticRootId
      : null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function elementId(element: Record<string, unknown>): string {
  return String(element.id ?? "");
}

function isSemanticChild(element: Record<string, unknown>): boolean {
  const rootId = semanticRootId(element);
  return Boolean(rootId && rootId !== elementId(element));
}

function pointDistance(point: Point, bounds: Bounds): number {
  const dx = point.x - bounds.cx;
  const dy = point.y - bounds.cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function connectorEndpoints(
  connector: Record<string, unknown>,
): { start: Point; end: Point } {
  const x = num(connector.x);
  const y = num(connector.y);
  const points = Array.isArray(connector.points) ? connector.points : null;

  if (points && points.length > 0) {
    const first = Array.isArray(points[0]) ? points[0] : [0, 0];
    const last =
      Array.isArray(points[points.length - 1]) ? points[points.length - 1] : first;

    return {
      start: { x: x + num(first[0]), y: y + num(first[1]) },
      end: { x: x + num(last[0]), y: y + num(last[1]) },
    };
  }

  return {
    start: { x, y },
    end: { x: x + num(connector.width), y: y + num(connector.height) },
  };
}

function inferBindingTargetId(
  point: Point,
  candidates: Array<Record<string, unknown>>,
  excludeId: string,
): string | null {
  let best: { id: string; distance: number } | null = null;

  for (const element of candidates) {
    const id = String(element.id ?? "");
    if (!id || id === excludeId || !isVisibleElement(element) || isConnector(element)) {
      continue;
    }

    const bounds = boundsFor(element);
    if (!pointInsideBounds(point, bounds, 12)) {
      continue;
    }

    const distance = pointDistance(point, bounds);
    if (!best || distance < best.distance) {
      best = { id, distance };
    }
  }

  return best?.id ?? null;
}

function ensureBoundElementsRef(
  target: Record<string, unknown>,
  boundElementId: string,
  boundElementType: string,
): boolean {
  const existing = Array.isArray(target.boundElements)
    ? [...target.boundElements]
    : [];

  const found = existing.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    return String((entry as Record<string, unknown>).id ?? "") === boundElementId;
  });

  if (found) {
    return false;
  }

  existing.push({
    id: boundElementId,
    type: boundElementType,
  });
  target.boundElements = existing;
  return true;
}

function setBinding(
  connector: Record<string, unknown>,
  side: "startBinding" | "endBinding",
  targetId: string,
): void {
  connector[side] = {
    elementId: targetId,
    focus: 0,
    gap: 0,
  };
}

function extractBindingId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const elementId = (value as Record<string, unknown>).elementId;
  if (typeof elementId === "string" && elementId.length > 0) {
    return elementId;
  }

  return null;
}

function hasInvalidGeometry(element: Record<string, unknown>): boolean {
  const geometry = [element.x, element.y, element.width, element.height, element.angle];
  if (geometry.some((value) => !Number.isFinite(Number(value)))) {
    return true;
  }

  if (!Array.isArray(element.points)) {
    return false;
  }

  return element.points.some((point) => {
    if (!Array.isArray(point) || point.length < 2) {
      return true;
    }

    return !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]));
  });
}

function sanitizeGeometry(element: Record<string, unknown>): void {
  element.x = num(element.x);
  element.y = num(element.y);
  element.width = Math.max(0, num(element.width));
  element.height = Math.max(0, num(element.height));
  element.angle = num(element.angle);

  if (Array.isArray(element.points)) {
    element.points = element.points.map((point) => {
      if (!Array.isArray(point) || point.length < 2) {
        return [0, 0];
      }

      return [num(point[0]), num(point[1])];
    });
  }
}

function intersectionArea(a: Bounds, b: Bounds): number {
  const overlapWidth = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const overlapHeight = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);

  if (overlapWidth <= 0 || overlapHeight <= 0) {
    return 0;
  }

  return overlapWidth * overlapHeight;
}

function isFrameElement(element: Record<string, unknown>): boolean {
  const type = String(element.type ?? "");
  return type === "frame" || type === "magicframe";
}

function boundsContain(outer: Bounds, inner: Bounds, tolerance = 8): boolean {
  return (
    inner.x1 >= outer.x1 - tolerance &&
    inner.y1 >= outer.y1 - tolerance &&
    inner.x2 <= outer.x2 + tolerance &&
    inner.y2 <= outer.y2 + tolerance
  );
}

function shouldIgnoreOverlap(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  currentBounds: Bounds,
  nextBounds: Bounds,
): boolean {
  const currentId = String(current.id ?? "");
  const nextId = String(next.id ?? "");
  const currentFrameId = String(current.frameId ?? "");
  const nextFrameId = String(next.frameId ?? "");
  const currentSemanticRootId = semanticRootId(current);
  const nextSemanticRootId = semanticRootId(next);

  if (
    currentSemanticRootId &&
    nextSemanticRootId &&
    currentSemanticRootId === nextSemanticRootId
  ) {
    return true;
  }

  if (
    currentSemanticRootId === nextId ||
    nextSemanticRootId === currentId
  ) {
    return true;
  }

  if (
    isFrameElement(current) &&
    (nextFrameId === currentId || boundsContain(currentBounds, nextBounds))
  ) {
    return true;
  }

  if (
    isFrameElement(next) &&
    (currentFrameId === nextId || boundsContain(nextBounds, currentBounds))
  ) {
    return true;
  }

  return false;
}

function ccw(a: Point, b: Point, c: Point): boolean {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function dedupeIssues(issues: DiagramQualityIssue[]): DiagramQualityIssue[] {
  const seen = new Set<string>();
  const deduped: DiagramQualityIssue[] = [];

  for (const issue of issues) {
    const key = JSON.stringify([
      issue.code,
      issue.severity,
      issue.elementId ?? null,
      issue.message,
      issue.details ?? null,
    ]);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(issue);
  }

  return deduped;
}

function buildSummary(scene: SceneEnvelope): DiagramAnalysisSummary {
  const visibleElements = scene.elements.filter((element) => !element.isDeleted);
  const typeHistogram: Record<string, number> = {};
  let bounds: Bounds | null = null;
  let elementArea = 0;

  const typographyFamilies = new Set<number>();
  const typographySizes = new Set<number>();
  let nodeCount = 0;
  let connectorCount = 0;
  let boundConnectorCount = 0;
  let frameCount = 0;

  for (const rawElement of visibleElements) {
    const element = rawElement as Record<string, unknown>;
    const type = String(element.type ?? "unknown");
    typeHistogram[type] = (typeHistogram[type] ?? 0) + 1;

    const elementBounds = boundsFor(element);
    if (!isSemanticChild(element)) {
      elementArea += elementBounds.width * elementBounds.height;
    }

    bounds = bounds
      ? {
          x1: Math.min(bounds.x1, elementBounds.x1),
          y1: Math.min(bounds.y1, elementBounds.y1),
          x2: Math.max(bounds.x2, elementBounds.x2),
          y2: Math.max(bounds.y2, elementBounds.y2),
          width: 0,
          height: 0,
          cx: 0,
          cy: 0,
        }
      : elementBounds;

    if (type === "text") {
      typographyFamilies.add(num(element.fontFamily, 1));
      typographySizes.add(num(element.fontSize, DEFAULT_FONT_SIZE));
    } else if (CONNECTOR_TYPES.has(type)) {
      connectorCount += 1;
      if (
        extractBindingId(element.startBinding) &&
        extractBindingId(element.endBinding)
      ) {
        boundConnectorCount += 1;
      }
    } else {
      if (!isSemanticChild(element)) {
        nodeCount += 1;
      }
      if (type === "frame" || type === "magicframe") {
        frameCount += 1;
      }
    }
  }

  if (bounds) {
    bounds.width = bounds.x2 - bounds.x1;
    bounds.height = bounds.y2 - bounds.y1;
    bounds.cx = (bounds.x1 + bounds.x2) / 2;
    bounds.cy = (bounds.y1 + bounds.y2) / 2;
  }

  const canvasArea = bounds ? bounds.width * bounds.height : 0;
  const densityRatio = canvasArea > 0 ? elementArea / canvasArea : 0;

  return {
    bounds: bounds
      ? {
          x: bounds.x1,
          y: bounds.y1,
          width: bounds.width,
          height: bounds.height,
        }
      : null,
    elementCount: visibleElements.length,
    visibleElementCount: visibleElements.length,
    deletedElementCount: scene.elements.length - visibleElements.length,
    typeHistogram,
    graph: {
      nodeCount,
      connectorCount,
      boundConnectorCount,
      frameCount,
    },
    typography: {
      fontFamilies: [...typographyFamilies].sort((a, b) => a - b),
      fontSizes: [...typographySizes].sort((a, b) => a - b),
    },
    density: {
      elementArea,
      canvasArea,
      ratio: densityRatio,
    },
  };
}

function scoreIssues(issues: DiagramQualityIssue[]): number {
  let score = 100;

  for (const issue of issues) {
    if (issue.severity === "error") {
      score -= 15;
    } else if (issue.severity === "warning") {
      score -= 7;
    } else {
      score -= 3;
    }
  }

  return Math.max(0, Math.min(100, score));
}

function collectIssueElementIds(
  issues: DiagramQualityIssue[],
  codes: DiagramQualityIssueCode[],
): string[] | undefined {
  const codeSet = new Set(codes);
  const ids = [
    ...new Set(
      issues
        .filter((issue) => codeSet.has(issue.code))
        .flatMap((issue) => {
          const direct = issue.elementId ? [issue.elementId] : [];
          const other =
            typeof issue.details?.otherElementId === "string"
              ? [issue.details.otherElementId]
              : [];
          return [...direct, ...other];
        }),
    ),
  ];
  return ids.length > 0 ? ids : undefined;
}

function buildRecommendedActions(
  issues: DiagramQualityIssue[],
): DiagramRecommendedAction[] {
  const actions: DiagramRecommendedAction[] = [];

  const structuralCodes: DiagramQualityIssueCode[] = [
    "CONNECTOR_UNBOUND",
    "CONTAINER_MISSING",
    "CONTAINER_TEXT_UNBOUND",
    "FRAME_TARGET_MISSING",
    "GEOMETRY_INVALID",
    "IMAGE_FILE_MISSING",
    "TEXT_OVERFLOW",
  ];
  const layoutCodes: DiagramQualityIssueCode[] = [
    "CONNECTOR_CROSSING",
    "DENSE_CLUSTER",
    "ELEMENT_OFF_CANVAS",
    "ELEMENT_OVERLAP",
  ];
  const typographyCodes: DiagramQualityIssueCode[] = [
    "TEXT_UNREADABLE",
    "TYPOGRAPHY_INCONSISTENT",
  ];

  if (issues.some((issue) => structuralCodes.includes(issue.code))) {
    actions.push({
      tool: "scene_normalize",
      issueCodes: structuralCodes.filter((code) =>
        issues.some((issue) => issue.code === code),
      ),
      elementIds: collectIssueElementIds(issues, structuralCodes),
      reason:
        "Repair structural scene invariants first so later layout and styling tools operate on valid Excalidraw data.",
    });
  }

  if (issues.some((issue) => layoutCodes.includes(issue.code))) {
    actions.push({
      tool: "layout_polish",
      issueCodes: layoutCodes.filter((code) =>
        issues.some((issue) => issue.code === code),
      ),
      elementIds: collectIssueElementIds(issues, layoutCodes),
      reason:
        "Resolve deterministic layout problems such as overlap, crowding, off-canvas placement, and connector readability next.",
    });
  }

  if (issues.some((issue) => typographyCodes.includes(issue.code))) {
    actions.push({
      tool: "styles_apply_preset",
      issueCodes: typographyCodes.filter((code) =>
        issues.some((issue) => issue.code === code),
      ),
      elementIds: collectIssueElementIds(issues, typographyCodes),
      reason:
        "Bring typography back onto the preset scale so labels stay readable and visually consistent.",
    });
  }

  return actions;
}

export function applyDiagramQuality(
  scene: SceneEnvelope,
  fix = true,
): DiagramQualityResult {
  const nextScene: SceneEnvelope = {
    ...scene,
    elements: scene.elements.map((element) => ({ ...element })),
    appState: { ...scene.appState },
    files: { ...scene.files },
    libraryItems: [...scene.libraryItems],
  };

  const idToElement = new Map<string, Record<string, unknown>>();
  for (const element of nextScene.elements) {
    const id = String((element as Record<string, unknown>).id ?? "");
    if (id) {
      idToElement.set(id, element as Record<string, unknown>);
    }
  }

  const issues: DiagramQualityIssue[] = [];
  let fixesApplied = 0;

  for (const rawElement of nextScene.elements) {
    const element = rawElement as Record<string, unknown>;
    const elementId = String(element.id ?? "");

    if (!elementId) {
      continue;
    }

    if (hasInvalidGeometry(element)) {
      issues.push({
        code: "GEOMETRY_INVALID",
        severity: "error",
        message: "Element geometry contains non-finite values",
        elementId,
      });

      if (fix) {
        sanitizeGeometry(element);
        fixesApplied += 1;
      }
    }

    if (Array.isArray(element.boundElements)) {
      const nextBoundElements = element.boundElements.filter((entry) => {
        if (!entry || typeof entry !== "object") {
          return false;
        }

        const boundId = String((entry as Record<string, unknown>).id ?? "");
        if (!boundId) {
          return false;
        }

        const bound = idToElement.get(boundId);
        return Boolean(bound && !bound.isDeleted);
      });

      if (nextBoundElements.length !== element.boundElements.length && fix) {
        element.boundElements = nextBoundElements;
        fixesApplied += 1;
      }
    }

    const frameId =
      typeof element.frameId === "string" && element.frameId.length > 0
        ? element.frameId
        : null;
    if (frameId) {
      const frame = idToElement.get(frameId);
      if (!frame || frame.isDeleted) {
        issues.push({
          code: "FRAME_TARGET_MISSING",
          severity: "error",
          message: "Element references a missing frame",
          elementId,
          details: { frameId },
        });

        if (fix) {
          element.frameId = null;
          fixesApplied += 1;
        }
      }
    }

    const type = String(element.type ?? "");
    if (type === "image") {
      const fileId =
        typeof element.fileId === "string" && element.fileId.length > 0
          ? element.fileId
          : null;
      if (fileId && !nextScene.files[fileId]) {
        issues.push({
          code: "IMAGE_FILE_MISSING",
          severity: "error",
          message: "Image element references a missing binary file",
          elementId,
          details: { fileId },
        });
      }
    }

    if (CONNECTOR_TYPES.has(type)) {
      const { start, end } = connectorEndpoints(element);
      const customData =
        element.customData && typeof element.customData === "object"
          ? (element.customData as Record<string, unknown>)
          : {};

      const fromHint = typeof customData.fromId === "string" ? customData.fromId : null;
      const toHint = typeof customData.toId === "string" ? customData.toId : null;
      const startBindingId = extractBindingId(element.startBinding);
      const endBindingId = extractBindingId(element.endBinding);

      const resolveTarget = (
        hintId: string | null,
        currentId: string | null,
        endpoint: Point,
      ): string | null => {
        if (currentId && idToElement.has(currentId)) {
          return currentId;
        }
        if (hintId && idToElement.has(hintId)) {
          return hintId;
        }

        return inferBindingTargetId(
          endpoint,
          nextScene.elements as Array<Record<string, unknown>>,
          elementId,
        );
      };

      const resolvedStartId = resolveTarget(fromHint, startBindingId, start);
      const resolvedEndId = resolveTarget(toHint, endBindingId, end);

      if (!resolvedStartId) {
        issues.push({
          code: "CONNECTOR_UNBOUND",
          severity: "error",
          message: "Connector start is not bound to a valid element",
          elementId,
          details: { side: "start" },
        });
      } else if (!startBindingId || startBindingId !== resolvedStartId) {
        if (fix) {
          setBinding(element, "startBinding", resolvedStartId);
          ensureBoundElementsRef(
            idToElement.get(resolvedStartId) as Record<string, unknown>,
            elementId,
            type,
          );
          fixesApplied += 1;
        }
      }

      if (!resolvedEndId) {
        issues.push({
          code: "CONNECTOR_UNBOUND",
          severity: "error",
          message: "Connector end is not bound to a valid element",
          elementId,
          details: { side: "end" },
        });
      } else if (!endBindingId || endBindingId !== resolvedEndId) {
        if (fix) {
          setBinding(element, "endBinding", resolvedEndId);
          ensureBoundElementsRef(
            idToElement.get(resolvedEndId) as Record<string, unknown>,
            elementId,
            type,
          );
          fixesApplied += 1;
        }
      }

      if (Array.isArray(element.boundElements)) {
        for (const boundEntry of element.boundElements) {
          const labelId =
            boundEntry && typeof boundEntry === "object"
              ? String((boundEntry as Record<string, unknown>).id ?? "")
              : "";
          if (!labelId) {
            continue;
          }

          const label = idToElement.get(labelId);
          if (!label || label.isDeleted || label.type !== "text") {
            continue;
          }

          if (label.containerId !== elementId && fix) {
            label.containerId = elementId;
            fixesApplied += 1;
          }
        }
      }
    }

    if (type === "text") {
      const containerId =
        typeof element.containerId === "string" && element.containerId.length > 0
          ? element.containerId
          : null;
      if (!containerId) {
        continue;
      }

      const container = idToElement.get(containerId);
      if (!container || Boolean(container.isDeleted)) {
        issues.push({
          code: "CONTAINER_MISSING",
          severity: "error",
          message: "Text references a missing container",
          elementId,
          details: { containerId },
        });

        if (fix) {
          element.containerId = null;
          fixesApplied += 1;
        }
        continue;
      }

      const boundElementFixed = ensureBoundElementsRef(container, elementId, "text");
      if (boundElementFixed) {
        issues.push({
          code: "CONTAINER_TEXT_UNBOUND",
          severity: "warning",
          message: "Container text is missing its parent backlink",
          elementId,
          details: { containerId },
        });

        if (fix) {
          fixesApplied += 1;
        }
      }

      const text = String(element.text ?? element.originalText ?? "");
      const fontSize = Math.max(8, num(element.fontSize, DEFAULT_FONT_SIZE));
      const lineHeight = Math.max(1, num(element.lineHeight, DEFAULT_LINE_HEIGHT));
      if (CONNECTOR_TYPES.has(String(container.type ?? ""))) {
        continue;
      }
      const containerWidth = Math.max(40, num(container.width, 40));
      const maxTextWidth = Math.max(32, containerWidth - CONTAINER_PADDING);
      const estimatedWidth = estimateTextWidth(text, fontSize);

      if (estimatedWidth > maxTextWidth) {
        issues.push({
          code: "TEXT_OVERFLOW",
          severity: "warning",
          message: "Text overflows its container width",
          elementId,
          details: {
            containerId,
            estimatedWidth,
            maxTextWidth,
          },
        });

        if (fix) {
          const measured = measureWrappedTextBlock(
            text,
            fontSize,
            maxTextWidth,
            lineHeight,
          );

          element.text = measured.text;
          element.originalText = measured.text;
          element.width = measured.width;
          element.height = Math.max(num(element.height), measured.height);
          fixesApplied += 1;
        }
      }
    }
  }

  return {
    scene: nextScene,
    issues: dedupeIssues(issues),
    fixesApplied,
  };
}

export function analyzeDiagram(scene: SceneEnvelope): DiagramAnalysisResult {
  const base = applyDiagramQuality(scene, false);
  const analysisIssues: DiagramQualityIssue[] = [...base.issues];
  const visibleElements = base.scene.elements.filter((element) => !element.isDeleted);
  const textElements = visibleElements.filter((element) => element.type === "text");

  const titleElements = textElements.filter((element: any) => {
    const fontSize = num(element.fontSize, DEFAULT_FONT_SIZE);
    return !element.containerId && fontSize >= 24;
  });

  if (titleElements.length === 0 && visibleElements.length > 0) {
    analysisIssues.push({
      code: "MISSING_TITLE",
      severity: "warning",
      message: "Scene is missing a prominent title element",
    });
  }

  const legendElements = textElements.filter((element: any) =>
    /legend|key/i.test(String(element.text ?? element.originalText ?? "")),
  );
  const connectorCount = visibleElements.filter((element) =>
    CONNECTOR_TYPES.has(String(element.type ?? "")),
  ).length;
  if (connectorCount >= 2 && legendElements.length === 0) {
    analysisIssues.push({
      code: "MISSING_LEGEND",
      severity: "info",
      message: "Scene has relationships but no legend or key text",
    });
  }

  const fontFamilies = new Set<number>();
  const fontSizes = new Set<number>();
  for (const rawText of textElements) {
    const text = rawText as Record<string, unknown>;
    fontFamilies.add(num(text.fontFamily, 1));
    fontSizes.add(num(text.fontSize, DEFAULT_FONT_SIZE));

    const fontSize = num(text.fontSize, DEFAULT_FONT_SIZE);
    const content = String(text.text ?? text.originalText ?? "");
    if (content.trim().length > 0 && fontSize < 12) {
      analysisIssues.push({
        code: "TEXT_UNREADABLE",
        severity: "warning",
        message: "Text is likely too small to read comfortably",
        elementId: String(text.id ?? ""),
        details: { fontSize },
      });
    }
  }

  if (fontFamilies.size > 2 || fontSizes.size > 4) {
    analysisIssues.push({
      code: "TYPOGRAPHY_INCONSISTENT",
      severity: "warning",
      message: "Scene uses too many font sizes or font families",
      details: {
        fontFamilies: [...fontFamilies],
        fontSizes: [...fontSizes],
      },
    });
  }

  const overlapCandidates = visibleElements.filter((element: any) => {
    if (CONNECTOR_TYPES.has(String(element.type ?? ""))) {
      return false;
    }
    if (element.type === "text" && element.containerId) {
      return false;
    }
    return !isSemanticChild(element);
  });

  for (let index = 0; index < overlapCandidates.length; index += 1) {
    const current = overlapCandidates[index] as Record<string, unknown>;
    const currentBounds = boundsFor(current);

    if (Math.abs(currentBounds.cx) > 5000 || Math.abs(currentBounds.cy) > 5000) {
      analysisIssues.push({
        code: "ELEMENT_OFF_CANVAS",
        severity: "warning",
        message: "Element is very far from the rest of the drawing area",
        elementId: String(current.id ?? ""),
        details: { x: currentBounds.cx, y: currentBounds.cy },
      });
    }

    for (let nextIndex = index + 1; nextIndex < overlapCandidates.length; nextIndex += 1) {
      const next = overlapCandidates[nextIndex] as Record<string, unknown>;
      const nextBounds = boundsFor(next);
      if (shouldIgnoreOverlap(current, next, currentBounds, nextBounds)) {
        continue;
      }

      const area = intersectionArea(currentBounds, nextBounds);
      const smallerArea = Math.min(
        Math.max(1, currentBounds.width * currentBounds.height),
        Math.max(1, nextBounds.width * nextBounds.height),
      );

      if (area > 0 && area / smallerArea >= 0.12) {
        analysisIssues.push({
          code: "ELEMENT_OVERLAP",
          severity: "warning",
          message: "Elements overlap enough to risk visual collisions",
          elementId: String(current.id ?? ""),
          details: { otherElementId: String(next.id ?? "") },
        });
        analysisIssues.push({
          code: "ELEMENT_OVERLAP",
          severity: "warning",
          message: "Elements overlap enough to risk visual collisions",
          elementId: String(next.id ?? ""),
          details: { otherElementId: String(current.id ?? "") },
        });
      }
    }
  }

  const connectors = visibleElements.filter((element: any) =>
    CONNECTOR_TYPES.has(String(element.type ?? "")),
  ) as Array<Record<string, unknown>>;
  for (let index = 0; index < connectors.length; index += 1) {
    const current = connectors[index];
    const currentEndpoints = connectorEndpoints(current);
    const currentBindings = new Set([
      extractBindingId(current.startBinding),
      extractBindingId(current.endBinding),
    ]);

    for (let nextIndex = index + 1; nextIndex < connectors.length; nextIndex += 1) {
      const next = connectors[nextIndex];
      const nextBindings = new Set([
        extractBindingId(next.startBinding),
        extractBindingId(next.endBinding),
      ]);
      const shareBinding = [...currentBindings].some(
        (bindingId) => bindingId && nextBindings.has(bindingId),
      );
      if (shareBinding) {
        continue;
      }

      const nextEndpoints = connectorEndpoints(next);
      if (
        segmentsIntersect(
          currentEndpoints.start,
          currentEndpoints.end,
          nextEndpoints.start,
          nextEndpoints.end,
        )
      ) {
        analysisIssues.push({
          code: "CONNECTOR_CROSSING",
          severity: "warning",
          message: "Connectors likely cross and reduce readability",
          elementId: String(current.id ?? ""),
          details: { otherElementId: String(next.id ?? "") },
        });
        analysisIssues.push({
          code: "CONNECTOR_CROSSING",
          severity: "warning",
          message: "Connectors likely cross and reduce readability",
          elementId: String(next.id ?? ""),
          details: { otherElementId: String(current.id ?? "") },
        });
      }
    }
  }

  const summary = buildSummary(base.scene);
  if (summary.visibleElementCount >= 6 && summary.density.ratio >= 0.58) {
    analysisIssues.push({
      code: "DENSE_CLUSTER",
      severity: "warning",
      message: "Scene content is tightly packed and may benefit from more space",
      details: { densityRatio: summary.density.ratio },
    });
  }

  const issues = dedupeIssues(analysisIssues);

  return {
    ...base,
    issues,
    score: scoreIssues(issues),
    summary,
    recommendedActions: buildRecommendedActions(issues),
  };
}
