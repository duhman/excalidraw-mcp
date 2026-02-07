import { z } from "zod";

export const RUNTIME_MODES = ["json-engine", "browser-engine"] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

export interface SceneMetadata {
  sceneId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  elementCount: number;
  fileCount: number;
  engineHints: {
    hasFrames: boolean;
    hasEmbeddables: boolean;
    hasImages: boolean;
  };
  revisionHash: string;
}

export interface SceneEnvelope {
  metadata: SceneMetadata;
  elements: any[];
  appState: Record<string, unknown>;
  files: Record<string, any>;
  libraryItems: any[];
}

export type ScenePatchOperation =
  | {
      op: "setName";
      name: string;
    }
  | {
      op: "addElements";
      elements: any[];
    }
  | {
      op: "updateElements";
      elements: Array<{ id: string; patch: Record<string, unknown> }>;
    }
  | {
      op: "deleteElements";
      elementIds: string[];
      hardDelete?: boolean;
    }
  | {
      op: "setAppState";
      appState: Record<string, unknown>;
      merge?: boolean;
    }
  | {
      op: "setLibrary";
      libraryItems: any[];
      merge?: boolean;
    }
  | {
      op: "setFiles";
      files: Record<string, any>;
      merge?: boolean;
    };

export interface ExportOptions {
  format: "svg" | "png" | "webp" | "json";
  scale?: number;
  embedScene?: boolean;
  darkMode?: boolean;
  padding?: number;
  quality?: number;
  maxWidthOrHeight?: number;
}

export interface ToolExecutionContext {
  workspaceRoot: string;
  sessionId: string;
  requestId?: string | number;
}

export const sceneIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/, "sceneId must contain only alphanumeric, underscore, or hyphen");

export const exportFormatSchema = z.enum(["svg", "png", "webp", "json"]);

export const exportOptionsSchema = z.object({
  format: exportFormatSchema,
  scale: z.number().min(0.1).max(8).optional(),
  embedScene: z.boolean().optional(),
  darkMode: z.boolean().optional(),
  padding: z.number().int().min(0).max(512).optional(),
  quality: z.number().min(0).max(1).optional(),
  maxWidthOrHeight: z.number().int().min(16).max(16384).optional()
});

export const scenePatchOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("setName"),
    name: z.string().min(1).max(256)
  }),
  z.object({
    op: z.literal("addElements"),
    elements: z.array(z.record(z.string(), z.unknown())).min(1)
  }),
  z.object({
    op: z.literal("updateElements"),
    elements: z
      .array(
        z.object({
          id: z.string().min(1),
          patch: z.record(z.string(), z.unknown())
        })
      )
      .min(1)
  }),
  z.object({
    op: z.literal("deleteElements"),
    elementIds: z.array(z.string().min(1)).min(1),
    hardDelete: z.boolean().optional()
  }),
  z.object({
    op: z.literal("setAppState"),
    appState: z.record(z.string(), z.unknown()),
    merge: z.boolean().optional()
  }),
  z.object({
    op: z.literal("setLibrary"),
    libraryItems: z.array(z.record(z.string(), z.unknown())),
    merge: z.boolean().optional()
  }),
  z.object({
    op: z.literal("setFiles"),
    files: z.record(z.string(), z.record(z.string(), z.unknown())),
    merge: z.boolean().optional()
  })
]);

export const sceneEnvelopeSchema = z.object({
  metadata: z.object({
    sceneId: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    elementCount: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
    engineHints: z.object({
      hasFrames: z.boolean(),
      hasEmbeddables: z.boolean(),
      hasImages: z.boolean()
    }),
    revisionHash: z.string()
  }),
  elements: z.array(z.record(z.string(), z.unknown())),
  appState: z.record(z.string(), z.unknown()),
  files: z.record(z.string(), z.record(z.string(), z.unknown())),
  libraryItems: z.array(z.record(z.string(), z.unknown()))
});

export type SceneEnvelopeInput = z.infer<typeof sceneEnvelopeSchema>;
