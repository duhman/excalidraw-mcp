import type { SceneEnvelope } from "../types/contracts.js";

export type QualitySeverity = "error" | "warning";

export interface DiagramQualityIssue {
  code: "CONNECTOR_UNBOUND" | "TEXT_OVERFLOW";
  severity: QualitySeverity;
  message: string;
  elementId: string;
  details?: Record<string, unknown>;
}

export interface DiagramQualityResult {
  scene: SceneEnvelope;
  issues: DiagramQualityIssue[];
  fixesApplied: number;
}

type Point = { x: number; y: number };
type Bounds = { x1: number; y1: number; x2: number; y2: number; cx: number; cy: number };

const CONNECTOR_TYPES = new Set(["arrow", "line"]);
const OVERFLOW_CHAR_FACTOR = 0.58;
const DEFAULT_FONT_SIZE = 20;
const DEFAULT_LINE_HEIGHT = 1.25;
const CONTAINER_PADDING = 16;

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
    cx: (x1 + x2) / 2,
    cy: (y1 + y2) / 2
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

function pointDistance(point: Point, bounds: Bounds): number {
  const dx = point.x - bounds.cx;
  const dy = point.y - bounds.cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function connectorEndpoints(connector: Record<string, unknown>): { start: Point; end: Point } {
  const x = num(connector.x);
  const y = num(connector.y);
  const points = Array.isArray(connector.points) ? connector.points : null;

  if (points && points.length > 0) {
    const first = Array.isArray(points[0]) ? points[0] : [0, 0];
    const last = Array.isArray(points[points.length - 1]) ? points[points.length - 1] : first;

    return {
      start: { x: x + num(first[0]), y: y + num(first[1]) },
      end: { x: x + num(last[0]), y: y + num(last[1]) }
    };
  }

  return {
    start: { x, y },
    end: { x: x + num(connector.width), y: y + num(connector.height) }
  };
}

function inferBindingTargetId(
  point: Point,
  candidates: Array<Record<string, unknown>>,
  excludeId: string
): string | null {
  let best: { id: string; distance: number } | null = null;

  for (const element of candidates) {
    const id = String(element.id ?? "");
    if (!id || id === excludeId) {
      continue;
    }

    const type = String(element.type ?? "");
    if (CONNECTOR_TYPES.has(type)) {
      continue;
    }

    if (element.isDeleted) {
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

function ensureBoundElementsRef(target: Record<string, unknown>, connectorId: string, connectorType: string): void {
  const existing = Array.isArray(target.boundElements) ? [...target.boundElements] : [];
  const found = existing.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    return String((entry as Record<string, unknown>).id ?? "") === connectorId;
  });

  if (!found) {
    existing.push({
      id: connectorId,
      type: connectorType
    });
    target.boundElements = existing;
  }
}

function setBinding(
  connector: Record<string, unknown>,
  side: "startBinding" | "endBinding",
  targetId: string
): void {
  connector[side] = {
    elementId: targetId,
    focus: 0,
    gap: 0
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

function wrapText(text: string, maxCharsPerLine: number): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const paragraphs = normalized.split("\n");

  const wrappedParagraphs = paragraphs.map((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return "";
    }

    const lines: string[] = [];
    let current = words[0] ?? "";

    for (let i = 1; i < words.length; i += 1) {
      const nextWord = words[i] ?? "";
      const candidate = `${current} ${nextWord}`;
      if (candidate.length <= maxCharsPerLine) {
        current = candidate;
      } else {
        lines.push(current);
        current = nextWord;
      }
    }

    lines.push(current);
    return lines.join("\n");
  });

  return wrappedParagraphs.join("\n");
}

function estimateTextWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return maxLine * fontSize * OVERFLOW_CHAR_FACTOR;
}

export function applyDiagramQuality(scene: SceneEnvelope, fix = true): DiagramQualityResult {
  const nextScene: SceneEnvelope = {
    ...scene,
    elements: scene.elements.map((element) => ({ ...element }))
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

    const type = String(element.type ?? "");

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
        endpoint: Point
      ): string | null => {
        if (currentId && idToElement.has(currentId)) {
          return currentId;
        }
        if (hintId && idToElement.has(hintId)) {
          return hintId;
        }
        return inferBindingTargetId(endpoint, nextScene.elements as Array<Record<string, unknown>>, elementId);
      };

      const resolvedStartId = resolveTarget(fromHint, startBindingId, start);
      const resolvedEndId = resolveTarget(toHint, endBindingId, end);

      if (!resolvedStartId) {
        issues.push({
          code: "CONNECTOR_UNBOUND",
          severity: "error",
          message: "Connector start is not bound to a valid element",
          elementId,
          details: { side: "start" }
        });
      } else if (!startBindingId || startBindingId !== resolvedStartId) {
        if (fix) {
          setBinding(element, "startBinding", resolvedStartId);
          ensureBoundElementsRef(idToElement.get(resolvedStartId) as Record<string, unknown>, elementId, type);
          fixesApplied += 1;
        }
      }

      if (!resolvedEndId) {
        issues.push({
          code: "CONNECTOR_UNBOUND",
          severity: "error",
          message: "Connector end is not bound to a valid element",
          elementId,
          details: { side: "end" }
        });
      } else if (!endBindingId || endBindingId !== resolvedEndId) {
        if (fix) {
          setBinding(element, "endBinding", resolvedEndId);
          ensureBoundElementsRef(idToElement.get(resolvedEndId) as Record<string, unknown>, elementId, type);
          fixesApplied += 1;
        }
      }
    }

    if (type === "text") {
      const containerId = typeof element.containerId === "string" ? element.containerId : null;
      if (!containerId) {
        continue;
      }

      const container = idToElement.get(containerId);
      if (!container || Boolean(container.isDeleted)) {
        continue;
      }

      const text = String(element.text ?? element.originalText ?? "");
      const fontSize = Math.max(8, num(element.fontSize, DEFAULT_FONT_SIZE));
      const lineHeight = Math.max(1, num(element.lineHeight, DEFAULT_LINE_HEIGHT));
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
            maxTextWidth
          }
        });

        if (fix) {
          const maxChars = Math.max(8, Math.floor(maxTextWidth / (fontSize * OVERFLOW_CHAR_FACTOR)));
          const wrapped = wrapText(text, maxChars);
          const lines = wrapped.split("\n").length;

          element.text = wrapped;
          element.originalText = wrapped;
          element.width = maxTextWidth;
          element.height = Math.max(num(element.height), Math.ceil(lines * fontSize * lineHeight));
          fixesApplied += 1;
        }
      }
    }
  }

  return {
    scene: nextScene,
    issues,
    fixesApplied
  };
}
