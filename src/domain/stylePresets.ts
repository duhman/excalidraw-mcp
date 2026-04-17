export const STYLE_PRESETS = [
  "process",
  "decision",
  "note",
  "title",
  "legend",
  "accent",
  "swimlane",
  "boundary",
  "supporting_text",
] as const;

export type StylePreset = (typeof STYLE_PRESETS)[number];

export const SPACING_SCALE = {
  xxs: 8,
  xs: 16,
  sm: 24,
  md: 32,
  lg: 48,
  xl: 72,
} as const;

export const TEXT_SCALE = {
  display: 30,
  title: 18,
  body: 16,
  supporting: 14,
} as const;

export const NODE_PADDING = 20;
export const FRAME_PADDING = 24;

export const CONNECTOR_DEFAULTS = {
  strokeWidth: 2,
  roughness: 1,
} as const;

const DEFAULT_FONT_FAMILY = 1;
const DEFAULT_LINE_HEIGHT = 1.25;
const TEXT_WIDTH_FACTOR = 0.58;

function semanticRoleFor(element: any): string {
  return String(element?.customData?.semanticRole ?? "");
}

function textSizeFor(element: any, preset: StylePreset): number {
  const role = semanticRoleFor(element);
  if (role === "scene-title") {
    return TEXT_SCALE.display;
  }
  if (role === "lane-header" || role === "node-title") {
    return TEXT_SCALE.title;
  }
  if (
    role === "scene-legend" ||
    role === "supporting-text" ||
    preset === "legend" ||
    preset === "supporting_text"
  ) {
    return TEXT_SCALE.supporting;
  }
  return preset === "title" ? TEXT_SCALE.display : TEXT_SCALE.body;
}

export function estimateTextWidth(text: string, fontSize: number): number {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return maxLineLength * fontSize * TEXT_WIDTH_FACTOR;
}

function wrapLongWord(word: string, maxCharsPerLine: number): string[] {
  if (word.length <= maxCharsPerLine) {
    return [word];
  }

  const pieces: string[] = [];
  for (let index = 0; index < word.length; index += maxCharsPerLine) {
    pieces.push(word.slice(index, index + maxCharsPerLine));
  }
  return pieces;
}

