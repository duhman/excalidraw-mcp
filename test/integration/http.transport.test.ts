import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpTransport } from "../../src/transports/http.js";

describe("HTTP transport integration", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-http-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("supports streamable HTTP initialize + tool calls", async () => {
    const httpServer = await startHttpTransport({
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      workspaceRoot: rootDir,
      allowedHosts: ["127.0.0.1", "localhost"]
    });

    const address = httpServer.address() as AddressInfo;
    const baseUrl = new URL(`http://127.0.0.1:${address.port}/mcp`);

    const transport = new StreamableHTTPClientTransport(baseUrl);
    const client = new Client({
      name: "http-test-client",
      version: "1.0.0"
    });

    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "health.ping")).toBe(true);

    const created = await client.callTool({
      name: "scene.create",
      arguments: {
        sceneId: "http-scene"
      }
    });
    expect(created.isError).toBeFalsy();

    const health = await client.callTool({
      name: "health.ping",
      arguments: {}
    });
    expect(health.isError).toBeFalsy();

    await transport.terminateSession();
    await client.close();

    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
});
