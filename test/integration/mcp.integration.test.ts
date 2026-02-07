import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createExcalidrawMcpServer } from "../../src/server/createServer.js";

describe("MCP in-memory integration", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-it-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("exposes tools/resources/prompts and supports basic scene workflow", async () => {
    const services = await createExcalidrawMcpServer({
      workspaceRoot: rootDir,
      version: "test"
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({
      name: "test-client",
      version: "1.0.0"
    });

    await services.server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "scene.create")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "export.json")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "account.login_session")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "account.import_scene")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "account.link_status")).toBe(true);

    const created = await client.callTool({
      name: "scene.create",
      arguments: {
        sceneId: "it-scene",
        name: "Integration Scene"
      }
    });
    expect(created.isError).toBeFalsy();

    const opened = await client.callTool({
      name: "scene.open",
      arguments: {
        sceneId: "it-scene"
      }
    });
    expect(opened.isError).toBeFalsy();

    const elementsCreated = await client.callTool({
      name: "elements.create",
      arguments: {
        elements: [{ type: "ellipse", x: 50, y: 50, width: 80, height: 80 }]
      }
    });
    expect(elementsCreated.isError).toBeFalsy();

    const exported = await client.callTool({
      name: "export.json",
      arguments: {}
    });
    expect(exported.isError).toBeFalsy();

    const resource = await client.readResource({
      uri: "excalidraw://scene/it-scene/summary"
    });
    expect(resource.contents.length).toBeGreaterThan(0);

    const prompt = await client.getPrompt({
      name: "diagram-from-spec",
      arguments: {
        requirements: "Draw service A calling service B"
      }
    });
    expect(prompt.messages.length).toBeGreaterThan(0);

    const linkStatus = await client.callTool({
      name: "account.link_status",
      arguments: {
        session: "integration-session"
      }
    });
    expect(linkStatus.isError).toBeFalsy();

    await client.close();
    await services.browserEngine.close();
    await services.server.close();
  });
});
