import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SceneService } from "../domain/sceneService.js";
import type { ExportService } from "../export/exportService.js";
import type { AccountImporter } from "../account/accountImporter.js";
import { asAppError } from "../utils/errors.js";
import { exportOptionsSchema, sceneIdSchema, scenePatchOperationSchema } from "../types/contracts.js";

const standardOutputSchema = z.object({
  ok: z.boolean(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional()
    })
    .optional()
});

function success(data: Record<string, unknown>, text: string) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: {
      ok: true,
      data
    }
  };
}

function failure(error: unknown) {
  const appError = asAppError(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${appError.code}: ${appError.message}` }],
    structuredContent: {
      ok: false,
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details
      }
    }
  };
}

function getSessionId(extra: { sessionId?: string }): string {
  return extra.sessionId ?? "stdio-session";
}

async function resolveSceneId(
  sceneService: SceneService,
  sessionId: string,
  sceneIdInput?: string
): Promise<string> {
  if (sceneIdInput) {
    return sceneIdInput;
  }

  const active = await sceneService.getActiveScene(sessionId);
  if (!active) {
    throw new Error("BAD_REQUEST: sceneId is required when no active scene is open in this session");
  }

  return active.metadata.sceneId;
}

async function stageSceneImportFile(sceneService: SceneService, sceneId: string): Promise<{ tempDir: string; inputPath: string }> {
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
        files: scene.files
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    tempDir,
    inputPath
  };
}

async function stageLibraryImportFile(sceneService: SceneService, sceneId: string): Promise<{ tempDir: string; inputPath: string }> {
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
        libraryItems
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    tempDir,
    inputPath
  };
}

export function registerTools(
  server: McpServer,
  sceneService: SceneService,
  exportService: ExportService,
  accountImporter: AccountImporter
): void {
  const readOnlyAnnotations = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };
  const mutatingAnnotations = { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false };

  server.registerTool(
    "scene.create",
    {
      description: "Create a new Excalidraw scene in workspace storage",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        name: z.string().min(1).max(256).optional(),
        elements: z.array(z.record(z.string(), z.unknown())).optional(),
        appState: z.record(z.string(), z.unknown()).optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async (args) => {
      try {
        const scene = await sceneService.createScene(args);
        return success({ scene }, `Created scene ${scene.metadata.sceneId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "scene.open",
    {
      description: "Open a scene for the current MCP session",
      inputSchema: {
        sceneId: sceneIdSchema
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId }, extra) => {
      try {
        const scene = await sceneService.openScene(sceneId, getSessionId(extra));
        return success({ scene }, `Opened scene ${sceneId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "scene.list",
    {
      description: "List all scene metadata in the workspace",
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async () => {
      try {
        const scenes = await sceneService.listScenes();
        return success({ scenes, count: scenes.length }, `Listed ${scenes.length} scenes`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "scene.get",
    {
      description: "Get full scene payload",
      inputSchema: {
        sceneId: sceneIdSchema.optional()
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const scene = await sceneService.getScene(resolvedId);
        return success({ scene }, `Loaded scene ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "scene.save",
    {
      description: "Save current or explicit scene",
      inputSchema: {
        sceneId: sceneIdSchema.optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const scene = await sceneService.saveScene(resolvedId);
        return success({ scene }, `Saved scene ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "scene.close",
    {
      description: "Close scene in active session context",
      inputSchema: {
        sceneId: sceneIdSchema.optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await sceneService.closeScene(resolvedId, getSessionId(extra));
        return success({ sceneId: resolvedId, ...result }, `Closed scene ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "scene.patch",
    {
      description: "Apply ordered deterministic patch operations to a scene",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        operations: z.array(scenePatchOperationSchema).min(1)
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId, operations }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await sceneService.patchScene(resolvedId, operations as any);
        return success(
          {
            scene: result.scene,
            changedElementIds: result.changedElementIds,
            revisionHash: result.scene.metadata.revisionHash
          },
          `Patched scene ${resolvedId}`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "scene.validate",
    {
      description: "Validate scene consistency",
      inputSchema: {
        sceneId: sceneIdSchema.optional()
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const validation = await sceneService.validateScene(resolvedId);
        return success(validation as any, `Validation ${validation.valid ? "passed" : "failed"} for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "scene.normalize",
    {
      description: "Normalize and repair scene data via Excalidraw restore pipeline",
      inputSchema: {
        sceneId: sceneIdSchema.optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const scene = await sceneService.normalizeScene(resolvedId);
        return success({ scene }, `Normalized scene ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "elements.create",
    {
      description: "Create one or more elements in a scene",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        elements: z.array(z.record(z.string(), z.unknown())).min(1)
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId, elements }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await sceneService.patchScene(resolvedId, [{ op: "addElements", elements }] as any);
        return success(
          {
            scene: result.scene,
            changedElementIds: result.changedElementIds
          },
          `Created ${result.changedElementIds.length} elements in ${resolvedId}`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "elements.update",
    {
      description: "Update existing elements by id with partial patches",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        elements: z
          .array(
            z.object({
              id: z.string().min(1),
              patch: z.record(z.string(), z.unknown())
            })
          )
          .min(1)
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId, elements }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await sceneService.patchScene(resolvedId, [{ op: "updateElements", elements }] as any);
        return success(
          {
            scene: result.scene,
            changedElementIds: result.changedElementIds
          },
          `Updated ${result.changedElementIds.length} elements in ${resolvedId}`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "elements.delete",
    {
      description: "Delete elements by id (soft delete by default)",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        elementIds: z.array(z.string().min(1)).min(1),
        hardDelete: z.boolean().optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId, elementIds, hardDelete }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await sceneService.patchScene(resolvedId, [{ op: "deleteElements", elementIds, hardDelete }] as any);
        return success(
          {
            scene: result.scene,
            changedElementIds: result.changedElementIds
          },
          `Deleted ${result.changedElementIds.length} elements in ${resolvedId}`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "elements.list",
    {
      description: "List scene elements with optional filtering",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        includeDeleted: z.boolean().optional(),
        type: z.string().optional(),
        limit: z.number().int().min(1).max(10000).optional()
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ sceneId, includeDeleted, type, limit }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const elements = await sceneService.listElements(resolvedId, {
          includeDeleted,
          type,
          limit
        });
        return success({ elements, count: elements.length }, `Listed ${elements.length} elements from ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "appstate.get",
    {
      description: "Get current app state for a scene",
      inputSchema: {
        sceneId: sceneIdSchema.optional()
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const appState = await sceneService.getAppState(resolvedId);
        return success({ appState }, `Loaded appState for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "appstate.patch",
    {
      description: "Patch app state values",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        appState: z.record(z.string(), z.unknown()),
        merge: z.boolean().optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId, appState, merge }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const nextAppState = await sceneService.patchAppState(resolvedId, appState, merge ?? true);
        return success({ appState: nextAppState }, `Patched appState for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "files.attach",
    {
      description: "Attach binary file into scene files map",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        fileId: z.string().optional(),
        mimeType: z.string().min(1),
        base64: z.string().min(1)
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId, fileId, mimeType, base64 }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await sceneService.attachFile(resolvedId, {
          fileId,
          mimeType,
          base64
        });
        return success(result as any, `Attached file ${result.fileId} to ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "files.detach",
    {
      description: "Detach file by id",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        fileId: z.string().min(1)
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId, fileId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await sceneService.detachFile(resolvedId, fileId);
        return success({ fileId, ...result }, `Detached file ${fileId} from ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "library.get",
    {
      description: "Get scene library items",
      inputSchema: {
        sceneId: sceneIdSchema.optional()
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const libraryItems = await sceneService.getLibrary(resolvedId);
        return success({ libraryItems, count: libraryItems.length }, `Loaded library for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "library.update",
    {
      description: "Replace or merge scene library items",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        libraryItems: z.array(z.record(z.string(), z.unknown())),
        merge: z.boolean().optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId, libraryItems, merge }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const updated = await sceneService.updateLibrary(resolvedId, libraryItems, merge ?? true);
        return success({ libraryItems: updated, count: updated.length }, `Updated library for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "diagram.from_mermaid",
    {
      description: "Convert Mermaid definition into Excalidraw elements",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        definition: z.string().min(1),
        merge: z.boolean().optional(),
        name: z.string().optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId, definition, merge, name }) => {
      try {
        const result = await sceneService.diagramFromMermaid({
          sceneId,
          definition,
          merge,
          name
        });
        return success(
          {
            scene: result.scene,
            createdScene: result.createdScene
          },
          `${result.createdScene ? "Created" : "Updated"} scene ${result.scene.metadata.sceneId} from Mermaid`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "view.fit_to_content",
    {
      description: "Adjust scene viewport appState to fit visible content",
      inputSchema: {
        sceneId: sceneIdSchema.optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const scene = await sceneService.fitToContent(resolvedId);
        return success({ appState: scene.appState, scene }, `Fitted view for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "view.scroll_to_content",
    {
      description: "Scroll viewport to content center",
      inputSchema: {
        sceneId: sceneIdSchema.optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await sceneService.scrollToContent(resolvedId);
        return success(result as any, `Scrolled view to content for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "export.svg",
    {
      description: "Export scene to SVG",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        options: exportOptionsSchema.partial().optional()
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ sceneId, options }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await exportService.export(resolvedId, {
          format: "svg",
          ...options
        } as any);
        return success(result as any, `Exported SVG for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "export.png",
    {
      description: "Export scene to PNG",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        options: exportOptionsSchema.partial().optional()
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ sceneId, options }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await exportService.export(resolvedId, {
          format: "png",
          ...options
        } as any);
        return success(result as any, `Exported PNG for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "export.webp",
    {
      description: "Export scene to WEBP",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        options: exportOptionsSchema.partial().optional()
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ sceneId, options }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await exportService.export(resolvedId, {
          format: "webp",
          ...options
        } as any);
        return success(result as any, `Exported WEBP for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "export.json",
    {
      description: "Export scene to Excalidraw JSON",
      inputSchema: {
        sceneId: sceneIdSchema.optional(),
        options: exportOptionsSchema.partial().optional()
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ sceneId, options }, extra) => {
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
        const result = await exportService.export(resolvedId, {
          format: "json",
          ...options
        } as any);
        return success(result as any, `Exported JSON for ${resolvedId}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "account.login_session",
    {
      description:
        "Open destination in a persistent browser profile and wait until authenticated Excalidraw canvas is ready",
      inputSchema: {
        destination: z.enum(["plus", "excalidraw"]).optional(),
        mode: z.enum(["headed", "headless"]).optional(),
        session: z.string().min(1).max(120).optional(),
        timeoutSec: z.number().int().min(10).max(1800).optional(),
        closeOnComplete: z.boolean().optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ destination, mode, session, timeoutSec, closeOnComplete }) => {
      try {
        const result = await accountImporter.loginSession({
          destination,
          mode,
          session,
          timeoutSec,
          closeOnComplete
        });

        return success(
          { login: result },
          `Account login session ${result.status} (${result.destination}, session=${result.session})`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "account.import_scene",
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
        closeOnComplete: z.boolean().optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId, destination, mode, session, timeoutSec, allowInteractiveLogin, closeOnComplete }, extra) => {
      let tempDir: string | null = null;
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
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
          closeOnComplete
        });

        return success(
          {
            sceneId: resolvedId,
            import: result
          },
          `Account import ${result.status} for scene ${resolvedId}`
        );
      } catch (error) {
        return failure(error);
      } finally {
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }
  );

  server.registerTool(
    "account.import_library",
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
        closeOnComplete: z.boolean().optional()
      },
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async ({ sceneId, destination, mode, session, timeoutSec, allowInteractiveLogin, closeOnComplete }, extra) => {
      let tempDir: string | null = null;
      try {
        const resolvedId = await resolveSceneId(sceneService, getSessionId(extra), sceneId);
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
          closeOnComplete
        });

        return success(
          {
            sceneId: resolvedId,
            import: result
          },
          `Account import ${result.status} for library from scene ${resolvedId}`
        );
      } catch (error) {
        return failure(error);
      } finally {
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }
  );

  server.registerTool(
    "account.link_status",
    {
      description: "Inspect account-link session status and recent import history",
      inputSchema: {
        session: z.string().min(1).max(120).optional()
      },
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async ({ session }) => {
      try {
        const status = await accountImporter.getLinkStatus(session);
        return success(status as any, "Loaded account link status");
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "session.reset",
    {
      description: "Reset session-local active scene context",
      inputSchema: {},
      outputSchema: standardOutputSchema,
      annotations: mutatingAnnotations
    },
    async (_args, extra) => {
      try {
        const result = await sceneService.resetSession(getSessionId(extra));
        return success(result as any, "Reset session context");
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "health.ping",
    {
      description: "Health ping with browser engine status",
      outputSchema: standardOutputSchema,
      annotations: readOnlyAnnotations
    },
    async () => {
      try {
        const health = await sceneService.health();
        return success(health as any, "Server is healthy");
      } catch (error) {
        return failure(error);
      }
    }
  );
}
