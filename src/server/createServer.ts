import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrowserEngine } from "../engines/browserEngine.js";
import { JsonEngine } from "../engines/jsonEngine.js";
import { SceneStore } from "../domain/sceneStore.js";
import { SceneService } from "../domain/sceneService.js";
import { ExportService } from "../export/exportService.js";
import { AccountImporter } from "../account/accountImporter.js";
import { registerTools } from "./registerTools.js";
import { registerResources } from "./registerResources.js";
import { registerPrompts } from "./registerPrompts.js";

export interface ExcalidrawMcpServices {
  server: McpServer;
  sceneStore: SceneStore;
  sceneService: SceneService;
  browserEngine: BrowserEngine;
  exportService: ExportService;
  accountImporter: AccountImporter;
}

export interface CreateExcalidrawServerOptions {
  workspaceRoot: string;
  version?: string;
  browserMaxConcurrency?: number;
  browserIdleRecycleMs?: number;
}

export async function createExcalidrawMcpServer(
  options: CreateExcalidrawServerOptions
): Promise<ExcalidrawMcpServices> {
  const sceneStore = new SceneStore(join(options.workspaceRoot, ".excalidraw-mcp", "scenes"));
  await sceneStore.init();
  const accountImporter = new AccountImporter(join(options.workspaceRoot, ".excalidraw-mcp", "account"));
  await accountImporter.init();

  const browserEngine = new BrowserEngine({
    maxConcurrency: options.browserMaxConcurrency ?? 2,
    idleRecycleMs: options.browserIdleRecycleMs ?? 90_000
  });

  const jsonEngine = new JsonEngine();
  const sceneService = new SceneService(sceneStore, jsonEngine, browserEngine);
  const exportService = new ExportService(sceneService);

  const server = new McpServer(
    {
      name: "excalidraw-mcp",
      version: options.version ?? "0.1.0"
    },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true, subscribe: false },
        prompts: { listChanged: true }
      },
      instructions:
        "Use tools for mutations/exports, resources for read-only context snapshots, and prompts for diagram workflow templates."
    }
  );

  registerTools(server, sceneService, exportService, accountImporter);
  registerResources(server, sceneService);
  registerPrompts(server);

  return {
    server,
    sceneStore,
    sceneService,
    browserEngine,
    exportService,
    accountImporter
  };
}
