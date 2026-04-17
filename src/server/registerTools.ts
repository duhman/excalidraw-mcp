import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SceneService } from "../domain/sceneService.js";
import type { ExportService } from "../export/exportService.js";
import type { AccountImporter } from "../account/accountImporter.js";
import { asAppError } from "../utils/errors.js";
import {
  exportOptionsSchema,
  sceneIdSchema,
  scenePatchOperationSchema,
} from "../types/contracts.js";
import { STYLE_PRESETS } from "../domain/stylePresets.js";

const standardOutputSchema = z.object({
  ok: z.boolean(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

const stylePresetSchema = z.enum(STYLE_PRESETS);
const layerDirectionSchema = z.enum([
  "forward",
  "backward",
  "front",
  "back",
]);
const nodeShapeSchema = z.enum(["rectangle", "ellipse", "diamond"]);

function success(data: Record<string, unknown>, text: string) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: {
      ok: true,
      data,
    },
  };
}

function failure(error: unknown) {
  const appError = asAppError(error);
  return {
    isError: true,
    content: [
      { type: "text" as const, text: `${appError.code}: ${appError.message}` },
    ],
    structuredContent: {
      ok: false,
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details,
      },
    },
  };
}

function getSessionId(extra: { sessionId?: string }): string {
  return extra.sessionId ?? "stdio-session";
}

async function resolveSceneId(
  sceneService: SceneService,
  sessionId: string,
  sceneIdInput?: string,
): Promise<string> {
  if (sceneIdInput) {
    return sceneIdInput;
  }

  const active = await sceneService.getActiveScene(sessionId);
  if (!active) {
    throw new Error(
      "BAD_REQUEST: sceneId is required when no active scene is open in this session",
    );
  }

  return active.metadata.sceneId;
}