export function wrapTextToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
): string {
  const maxCharsPerLine = Math.max(
    6,
    Math.floor(maxWidth / Math.max(1, fontSize * TEXT_WIDTH_FACTOR)),
  );
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");

  return normalized
    .split("\n")
    .map((paragraph) => {
      const words = paragraph
        .split(/\s+/)
        .filter(Boolean)
        .flatMap((word) => wrapLongWord(word, maxCharsPerLine));

      if (words.length === 0) {
        return "";
      }

      const lines: string[] = [];
      let current = words[0] ?? "";

      for (let index = 1; index < words.length; index += 1) {
        const nextWord = words[index] ?? "";
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
    })
    .join("\n");
}

export function measureWrappedTextBlock(
  text: string,
  fontSize: number,
  maxWidth: number,
  lineHeight = DEFAULT_LINE_HEIGHT,
): {
  text: string;
  width: number;
  height: number;
  lineCount: number;
  lineHeight: number;
} {
  const wrapped = wrapTextToWidth(text, maxWidth, fontSize);
  const lines = wrapped.split("\n");
  const lineCount = Math.max(1, lines.length);
  const width = Math.min(maxWidth, Math.max(fontSize * 2, estimateTextWidth(wrapped, fontSize)));
  const height = Math.max(fontSize * lineHeight, Math.ceil(lineCount * fontSize * lineHeight));

  return {
    text: wrapped,
    width,
    height,
    lineCount,
    lineHeight,
  };
}

export function stylePatchForPreset(
  element: any,
  preset: StylePreset,
): Record<string, unknown> {
  const type = String(element?.type ?? "");
  const role = semanticRoleFor(element);
  const isText = type === "text";
  const isConnector = type === "arrow" || type === "line";
  const textSize = textSizeFor(element, preset);

  switch (preset) {
    case "decision":
      if (isText) {
        return {
          fontSize: role === "node-title" ? TEXT_SCALE.title : textSize,
          fontFamily: DEFAULT_FONT_FAMILY,
          strokeColor: "#5f3dc4",
        };
      }
      if (isConnector) {
        return {
          strokeColor: "#5f3dc4",
          ...CONNECTOR_DEFAULTS,
        };
      }
      return {
        backgroundColor: "#fff3bf",
        fillStyle: "solid",
        strokeColor: "#5f3dc4",
        ...CONNECTOR_DEFAULTS,
      };
    case "note":
      if (isText) {
        return {
          fontSize: textSize,
          fontFamily: DEFAULT_FONT_FAMILY,
          strokeColor: "#663c00",
        };
      }
      if (isConnector) {
        return {
          strokeColor: "#99582a",
          strokeStyle: "dashed",
          ...CONNECTOR_DEFAULTS,
        };
      }
      return {
        backgroundColor: "#fff9db",
        fillStyle: "solid",
        strokeColor: "#99582a",
        ...CONNECTOR_DEFAULTS,
      };
    case "title":
      if (isText) {
        return {
          fontSize: TEXT_SCALE.display,
          fontFamily: DEFAULT_FONT_FAMILY,
          strokeColor: "#1e1e1e",
        };
      }
      return {
        backgroundColor: "#edf2ff",
        fillStyle: "solid",
        strokeColor: "#364fc7",
        ...CONNECTOR_DEFAULTS,
      };
    case "legend":
    case "supporting_text":
      if (isText) {
        return {
          fontSize: TEXT_SCALE.supporting,
          fontFamily: DEFAULT_FONT_FAMILY,
          strokeColor: "#495057",
          opacity: 85,
        };
      }
      if (isConnector) {
        return {
          strokeColor: "#6c757d",
          opacity: 85,
          ...CONNECTOR_DEFAULTS,
        };
      }
      return {
        backgroundColor: "#f8f9fa",
        fillStyle: "solid",
        strokeColor: "#adb5bd",
        opacity: 85,
      };
    case "accent":
      if (isText) {
        return {
          fontSize: role === "lane-header" ? TEXT_SCALE.title : textSize,
          fontFamily: DEFAULT_FONT_FAMILY,
          strokeColor: "#1864ab",
        };
      }
      if (isConnector) {
        return {
          strokeColor: "#1864ab",
          ...CONNECTOR_DEFAULTS,
        };
      }
      return {
        backgroundColor: "#d0ebff",
        fillStyle: "solid",
        strokeColor: "#1864ab",
        ...CONNECTOR_DEFAULTS,
      };
    case "swimlane":
      if (isText) {
        return {
          fontSize: role === "lane-header" ? TEXT_SCALE.title : textSize,
          fontFamily: DEFAULT_FONT_FAMILY,
          strokeColor: "#0b7285",
        };
      }
      if (isConnector) {
        return {
          strokeColor: "#0b7285",
          strokeStyle: "solid",
          ...CONNECTOR_DEFAULTS,
        };
      }
      return {
        backgroundColor: "#e3fafc",
        fillStyle: "solid",
        strokeColor: "#0b7285",
        strokeWidth: CONNECTOR_DEFAULTS.strokeWidth,
        roughness: CONNECTOR_DEFAULTS.roughness,
        opacity: 92,
      };
    case "boundary":
      if (isText) {
        return {
          fontSize: textSize,
          fontFamily: DEFAULT_FONT_FAMILY,
          strokeColor: "#495057",
        };
      }
      if (isConnector) {
        return {
          strokeColor: "#495057",
          strokeStyle: "dashed",
          ...CONNECTOR_DEFAULTS,
        };
      }
      return {
        backgroundColor: "transparent",
        fillStyle: "hachure",
        strokeColor: "#495057",
        strokeStyle: "dashed",
        strokeWidth: CONNECTOR_DEFAULTS.strokeWidth,
        roughness: CONNECTOR_DEFAULTS.roughness,
      };
    case "process":
    default:
      if (isText) {
        return {
          fontSize: role === "node-title" ? TEXT_SCALE.title : textSize,
          fontFamily: DEFAULT_FONT_FAMILY,
          strokeColor: "#1e1e1e",
        };
      }
      if (isConnector) {
        return {
          strokeColor: "#1e1e1e",
          ...CONNECTOR_DEFAULTS,
        };
      }
      return {
        backgroundColor: "#e7f5ff",
        fillStyle: "solid",
        strokeColor: "#1e1e1e",
        strokeWidth: CONNECTOR_DEFAULTS.strokeWidth,
        roughness: CONNECTOR_DEFAULTS.roughness,
        roundness: { type: 3 },
      };
  }
}
