import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createExcalidrawMcpServer,
  type ExcalidrawMcpServices,
} from "../../src/server/createServer.js";
import { visualFixtures } from "./visualFixtures.js";

describe("Visual fixture exports", () => {
  let rootDir: string;
  let services: ExcalidrawMcpServices;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-visual-"));
    services = await createExcalidrawMcpServer({
      workspaceRoot: rootDir,
      version: "test",
      browserIdleRecycleMs: 1_000,
    });
  });

  afterEach(async () => {
    await services.browserEngine.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it.each(visualFixtures)(
    "exports a stable %s fixture with healthy structural quality",
    async (fixture) => {
      await fixture.build(services);

      const analysis = await services.sceneService.analyzeScene(fixture.sceneId);
      expect(analysis.issues.filter((issue) => issue.severity === "error")).toEqual([]);
      expect(analysis.score).toBeGreaterThanOrEqual(fixture.minScore);
      expect(analysis.summary.bounds).not.toBeNull();
      expect(analysis.summary.graph.frameCount).toBe(fixture.expectedFrames);
      expect(analysis.summary.graph.connectorCount).toBe(fixture.expectedConnectors);

      const exported = await services.exportService.export(fixture.sceneId, {
        format: "svg",
        padding: 24,
        scale: 1.5,
      });

      expect(exported.mimeType).toBe("image/svg+xml");
      expect(exported.width).toBeGreaterThan(0);
      expect(exported.height).toBeGreaterThan(0);
      expect(exported.checksum).toMatch(/^[a-f0-9]{64}$/);

      const svgXml = Buffer.from(exported.base64, "base64").toString("utf8");
      expect(svgXml).toContain("<svg");
      for (const label of fixture.expectedLabels) {
        expect(svgXml).toContain(label);
      }
    },
    60_000,
  );
});
