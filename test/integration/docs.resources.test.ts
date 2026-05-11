import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createExcalidrawMcpServer } from "../../src/server/createServer.js";

describe("Excalidraw skill docs resources", () => {
  let rootDir: string;
  let client: Client;
  let services: Awaited<ReturnType<typeof createExcalidrawMcpServer>>;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-docs-"));
    services = await createExcalidrawMcpServer({
      workspaceRoot: rootDir,
      version: "test",
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: "docs-test-client", version: "1.0.0" });
    await services.server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("exposes the docs index and known reference topics", async () => {
    const list = await client.listResources();
    const uris = list.resources.map((r) => r.uri);

    expect(uris).toContain("excalidraw://docs");
    expect(uris).toContain("excalidraw://docs/excalidraw-account-linking");
    expect(uris).toContain("excalidraw://docs/excalidraw-troubleshooting");
    expect(uris).toContain("excalidraw://docs/excalidraw-mermaid-conversion");
    expect(uris).toContain(
      "excalidraw://docs/excalidraw-install-and-integration",
    );
    expect(uris).toContain("excalidraw://docs/excalidraw-props-and-api");
  });

  it("reads the docs index as JSON with topic metadata", async () => {
    const result = await client.readResource({ uri: "excalidraw://docs" });
    expect(result.contents.length).toBe(1);

    const content = result.contents[0];
    expect(content.mimeType).toBe("application/json");
    if (!("text" in content)) throw new Error("expected text content");

    const payload = JSON.parse(content.text);
    expect(payload.count).toBeGreaterThan(0);
    expect(Array.isArray(payload.topics)).toBe(true);

    const troubleshooting = payload.topics.find(
      (topic: { topic: string }) =>
        topic.topic === "excalidraw-troubleshooting",
    );
    expect(troubleshooting).toBeDefined();
    expect(troubleshooting.uri).toBe(
      "excalidraw://docs/excalidraw-troubleshooting",
    );
    expect(typeof troubleshooting.title).toBe("string");
    expect(troubleshooting.title.length).toBeGreaterThan(0);
  });

  it("reads an individual docs topic as markdown content", async () => {
    const result = await client.readResource({
      uri: "excalidraw://docs/excalidraw-troubleshooting",
    });

    expect(result.contents.length).toBe(1);
    const content = result.contents[0];

    expect(content.mimeType).toBe("text/markdown");
    if (!("text" in content)) throw new Error("expected text content");
    expect(typeof content.text).toBe("string");
    expect(content.text).toMatch(/excalidraw/i);
  });

  it("reads the install-and-integration reference", async () => {
    const result = await client.readResource({
      uri: "excalidraw://docs/excalidraw-install-and-integration",
    });

    const content = result.contents[0];
    if (!("text" in content)) throw new Error("expected text content");
    expect(content.text).toMatch(/@excalidraw\/excalidraw/);
  });
});
