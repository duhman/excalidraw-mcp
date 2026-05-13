import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createExcalidrawMcpServer } from "../../src/server/createServer.js";
import type {
  ExcalidrawPlusCreateSceneRequest,
  ExcalidrawPlusPatchSceneContentRequest,
  ExcalidrawPlusReplaceSceneContentRequest,
  ExcalidrawPlusSceneContent,
  ExcalidrawPlusSceneProvider,
} from "../../src/official/excalidrawPlusApiClient.js";

const plusContent: ExcalidrawPlusSceneContent = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  appState: { viewBackgroundColor: "#ffffff" },
  elements: [{ id: "remote-box", type: "rectangle", version: 1 }],
  sceneVersion: "remote-v1",
  files: {},
};

class FakePlusProvider implements ExcalidrawPlusSceneProvider {
  public readonly created: ExcalidrawPlusCreateSceneRequest[] = [];
  public readonly patches: Array<{ sceneId: string; patch: ExcalidrawPlusPatchSceneContentRequest }> = [];
  public readonly replacements: Array<{ sceneId: string; content: ExcalidrawPlusReplaceSceneContentRequest }> = [];

  isConfigured(): boolean {
    return true;
  }

  status() {
    return { configured: true, baseUrl: "https://plus.example.test/api/v1" };
  }

  async listScenes() {
    return {
      limit: 25,
      offset: 0,
      hasNextPage: false,
      data: [{ metadata: { id: "remote-scene", name: "Remote Scene" } }],
    };
  }

  async createScene(request: ExcalidrawPlusCreateSceneRequest) {
    this.created.push(request);
    return { metadata: { id: "created-scene", ...request } };
  }

  async getSceneContent(sceneId: string) {
    return { ...plusContent, sceneId };
  }

  async replaceSceneContent(sceneId: string, content: ExcalidrawPlusReplaceSceneContentRequest) {
    this.replacements.push({ sceneId, content });
    return { ...plusContent, ...content, sceneVersion: "remote-v2" };
  }

  async patchSceneContent(sceneId: string, patch: ExcalidrawPlusPatchSceneContentRequest) {
    this.patches.push({ sceneId, patch });
    return { ...plusContent, ...patch, sceneVersion: "remote-v2" };
  }
}

function dataOf(result: Awaited<ReturnType<Client["callTool"]>>) {
  expect(result.isError).toBeFalsy();
  return (result as any).structuredContent?.data as Record<string, any>;
}

describe("Excalidraw+ MCP tool adapter", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "excalidraw-plus-tools-it-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("exposes Plus status/list/content tools and gated mutation tools", async () => {
    const plusProvider = new FakePlusProvider();
    const services = await createExcalidrawMcpServer({
      workspaceRoot: rootDir,
      version: "test",
      plusProvider,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "plus-test-client", version: "1.0.0" });

    try {
      await services.server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      for (const name of [
        "plus_api_status",
        "plus_scenes_list",
        "plus_scene_content_get",
        "plus_scene_create",
        "plus_scene_content_patch",
        "plus_scene_content_replace",
      ]) {
        expect(tools.tools.some((tool) => tool.name === name)).toBe(true);
      }
      expect(tools.tools.find((tool) => tool.name === "plus_scene_content_replace")?.annotations?.destructiveHint).toBe(true);

      const status = dataOf(await client.callTool({ name: "plus_api_status", arguments: {} }));
      expect(status.status).toEqual({ configured: true, baseUrl: "https://plus.example.test/api/v1" });
      expect(status.sourceProvider).toBe("excalidraw-plus");

      const listed = dataOf(await client.callTool({ name: "plus_scenes_list", arguments: { limit: 25 } }));
      expect(listed.scenes.data[0].metadata.name).toBe("Remote Scene");

      const content = dataOf(await client.callTool({ name: "plus_scene_content_get", arguments: { sceneId: "remote-scene" } }));
      expect(content.sourceProvider).toBe("excalidraw-plus");
      expect(content.content.sceneVersion).toBe("remote-v1");

      const created = dataOf(
        await client.callTool({
          name: "plus_scene_create",
          arguments: { name: "New Remote", pinned: false, collectionId: "collection-1" },
        }),
      );
      expect(created.scene.metadata.name).toBe("New Remote");
      expect(plusProvider.created).toEqual([{ name: "New Remote", pinned: false, collectionId: "collection-1" }]);

      const patched = dataOf(
        await client.callTool({
          name: "plus_scene_content_patch",
          arguments: { sceneId: "remote-scene", appState: { theme: "dark" } },
        }),
      );
      expect(patched.content.sceneVersion).toBe("remote-v2");
      expect(plusProvider.patches).toEqual([{ sceneId: "remote-scene", patch: { appState: { theme: "dark" } } }]);

      const replaced = dataOf(
        await client.callTool({
          name: "plus_scene_content_replace",
          arguments: {
            sceneId: "remote-scene",
            content: {
              type: "excalidraw",
              version: 2,
              source: "agent",
              appState: {},
              elements: [],
              files: {},
            },
          },
        }),
      );
      expect(replaced.content.sceneVersion).toBe("remote-v2");
      expect(plusProvider.replacements[0].sceneId).toBe("remote-scene");
    } finally {
      await client.close().catch(() => undefined);
      await serverTransport.close().catch(() => undefined);
      await clientTransport.close().catch(() => undefined);
    }
  });
});