async function stageSceneImportFile(
  sceneService: SceneService,
  sceneId: string,
): Promise<{ tempDir: string; inputPath: string }> {
  const scene = await sceneService.getScene(sceneId);
  const tempDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-scene-"));
  const inputPath = join(tempDir, `${scene.metadata.sceneId}.excalidraw`);

  await writeFile(
    inputPath,
    JSON.stringify(
      {
        type: "excalidraw",
        version: 2,
        source: "https://excalidraw.com",
        elements: scene.elements,
        appState: scene.appState,
        files: scene.files,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    tempDir,
    inputPath,
  };
}

async function stageLibraryImportFile(
  sceneService: SceneService,
  sceneId: string,
): Promise<{ tempDir: string; inputPath: string }> {
  const libraryItems = await sceneService.getLibrary(sceneId);
  const tempDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-library-"));
  const inputPath = join(tempDir, `${sceneId}.excalidrawlib`);

  await writeFile(
    inputPath,
    JSON.stringify(
      {
        type: "excalidrawlib",
        version: 2,
        source: "https://excalidraw.com",
        libraryItems,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    tempDir,
    inputPath,
  };
}

export function registerTools(
  server: McpServer,
  sceneService: SceneService,
  exportService: ExportService,
  accountImporter: AccountImporter,
): void {
  const readOnlyAnnotations = {
    readOnlyHint: true,
    idempotentHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  const mutatingAnnotations = {
    readOnlyHint: false,
    idempotentHint: false,
    destructiveHint: true,
    openWorldHint: false,
  };

  server.registerTool(
    "scene_create",
    {
      description: "Create a new Excalidraw scene in workspace storage",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        name: z.string().min(1).max(256).optional(),
        elements: z.array(z.record(z.string(), z.unknown())).optional(),
        appState: z.record(z.string(), z.unknown()).optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async (args) => {
      try {
        const scene = await sceneService.createScene(args);
        return success({ scene }, `Created scene ${scene.metadata.sceneId}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "scene_import_json",
    {
      description:
        "Import an Excalidraw scene JSON payload into managed workspace storage",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        payload: z.record(z.string(), z.unknown()),
        merge: z.boolean().optional(),
        name: z.string().min(1).max(256).optional(),
        openAfterImport: z.boolean().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, payload, merge, name, openAfterImport }, extra) => {
      try {
        const result = await sceneService.importSceneFromJson({
          sceneId,
          payload,
          merge,
          name,
          openInSessionId:
            openAfterImport === false ? undefined : getSessionId(extra),
        });
        return success(
          { scene: result.scene, createdScene: result.createdScene },
          `${result.createdScene ? "Imported new" : "Updated"} scene ${result.scene.metadata.sceneId} from JSON`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "scene_open",
    {
      description: "Open a scene for the current MCP session",
      inputSchema: {
        sceneId: sceneIdSchema,
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId }, extra) => {
      try {
        const scene = await sceneService.openScene(
          sceneId,
          getSessionId(extra),
        );
        return success({ scene }, `Opened scene ${sceneId}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "scene_list",
    {
      description: "List all scene metadata in the workspace",
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => {
      try {
        const scenes = await sceneService.listScenes();
        return success(
          { scenes, count: scenes.length },
          `Listed ${scenes.length} scenes`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "scene_get",
    {
      description: "Get full scene payload",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const scene = await sceneService.getScene(resolvedId);
        return success({ scene }, `Loaded scene ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "scene_save",
    {
      description: "Save current or explicit scene",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const scene = await sceneService.saveScene(resolvedId);
        return success({ scene }, `Saved scene ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "scene_close",
    {
      description: "Close scene in active session context",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.closeScene(
          resolvedId,
          getSessionId(extra),
        );
        return success(
          { sceneId: resolvedId, ...result },
          `Closed scene ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "scene_patch",
    {
      description: "Apply ordered deterministic patch operations to a scene",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        operations: z.array(scenePatchOperationSchema).min(1),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, operations }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.patchScene(
          resolvedId,
          operations as any,
        );
        return success(
          {
            scene: result.scene,
            changedElementIds: result.changedElementIds,
            revisionHash: result.scene.metadata.revisionHash,
          },
          `Patched scene ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "scene_validate",
    {
      description:
        "Run hard correctness validation before export or account import. Best near the end of the workflow after analyze/normalize/layout cleanup.",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const validation = await sceneService.validateScene(resolvedId);
        const qualityErrors = validation.qualityIssues.filter(
          (issue) => issue.severity === "error",
        ).length;
        const qualityWarnings = validation.qualityIssues.filter(
          (issue) => issue.severity === "warning",
        ).length;
        return success(
          validation as any,
          `Validation ${validation.valid ? "passed" : "failed"} for ${resolvedId} (${qualityErrors} quality errors, ${qualityWarnings} warnings, score ${validation.qualityScore})`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "scene_analyze",
    {
      description:
        "Best first read for an existing scene. Analyze quality, layout, readability, and structural issues without mutating it, and use recommendedActions to plan deterministic follow-up tools.",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const analysis = await sceneService.analyzeScene(resolvedId);
        return success(
          analysis as any,
          `Analyzed ${resolvedId} (score ${analysis.score}, ${analysis.issues.length} issues, ${analysis.recommendedActions.length} recommended actions)`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "scene_normalize",
    {
      description:
        "Safely repair structural scene invariants via the Excalidraw restore pipeline. Use when analyze/validate reports broken geometry, bindings, frame targets, or file/container issues.",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const scene = await sceneService.normalizeScene(resolvedId);
        return success({ scene }, `Normalized scene ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "elements_create",
    {
      description: "Create one or more elements in a scene",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        elements: z.array(z.record(z.string(), z.unknown())).min(1),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, elements }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.patchScene(resolvedId, [
          { op: "addElements", elements },
        ] as any);
        return success(
          {
            scene: result.scene,
            changedElementIds: result.changedElementIds,
          },
          `Created ${result.changedElementIds.length} elements in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "elements_update",
    {
      description: "Update existing elements by id with partial patches",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        elements: z
          .array(
            z.object({
              id: z.string().min(1),
              patch: z.record(z.string(), z.unknown()),
            }),
          )
          .min(1),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, elements }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.patchScene(resolvedId, [
          { op: "updateElements", elements },
        ] as any);
        return success(
          {
            scene: result.scene,
            changedElementIds: result.changedElementIds,
          },
          `Updated ${result.changedElementIds.length} elements in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "elements_delete",
    {
      description: "Delete elements by id (soft delete by default)",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        elementIds: z.array(z.string().min(1)).min(1),
        hardDelete: z.boolean().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, elementIds, hardDelete }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.patchScene(resolvedId, [
          { op: "deleteElements", elementIds, hardDelete },
        ] as any);
        return success(
          {
            scene: result.scene,
            changedElementIds: result.changedElementIds,
          },
          `Deleted ${result.changedElementIds.length} elements in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "elements_list",
    {
      description: "List scene elements with optional filtering",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        includeDeleted: z.boolean().optional(),
        type: z.string().optional(),
        limit: z.number().int().min(1).max(10000).optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ sceneId, includeDeleted, type, limit }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const elements = await sceneService.listElements(resolvedId, {
          includeDeleted,
          type,
          limit,
        });
        return success(
          { elements, count: elements.length },
          `Listed ${elements.length} elements from ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "elements_arrange",
    {
      description:
        "Arrange existing elements with deterministic align/distribute/stack/grid helpers. Dependency-aware by default so bound labels, grouped children, and container text move together.",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        elementIds: z.array(z.string().min(1)).min(1),
        mode: z.enum(["align", "distribute", "stack", "grid"]),
        axis: z.enum(["x", "y", "both"]).optional(),
        gap: z.number().optional(),
        anchor: z.enum(["min", "center", "max"]).optional(),
        columns: z.number().int().min(1).max(100).optional(),
        includeDependents: z.boolean().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async (
      {
        sceneId,
        elementIds,
        mode,
        axis,
        gap,
        anchor,
        columns,
        includeDependents,
      },
      extra,
    ) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.arrangeElements(resolvedId, {
          elementIds,
          mode,
          axis,
          gap,
          anchor,
          columns,
          includeDependents,
        });
        return success(
          { scene: result.scene, changedElementIds: result.changedElementIds },
          `Arranged ${result.changedElementIds.length} elements in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "frames_create",
    {
      description:
        "Create a frame or magic frame region and optionally assign elements into it",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        frameId: z.string().min(1).optional(),
        name: z.string().min(1).max(256).optional(),
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
        elementIds: z.array(z.string().min(1)).optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, frameId, name, x, y, width, height, elementIds }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.createFrame(resolvedId, {
          frameId,
          name,
          x,
          y,
          width,
          height,
          elementIds,
        });
        return success(
          {
            scene: result.scene,
            frameId: result.frameId,
            changedElementIds: result.changedElementIds,
          },
          `Created frame ${result.frameId} in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "frames_assign_elements",
    {
      description: "Assign existing elements into an existing frame",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        frameId: z.string().min(1),
        elementIds: z.array(z.string().min(1)).min(1),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, frameId, elementIds }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.assignElementsToFrame(resolvedId, {
          frameId,
          elementIds,
        });
        return success(
          { scene: result.scene, changedElementIds: result.changedElementIds },
          `Assigned ${elementIds.length} elements to frame ${frameId} in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "styles_apply_preset",
    {
      description:
        "Apply a deterministic Excalidraw style preset to elements and their dependents. Prefer this over manual color/font/stroke edits for consistent visual language.",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        elementIds: z.array(z.string().min(1)).min(1),
        preset: stylePresetSchema,
        includeDependents: z.boolean().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, elementIds, preset, includeDependents }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.applyStylePreset(resolvedId, {
          elementIds,
          preset,
          includeDependents,
        });
        return success(
          { scene: result.scene, changedElementIds: result.changedElementIds },
          `Applied ${preset} preset to ${result.changedElementIds.length} elements in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "layers_reorder",
    {
      description:
        "Reorder selected elements in the scene layer stack while keeping dependents together",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        elementIds: z.array(z.string().min(1)).min(1),
        direction: layerDirectionSchema,
        includeDependents: z.boolean().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, elementIds, direction, includeDependents }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.reorderLayers(resolvedId, {
          elementIds,
          direction,
          includeDependents,
        });
        return success(
          { scene: result.scene, changedElementIds: result.changedElementIds },
          `Reordered ${result.changedElementIds.length} elements ${direction} in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "nodes_create",
    {
      description:
        "Create simple higher-level diagram nodes with preset styling and optional body text. Use nodes_compose instead when you need semantic title/body/icon/image slots and auto-fit behavior.",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        nodes: z
          .array(
            z.object({
              id: z.string().min(1).optional(),
              label: z.string().min(1),
              body: z.string().optional(),
              shape: z.enum(["rectangle", "ellipse", "diamond"]).optional(),
              x: z.number(),
              y: z.number(),
              width: z.number().optional(),
              height: z.number().optional(),
            }),
          )
          .min(1),
        preset: stylePresetSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, nodes, preset }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.createNodes(resolvedId, {
          nodes,
          preset,
        });
        return success(
          { scene: result.scene, changedElementIds: result.changedElementIds },
          `Created ${result.changedElementIds.length} node-related elements in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "nodes_compose",
    {
      description:
        "Preferred node-authoring tool for polished output. Compose semantic diagram nodes with container, title, body, icon slot, image slot, and auto-height growth.",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        preset: stylePresetSchema,
        nodes: z
          .array(
            z.object({
              nodeId: z.string().min(1).optional(),
              x: z.number(),
              y: z.number(),
              width: z.number().optional(),
              minHeight: z.number().optional(),
              title: z.string().min(1),
              body: z.string().optional(),
              iconText: z.string().optional(),
              imageFileId: z.string().min(1).optional(),
              frameId: z.string().min(1).optional(),
              shape: nodeShapeSchema.optional(),
            }),
          )
          .min(1),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, preset, nodes }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.composeNodes(resolvedId, {
          preset,
          nodes,
        });
        return success(
          {
            scene: result.scene,
            nodes: result.nodes,
            changedElementIds: result.changedElementIds,
          },
          `Composed ${result.nodes.length} semantic nodes in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "layout_flow",
    {
      description:
        "Lay out elements as a horizontal or vertical process flow, optionally styling and connecting them. Best for sequential stages or pipelines.",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        elementIds: z.array(z.string().min(1)).min(1),
        direction: z.enum(["horizontal", "vertical"]).optional(),
        gap: z.number().optional(),
        connect: z.boolean().optional(),
        connectorType: z.enum(["arrow", "line"]).optional(),
        preset: stylePresetSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async (
      { sceneId, elementIds, direction, gap, connect, connectorType, preset },
      extra,
    ) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.layoutFlow(resolvedId, {
          elementIds,
          direction,
          gap,
          connect,
          connectorType,
          preset,
        });
        return success(
          { scene: result.scene, changedElementIds: result.changedElementIds },
          `Laid out ${elementIds.length} elements as a flow in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "layout_swimlanes",
    {
      description:
        "Preferred swimlane authoring tool. Create or update swimlane frames with headers, assign elements, and run deterministic lane-local layout for owners, stages, or departments.",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        laneArrangement: z.enum(["columns", "rows"]),
        originX: z.number(),
        originY: z.number(),
        laneWidth: z.number(),
        laneHeight: z.number(),
        gap: z.number().optional(),
        flowDirection: z.enum(["horizontal", "vertical"]).optional(),
        lanes: z
          .array(
            z.object({
              laneId: z.string().min(1).optional(),
              label: z.string().min(1),
              elementIds: z.array(z.string().min(1)).optional(),
            }),
          )
          .min(1),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async (
      {
        sceneId,
        laneArrangement,
        originX,
        originY,
        laneWidth,
        laneHeight,
        gap,
        flowDirection,
        lanes,
      },
      extra,
    ) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.layoutSwimlanes(resolvedId, {
          laneArrangement,
          originX,
          originY,
          laneWidth,
          laneHeight,
          gap,
          flowDirection,
          lanes,
        });
        return success(
          {
            scene: result.scene,
            laneFrameIds: result.laneFrameIds,
            laneHeaderIds: result.laneHeaderIds,
            changedElementIds: result.changedElementIds,
          },
          `Laid out ${result.laneFrameIds.length} swimlanes in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "layout_polish",
    {
      description:
        "Apply deterministic safe cleanup for overlap, spacing, connector labels, and supporting text placement. Run after scene_analyze and before scene_validate.",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        issueCodes: z.array(z.string().min(1)).optional(),
        elementIds: z.array(z.string().min(1)).optional(),
        mode: z.enum(["safe"]).optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, issueCodes, elementIds, mode }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.layoutPolish(resolvedId, {
          issueCodes,
          elementIds,
          mode,
        });
        return success(
          {
            scene: result.scene,
            appliedActions: result.appliedActions,
            changedElementIds: result.changedElementIds,
          },
          `Applied ${result.appliedActions.length} deterministic polish actions in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "connectors_create",
    {
      description:
        "Create a connector between two existing elements with optional label text. Prefer this over manual arrow construction so bindings and label placement stay Excalidraw-aware.",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        sourceElementId: z.string().min(1),
        targetElementId: z.string().min(1),
        label: z.string().optional(),
        connectorType: z.enum(["arrow", "line"]).optional(),
        endArrowhead: z
          .enum(["arrow", "triangle", "bar", "dot"])
          .nullable()
          .optional(),
        strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
        strokeColor: z.string().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async (
      {
        sceneId,
        sourceElementId,
        targetElementId,
        label,
        connectorType,
        endArrowhead,
        strokeStyle,
        strokeColor,
      },
      extra,
    ) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.createConnector(resolvedId, {
          sourceElementId,
          targetElementId,
          label,
          connectorType,
          endArrowhead,
          strokeStyle,
          strokeColor,
        });
        return success(
          {
            scene: result.scene,
            connectorId: result.connectorId,
            labelId: result.labelId,
          },
          `Created connector ${result.connectorId} in ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "appstate_get",
    {
      description: "Get current app state for a scene",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const appState = await sceneService.getAppState(resolvedId);
        return success({ appState }, `Loaded appState for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "appstate_patch",
    {
      description: "Patch app state values",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        appState: z.record(z.string(), z.unknown()),
        merge: z.boolean().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, appState, merge }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const nextAppState = await sceneService.patchAppState(
          resolvedId,
          appState,
          merge ?? true,
        );
        return success(
          { appState: nextAppState },
          `Patched appState for ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "files_attach",
    {
      description: "Attach binary file into scene files map",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        fileId: z.string().optional(),
        mimeType: z.string().min(1),
        base64: z.string().min(1),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, fileId, mimeType, base64 }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.attachFile(resolvedId, {
          fileId,
          mimeType,
          base64,
        });
        return success(
          result as any,
          `Attached file ${result.fileId} to ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "files_detach",
    {
      description: "Detach file by id",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        fileId: z.string().min(1),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, fileId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.detachFile(resolvedId, fileId);
        return success(
          { fileId, ...result },
          `Detached file ${fileId} from ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "library_get",
    {
      description: "Get scene library items",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const libraryItems = await sceneService.getLibrary(resolvedId);
        return success(
          { libraryItems, count: libraryItems.length },
          `Loaded library for ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "library_update",
    {
      description: "Replace or merge scene library items",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        libraryItems: z.array(z.record(z.string(), z.unknown())),
        merge: z.boolean().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, libraryItems, merge }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const updated = await sceneService.updateLibrary(
          resolvedId,
          libraryItems,
          merge ?? true,
        );
        return success(
          { libraryItems: updated, count: updated.length },
          `Updated library for ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "library_import_json",
    {
      description: "Import Excalidraw library JSON into a scene library",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        payload: z.union([
          z.record(z.string(), z.unknown()),
          z.array(z.record(z.string(), z.unknown())),
        ]),
        merge: z.boolean().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, payload, merge }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const updated = await sceneService.importLibraryFromJson({
          sceneId: resolvedId,
          payload,
          merge,
        });
        return success(
          { libraryItems: updated, count: updated.length },
          `Imported library JSON into ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "diagram_from_mermaid",
    {
      description: "Convert Mermaid definition into Excalidraw elements",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        definition: z.string().min(1),
        merge: z.boolean().optional(),
        name: z.string().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId, definition, merge, name }) => {
      try {
        const result = await sceneService.diagramFromMermaid({
          sceneId,
          definition,
          merge,
          name,
        });
        return success(
          {
            scene: result.scene,
            createdScene: result.createdScene,
          },
          `${result.createdScene ? "Created" : "Updated"} scene ${result.scene.metadata.sceneId} from Mermaid`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "view_fit_to_content",
    {
      description: "Adjust scene viewport appState to fit visible content",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const scene = await sceneService.fitToContent(resolvedId);
        return success(
          { appState: scene.appState, scene },
          `Fitted view for ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "view_scroll_to_content",
    {
      description: "Scroll viewport to content center",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await sceneService.scrollToContent(resolvedId);
        return success(
          result as any,
          `Scrolled view to content for ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "export_svg",
    {
      description: "Export scene to SVG",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        options: exportOptionsSchema.partial().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ sceneId, options }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await exportService.export(resolvedId, {
          format: "svg",
          ...options,
        } as any);
        return success(result as any, `Exported SVG for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "export_png",
    {
      description: "Export scene to PNG",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        options: exportOptionsSchema.partial().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ sceneId, options }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await exportService.export(resolvedId, {
          format: "png",
          ...options,
        } as any);
        return success(result as any, `Exported PNG for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "export_webp",
    {
      description: "Export scene to WEBP",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        options: exportOptionsSchema.partial().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ sceneId, options }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await exportService.export(resolvedId, {
          format: "webp",
          ...options,
        } as any);
        return success(result as any, `Exported WEBP for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "export_json",
    {
      description: "Export scene to Excalidraw JSON",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        options: exportOptionsSchema.partial().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ sceneId, options }, extra) => {
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const result = await exportService.export(resolvedId, {
          format: "json",
          ...options,
        } as any);
        return success(result as any, `Exported JSON for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "account_login_session",
    {
      description:
        "Open destination in a persistent browser profile and wait until authenticated Excalidraw canvas is ready",
      inputSchema: {
        destination: z.enum(["plus", "excalidraw"]).optional(),
        mode: z.enum(["headed", "headless"]).optional(),
        session: z.string().min(1).max(120).optional(),
        timeoutSec: z.number().int().min(10).max(1800).optional(),
        closeOnComplete: z.boolean().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async ({ destination, mode, session, timeoutSec, closeOnComplete }) => {
      try {
        const result = await accountImporter.loginSession({
          destination,
          mode,
          session,
          timeoutSec,
          closeOnComplete,
        });

        return success(
          { login: result },
          `Account login session ${result.status} (${result.destination}, session=${result.session})`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "account_import_scene",
    {
      description:
        "Import an MCP scene into authenticated Excalidraw/Excalidraw+ account via browser UI session",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        destination: z.enum(["plus", "excalidraw"]).optional(),
        mode: z.enum(["headed", "headless"]).optional(),
        session: z.string().min(1).max(120).optional(),
        timeoutSec: z.number().int().min(10).max(1800).optional(),
        allowInteractiveLogin: z.boolean().optional(),
        closeOnComplete: z.boolean().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async (
      {
        sceneId,
        destination,
        mode,
        session,
        timeoutSec,
        allowInteractiveLogin,
        closeOnComplete,
      },
      extra,
    ) => {
      let tempDir: string | null = null;
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const staged = await stageSceneImportFile(sceneService, resolvedId);
        tempDir = staged.tempDir;

        const result = await accountImporter.importToAccount({
          inputPath: staged.inputPath,
          destination,
          kind: "scene",
          mode,
          session,
          timeoutSec,
          allowInteractiveLogin,
          closeOnComplete,
        });

        return success(
          {
            sceneId: resolvedId,
            import: result,
          },
          `Account import ${result.status} for scene ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      } finally {
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
      }
    },
  );

  server.registerTool(
    "account_import_library",
    {
      description:
        "Import library items from a scene into authenticated Excalidraw/Excalidraw+ account via browser UI session",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        destination: z.enum(["plus", "excalidraw"]).optional(),
        mode: z.enum(["headed", "headless"]).optional(),
        session: z.string().min(1).max(120).optional(),
        timeoutSec: z.number().int().min(10).max(1800).optional(),
        allowInteractiveLogin: z.boolean().optional(),
        closeOnComplete: z.boolean().optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async (
      {
        sceneId,
        destination,
        mode,
        session,
        timeoutSec,
        allowInteractiveLogin,
        closeOnComplete,
      },
      extra,
    ) => {
      let tempDir: string | null = null;
      try {
        const resolvedId = await resolveSceneId(
          sceneService,
          getSessionId(extra),
          sceneId,
        );
        const staged = await stageLibraryImportFile(sceneService, resolvedId);
        tempDir = staged.tempDir;

        const result = await accountImporter.importToAccount({
          inputPath: staged.inputPath,
          destination,
          kind: "library",
          mode,
          session,
          timeoutSec,
          allowInteractiveLogin,
          closeOnComplete,
        });

        return success(
          {
            sceneId: resolvedId,
            import: result,
          },
          `Account import ${result.status} for library from scene ${resolvedId}`,
        );
      } catch (error) {
        return failure(error);
      } finally {
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
      }
    },
  );

  server.registerTool(
    "account_link_status",
    {
      description:
        "Inspect account-link session status and recent import history",
      inputSchema: {
        session: z.string().min(1).max(120).optional(),
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ session }) => {
      try {
        const status = await accountImporter.getLinkStatus(session);
        return success(status as any, "Loaded account link status");
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "session_reset",
    {
      description: "Reset session-local active scene context",
      inputSchema: {},
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations,
    },
    async (_args, extra) => {
      try {
        const result = await sceneService.resetSession(getSessionId(extra));
        return success(result as any, "Reset session context");
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "health_ping",
    {
      description: "Health ping with browser engine status",
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => {
      try {
        const health = await sceneService.health();
        return success(health as any, "Server is healthy");
      } catch (error) {
        return failure(error);
      }
    },
  );
}
