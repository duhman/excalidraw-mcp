import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createExcalidrawMcpServer,
  type ExcalidrawMcpServices,
} from "../../src/server/createServer.js";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

function data(result: ToolResult): any {
  expect(result.isError).toBeFalsy();
  return (result as any).structuredContent?.data;
}

async function createClient(rootDir: string): Promise<{
  services: ExcalidrawMcpServices;
  client: Client;
}> {
  const services = await createExcalidrawMcpServer({
    workspaceRoot: rootDir,
    version: "test",
    browserIdleRecycleMs: 1_000,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "agent-release-test-client",
    version: "1.0.0",
  });

  await services.server.connect(serverTransport);
  await client.connect(clientTransport);

  return { services, client };
}

async function closeClient(
  services: ExcalidrawMcpServices,
  client: Client,
): Promise<void> {
  await client.close();
  await services.browserEngine.close();
  await services.server.close();
}

describe("Agent release-quality MCP workflows", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-agent-e2e-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("composes, gates, and exports a polished agent-authored diagram across formats", async () => {
    const { services, client } = await createClient(rootDir);

    try {
      const composed = data(
        await client.callTool({
          name: "diagram_compose",
          arguments: {
            sceneId: "agent-release-flow",
            title: "Agent Release Flow",
            diagramType: "flow",
            stylePreset: "process",
            nodes: [
              {
                id: "intake",
                title: "Intake Request",
                body: "Gather requirements, constraints, target audience, and fidelity expectations without hand-editing fragile Excalidraw internals.",
                iconText: "REQ",
              },
              {
                id: "compose",
                title: "Compose Scene",
                body: "Use semantic nodes, deterministic layout, frames, presets, and connector helpers before direct patches.",
                iconText: "MCP",
              },
              {
                id: "review",
                title: "Review & Repair",
                body: "Run analysis, normalize structure, polish layout, and block release if text, connectors, or spacing are not clean.",
                iconText: "QA",
              },
            ],
            edges: [
              {
                source: "intake",
                target: "compose",
                label: "handoff with detailed context",
              },
              {
                source: "compose",
                target: "review",
                label: "quality review before export",
              },
            ],
            legend: "Legend: arrows show the agent workflow and release gates",
          },
        }),
      );

      expect(composed.qualityGate.passed).toBe(true);
      expect(composed.validation.valid).toBe(true);
      expect(composed.validation.qualityIssues.map((issue: any) => issue.code)).not.toContain(
        "TEXT_OVERFLOW",
      );

      const gate = data(
        await client.callTool({
          name: "scene_quality_gate",
          arguments: {
            sceneId: "agent-release-flow",
            minScore: 90,
          },
        }),
      );
      expect(gate.passed).toBe(true);
      expect(gate.failures).toEqual([]);

      for (const name of ["export_svg", "export_png", "export_webp", "export_json"]) {
        const exported = data(
          await client.callTool({
            name,
            arguments: {
              sceneId: "agent-release-flow",
              options: {
                padding: 24,
                scale: name === "export_json" ? undefined : 1.25,
              },
            },
          }),
        );
        expect(exported.base64).toEqual(expect.any(String));
        expect(exported.checksum).toMatch(/^[a-f0-9]{64}$/);
        if (name === "export_json") {
          expect(exported.width).toBe(0);
          expect(exported.height).toBe(0);
        } else {
          expect(exported.width).toBeGreaterThan(0);
          expect(exported.height).toBeGreaterThan(0);
        }
      }
    } finally {
      await closeClient(services, client);
    }
  }, 60_000);

  it("repairs risky manual agent patches before release gating", async () => {
    const { services, client } = await createClient(rootDir);

    try {
      data(
        await client.callTool({
          name: "scene_create",
          arguments: {
            sceneId: "agent-repair-flow",
            name: "Agent Repair Flow",
          },
        }),
      );

      const patched = data(
        await client.callTool({
          name: "scene_patch",
          arguments: {
            sceneId: "agent-repair-flow",
            operations: [
              {
                op: "addElements",
                elements: [
                  {
                    id: "title",
                    type: "text",
                    x: 40,
                    y: 20,
                    text: "Agent Repair Flow",
                    fontSize: 30,
                    fontFamily: 1,
                  },
                  {
                    id: "left",
                    type: "rectangle",
                    x: 60,
                    y: 130,
                    width: 150,
                    height: 56,
                  },
                  {
                    id: "left-label",
                    type: "text",
                    containerId: "left",
                    x: 190,
                    y: 174,
                    width: 420,
                    height: 18,
                    fontSize: 18,
                    lineHeight: 1.25,
                    text: "This label starts outside its box and must be repaired without clipping",
                  },
                  {
                    id: "middle",
                    type: "rectangle",
                    x: 290,
                    y: 130,
                    width: 150,
                    height: 56,
                  },
                  {
                    id: "middle-label",
                    type: "text",
                    containerId: "middle",
                    x: 296,
                    y: 136,
                    width: 500,
                    height: 18,
                    fontSize: 18,
                    lineHeight: 1.25,
                    text: "A very long middle state label that needs wrapping and vertical expansion",
                  },
                  {
                    id: "right",
                    type: "rectangle",
                    x: 520,
                    y: 130,
                    width: 150,
                    height: 56,
                  },
                  {
                    id: "right-label",
                    type: "text",
                    containerId: "right",
                    x: 528,
                    y: 136,
                    width: 120,
                    height: 18,
                    fontSize: 18,
                    text: "Done",
                  },
                  {
                    id: "manual-a",
                    type: "arrow",
                    x: 140,
                    y: 158,
                    points: [
                      [0, 0],
                      [240, 0],
                    ],
                    customData: { fromId: "left", toId: "middle" },
                  },
                  {
                    id: "manual-a-label",
                    type: "text",
                    containerId: "manual-a",
                    x: 200,
                    y: 130,
                    width: 40,
                    height: 16,
                    fontSize: 16,
                    text: "manual transition label with extra words",
                  },
                  {
                    id: "manual-b",
                    type: "arrow",
                    x: 370,
                    y: 158,
                    points: [
                      [0, 0],
                      [240, 0],
                    ],
                    customData: { fromId: "middle", toId: "right" },
                  },
                  {
                    id: "legend",
                    type: "text",
                    x: 40,
                    y: 300,
                    text: "Legend: arrows show repaired manual agent patches",
                    fontSize: 14,
                    fontFamily: 1,
                  },
                ],
              },
            ],
          },
        }),
      );

      const repairedIds = patched.scene.elements.map((element: any) => element.id);
      expect(repairedIds).toEqual(
        expect.arrayContaining(["left-label", "middle-label", "manual-a-label"]),
      );

      data(
        await client.callTool({
          name: "layout_polish",
          arguments: {
            sceneId: "agent-repair-flow",
            mode: "safe",
          },
        }),
      );

      const validation = data(
        await client.callTool({
          name: "scene_validate",
          arguments: {
            sceneId: "agent-repair-flow",
          },
        }),
      );
      expect(validation.valid).toBe(true);
      expect(validation.qualityIssues.map((issue: any) => issue.code)).not.toContain(
        "TEXT_OVERFLOW",
      );
      expect(validation.qualityIssues.map((issue: any) => issue.code)).not.toContain(
        "CONNECTOR_UNBOUND",
      );

      const gate = data(
        await client.callTool({
          name: "scene_quality_gate",
          arguments: {
            sceneId: "agent-repair-flow",
            minScore: 80,
            requireTitle: true,
            requireLegend: true,
          },
        }),
      );
      expect(gate.passed).toBe(true);

      const svg = data(
        await client.callTool({
          name: "export_svg",
          arguments: {
            sceneId: "agent-repair-flow",
            options: {
              padding: 24,
              scale: 1,
            },
          },
        }),
      );
      const svgXml = Buffer.from(svg.base64, "base64").toString("utf8");
      expect(svgXml).toContain("Agent Repair Flow");
      expect(svgXml).toContain("Legend");
    } finally {
      await closeClient(services, client);
    }
  }, 60_000);
});
