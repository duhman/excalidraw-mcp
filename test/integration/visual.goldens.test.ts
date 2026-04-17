import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createExcalidrawMcpServer,
  type ExcalidrawMcpServices,
} from "../../src/server/createServer.js";
import {
  canonicalizeSvg,
  fixtureGoldenSlug,
  visualFixtures,
} from "./visualFixtures.js";

const workspaceRoot = process.cwd();
const goldensDir = join(workspaceRoot, "test", "fixtures", "visual-goldens");
const mismatchDir = join(workspaceRoot, "tmp", "visual-golden-mismatches");

describe("Visual SVG goldens", () => {
  let rootDir: string;
  let services: ExcalidrawMcpServices;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-visual-golden-"));
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
    "matches the committed %s SVG golden after canonicalization",
    async (fixture) => {
      await fixture.build(services);

      const exported = await services.exportService.export(fixture.sceneId, {
        format: "svg",
        padding: 24,
        scale: 1.5,
      });

      const canonical = canonicalizeSvg(
        Buffer.from(exported.base64, "base64").toString("utf8"),
      );
      const goldenPath = join(
        goldensDir,
        `${fixtureGoldenSlug(fixture.name)}.svg`,
      );

      if (process.env.UPDATE_GOLDENS === "1") {
        await mkdir(goldensDir, { recursive: true });
        await writeFile(goldenPath, canonical, "utf8");
        expect(canonical).toContain("<svg");
        return;
      }

      const expected = await readFile(goldenPath, "utf8").catch(() => null);
      if (!expected) {
        throw new Error(
          `Missing golden ${goldenPath}. Run UPDATE_GOLDENS=1 npx vitest run test/integration/visual.goldens.test.ts to refresh.`,
        );
      }

      if (canonical !== expected) {
        await mkdir(mismatchDir, { recursive: true });
        await writeFile(
          join(mismatchDir, `${fixtureGoldenSlug(fixture.name)}.actual.svg`),
          canonical,
          "utf8",
        );
      }

      expect(canonical).toBe(expected);
    },
    60_000,
  );
});
