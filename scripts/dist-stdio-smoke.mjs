import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const workspaceRoot = await mkdtemp(join(tmpdir(), "excalidraw-mcp-dist-smoke-"));
const serverEntry = resolve("dist/src/index.js");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry, "--transport", "stdio"],
  cwd: resolve("."),
  env: {
    ...process.env,
    MCP_WORKSPACE_ROOT: workspaceRoot,
  },
  stderr: "pipe",
});

const client = new Client({
  name: "dist-smoke-client",
  version: "1.0.0",
});

function unwrap(result, label) {
  if (result?.isError) {
    throw new Error(`${label} failed: ${JSON.stringify(result.structuredContent ?? result)}`);
  }
  return result?.structuredContent?.data ?? {};
}

try {
  await client.connect(transport);

  unwrap(
    await client.callTool({
      name: "scene_create",
      arguments: {
        sceneId: "dist-smoke-scene",
        name: "Dist Smoke",
      },
    }),
    "scene_create",
  );

  unwrap(
    await client.callTool({
      name: "nodes_compose",
      arguments: {
        sceneId: "dist-smoke-scene",
        preset: "process",
        nodes: [
          {
            nodeId: "capture",
            title: "Capture",
            body: "Collect input programmatically",
            x: 80,
            y: 140,
            width: 220,
            minHeight: 120,
          },
          {
            nodeId: "deliver",
            title: "Deliver",
            body: "Export and review output",
            x: 420,
            y: 140,
            width: 220,
            minHeight: 120,
          },
        ],
      },
    }),
    "nodes_compose",
  );

  unwrap(
    await client.callTool({
      name: "layout_swimlanes",
      arguments: {
        sceneId: "dist-smoke-scene",
        laneArrangement: "columns",
        originX: 40,
        originY: 100,
        laneWidth: 320,
        laneHeight: 260,
        lanes: [
          { laneId: "lane-one", label: "Input", elementIds: ["capture"] },
          { laneId: "lane-two", label: "Output", elementIds: ["deliver"] },
        ],
      },
    }),
    "layout_swimlanes",
  );

  const format = unwrap(
    await client.callTool({
      name: "read_excalidraw_format",
      arguments: {},
    }),
    "read_excalidraw_format",
  );
  if (!format.editSemantics?.order?.includes("add")) {
    throw new Error("read_excalidraw_format did not return edit semantics");
  }

  const officialEdit = unwrap(
    await client.callTool({
      name: "edit_scene_content",
      arguments: {
        sceneId: "dist-smoke-scene",
        add: JSON.stringify([
          {
            tempId: "official-frame",
            type: "frame",
            x: 40,
            y: 430,
            width: 640,
            height: 240,
            name: "Official compatibility",
          },
          {
            tempId: "official-card",
            type: "rectangle",
            frameId: "official-frame",
            x: 88,
            y: 500,
            width: 180,
            height: 80,
            label: { text: "Official edit" },
          },
        ]),
      },
    }),
    "edit_scene_content",
  );
  if (!officialEdit.tempIdMap?.["official-card"]) {
    throw new Error("edit_scene_content did not return tempIdMap");
  }

  const officialSearch = unwrap(
    await client.callTool({
      name: "search_scene_content",
      arguments: {
        sceneId: "dist-smoke-scene",
        query: "official_edit",
      },
    }),
    "search_scene_content",
  );
  if (officialSearch.count < 1) {
    throw new Error("search_scene_content did not find official label");
  }

  const officialContent = unwrap(
    await client.callTool({
      name: "get_scene_content",
      arguments: {
        sceneId: "dist-smoke-scene",
      },
    }),
    "get_scene_content",
  );
  if (officialContent.sourceProvider !== "local") {
    throw new Error(`unexpected scene content provider: ${officialContent.sourceProvider}`);
  }

  const analysis = unwrap(
    await client.callTool({
      name: "scene_analyze",
      arguments: {
        sceneId: "dist-smoke-scene",
      },
    }),
    "scene_analyze",
  );
  if (!Array.isArray(analysis.recommendedActions)) {
    throw new Error("scene_analyze did not return recommendedActions");
  }

  const exported = unwrap(
    await client.callTool({
      name: "export_svg",
      arguments: {
        sceneId: "dist-smoke-scene",
        options: {
          scale: 1.5,
          padding: 24,
        },
      },
    }),
    "export_svg",
  );
  if (exported.mimeType !== "image/svg+xml") {
    throw new Error(`Unexpected SVG mime type: ${exported.mimeType}`);
  }

  unwrap(
    await client.callTool({
      name: "account_link_status",
      arguments: {
        session: "dist-smoke",
      },
    }),
    "account_link_status",
  );

  process.stdout.write("dist stdio smoke passed\n");
} finally {
  await client.close().catch(() => undefined);
  await transport.close().catch(() => undefined);
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
}
