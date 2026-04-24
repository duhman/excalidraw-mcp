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
      version: "test",
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    const client = new Client({
      name: "test-client",
      version: "1.0.0",
    });

    await services.server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "scene_create")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "scene_import_json")).toBe(
      true,
    );
    expect(tools.tools.some((tool) => tool.name === "scene_analyze")).toBe(
      true,
    );
    expect(tools.tools.some((tool) => tool.name === "scene_quality_gate")).toBe(
      true,
    );
    expect(
      tools.tools.some((tool) => tool.name === "elements_create_skeletons"),
    ).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "elements_arrange")).toBe(
      true,
    );
    expect(tools.tools.some((tool) => tool.name === "connectors_create")).toBe(
      true,
    );
    expect(tools.tools.some((tool) => tool.name === "frames_create")).toBe(
      true,
    );
    expect(
      tools.tools.some((tool) => tool.name === "frames_assign_elements"),
    ).toBe(true);
    expect(
      tools.tools.some((tool) => tool.name === "styles_apply_preset"),
    ).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "layers_reorder")).toBe(
      true,
    );
    expect(tools.tools.some((tool) => tool.name === "diagram_compose")).toBe(
      true,
    );
    expect(tools.tools.some((tool) => tool.name === "nodes_create")).toBe(
      true,
    );
    expect(tools.tools.some((tool) => tool.name === "nodes_compose")).toBe(
      true,
    );
    expect(tools.tools.some((tool) => tool.name === "layout_flow")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "layout_swimlanes")).toBe(
      true,
    );
    expect(tools.tools.some((tool) => tool.name === "layout_polish")).toBe(
      true,
    );
    expect(tools.tools.some((tool) => tool.name === "export_json")).toBe(true);
    expect(
      tools.tools.some((tool) => tool.name === "account_login_session"),
    ).toBe(true);
    expect(
      tools.tools.some((tool) => tool.name === "account_import_scene"),
    ).toBe(true);
    expect(
      tools.tools.some((tool) => tool.name === "account_link_status"),
    ).toBe(true);

    const created = await client.callTool({
      name: "scene_create",
      arguments: {
        sceneId: "it-scene",
        name: "Integration Scene",
      },
    });
    expect(created.isError).toBeFalsy();
    expect(((created as any).content[0] as any).text).toContain('"ok": true');

    const imported = await client.callTool({
      name: "scene_import_json",
      arguments: {
        sceneId: "it-imported",
        payload: {
          type: "excalidraw",
          version: 2,
          source: "https://excalidraw.com",
          elements: [
            {
              id: "imported-node",
              type: "rectangle",
              x: 10,
              y: 20,
              width: 140,
              height: 60,
            },
          ],
          appState: { viewBackgroundColor: "#ffffff" },
          files: {},
          libraryItems: [],
        },
      },
    });
    expect(imported.isError).toBeFalsy();

    const opened = await client.callTool({
      name: "scene_open",
      arguments: {
        sceneId: "it-scene",
      },
    });
    expect(opened.isError).toBeFalsy();

    const elementsCreated = await client.callTool({
      name: "elements_create",
      arguments: {
        elements: [
          { id: "left", type: "ellipse", x: 50, y: 50, width: 80, height: 80 },
          {
            id: "right",
            type: "rectangle",
            x: 260,
            y: 220,
            width: 120,
            height: 80,
          },
        ],
      },
    });
    expect(elementsCreated.isError).toBeFalsy();

    const skeletonsCreated = await client.callTool({
      name: "elements_create_skeletons",
      arguments: {
        skeletons: [
          {
            id: "freehand-note",
            type: "freedraw",
            x: 420,
            y: 80,
            width: 80,
            height: 40,
            points: [[0, 0], [20, 12], [80, 40]],
            pressures: [0.3, 0.6, 0.7],
            simulatePressure: true,
          },
        ],
      },
    });
    expect(skeletonsCreated.isError).toBeFalsy();

    const arranged = await client.callTool({
      name: "elements_arrange",
      arguments: {
        elementIds: ["left", "right"],
        mode: "stack",
        axis: "y",
        gap: 24,
        anchor: "center",
      },
    });
    expect(arranged.isError).toBeFalsy();

    const frameCreated = await client.callTool({
      name: "frames_create",
      arguments: {
        name: "Main Flow",
        x: 20,
        y: 20,
        width: 460,
        height: 320,
        elementIds: ["left", "right"],
      },
    });
    expect(frameCreated.isError).toBeFalsy();
    const frameId = (frameCreated as any).structuredContent?.data?.frameId;
    expect(frameId).toBeTruthy();

    const assignedToFrame = await client.callTool({
      name: "frames_assign_elements",
      arguments: {
        frameId,
        elementIds: ["left", "right"],
      },
    });
    expect(assignedToFrame.isError).toBeFalsy();

    const styled = await client.callTool({
      name: "styles_apply_preset",
      arguments: {
        elementIds: ["left", "right"],
        preset: "process",
      },
    });
    expect(styled.isError).toBeFalsy();

    const connected = await client.callTool({
      name: "connectors_create",
      arguments: {
        sourceElementId: "left",
        targetElementId: "right",
        label: "flows",
        startArrowhead: "circle_outline",
        endArrowhead: "crowfoot_many",
      },
    });
    expect(connected.isError).toBeFalsy();

    const composedDiagram = await client.callTool({
      name: "diagram_compose",
      arguments: {
        sceneId: "it-composed",
        title: "Composed Integration Diagram",
        qualityTarget: 70,
        nodes: [
          { id: "compose-a", title: "A", body: "Input" },
          { id: "compose-b", title: "B", body: "Output" },
        ],
        edges: [{ source: "compose-a", target: "compose-b" }],
        legend: "Legend: arrows show flow",
      },
    });
    expect(composedDiagram.isError).toBeFalsy();
    expect((composedDiagram as any).structuredContent?.data?.qualityGate).toBeTruthy();

    const reopenedAfterCompose = await client.callTool({
      name: "scene_open",
      arguments: {
        sceneId: "it-scene",
      },
    });
    expect(reopenedAfterCompose.isError).toBeFalsy();

    const reordered = await client.callTool({
      name: "layers_reorder",
      arguments: {
        elementIds: ["left"],
        direction: "front",
      },
    });
    expect(reordered.isError).toBeFalsy();

    const nodesCreated = await client.callTool({
      name: "nodes_create",
      arguments: {
        preset: "note",
        nodes: [
          {
            id: "note-1",
            label: "Context",
            body: "Agent-authored note",
            x: 520,
            y: 40,
            width: 180,
            height: 96,
          },
        ],
      },
    });
    expect(nodesCreated.isError).toBeFalsy();

    const semanticNodes = await client.callTool({
      name: "nodes_compose",
      arguments: {
        preset: "process",
        nodes: [
          {
            nodeId: "semantic-node",
            title: "Semantic Node",
            body: "Programmatic authoring with stronger structure",
            iconText: "AI",
            x: 520,
            y: 180,
            width: 220,
            minHeight: 120,
          },
        ],
      },
    });
    expect(semanticNodes.isError).toBeFalsy();

    const flow = await client.callTool({
      name: "layout_flow",
      arguments: {
        elementIds: ["left", "right"],
        direction: "vertical",
        gap: 32,
        connect: false,
      },
    });
    expect(flow.isError).toBeFalsy();

    const swimlanes = await client.callTool({
      name: "layout_swimlanes",
      arguments: {
        laneArrangement: "columns",
        originX: 20,
        originY: 360,
        laneWidth: 280,
        laneHeight: 240,
        lanes: [
          { laneId: "lane-left", label: "Intake", elementIds: ["left"] },
          { laneId: "lane-right", label: "Delivery", elementIds: ["right"] },
        ],
      },
    });
    expect(swimlanes.isError).toBeFalsy();

    const analysis = await client.callTool({
      name: "scene_analyze",
      arguments: {},
    });
    expect(analysis.isError).toBeFalsy();
    expect(
      (analysis as any).structuredContent?.data?.summary?.elementCount,
    ).toBeGreaterThanOrEqual(1);
    expect(
      Array.isArray(
        (analysis as any).structuredContent?.data?.recommendedActions,
      ),
    ).toBe(true);

    const polished = await client.callTool({
      name: "layout_polish",
      arguments: {
        mode: "safe",
      },
    });
    expect(polished.isError).toBeFalsy();

    const qualityGate = await client.callTool({
      name: "scene_quality_gate",
      arguments: {
        minScore: 50,
      },
    });
    expect(qualityGate.isError).toBeFalsy();
    expect((qualityGate as any).structuredContent?.data?.analysis?.score).toBeGreaterThanOrEqual(0);

    const exported = await client.callTool({
      name: "export_json",
      arguments: {},
    });
    expect(exported.isError).toBeFalsy();

    const resource = await client.readResource({
      uri: "excalidraw://scene/it-scene/summary",
    });
    expect(resource.contents.length).toBeGreaterThan(0);

    const analysisResource = await client.readResource({
      uri: "excalidraw://scene/it-scene/analysis",
    });
    expect(analysisResource.contents.length).toBeGreaterThan(0);
    expect((analysisResource.contents[0] as any).text).toContain(
      "recommendedActions",
    );

    const prompt = await client.getPrompt({
      name: "diagram-from-spec",
      arguments: {
        requirements: "Draw service A calling service B",
      },
    });
    expect(prompt.messages.length).toBeGreaterThan(0);

    const linkStatus = await client.callTool({
      name: "account_link_status",
      arguments: {
        session: "integration-session",
      },
    });
    expect(linkStatus.isError).toBeFalsy();

    await client.close();
    await services.browserEngine.close();
    await services.server.close();
  });
});
