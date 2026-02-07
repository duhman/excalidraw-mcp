import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { SceneStore } from "../../src/domain/sceneStore.js";
import { SceneService } from "../../src/domain/sceneService.js";
import { JsonEngine } from "../../src/engines/jsonEngine.js";

describe("SceneService", () => {
  let rootDir: string;
  let service: SceneService;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-test-"));
    const store = new SceneStore(join(rootDir, "scenes"));
    await store.init();

    const browserEngineStub = {
      exportScene: async () => ({
        mimeType: "image/png",
        base64: Buffer.from("stub").toString("base64"),
        width: 10,
        height: 10
      }),
      health: async () => ({ ready: true, details: "stub" }),
      close: async () => undefined
    } as any;

    service = new SceneService(store, new JsonEngine(), browserEngineStub);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("creates, opens, patches, validates, and saves a scene", async () => {
    const created = await service.createScene({
      sceneId: "unit-scene",
      name: "Unit Scene"
    });

    expect(created.metadata.sceneId).toBe("unit-scene");

    const opened = await service.openScene("unit-scene", "session-1");
    expect(opened.metadata.sceneId).toBe("unit-scene");

    const patch = await service.patchScene("unit-scene", [
      {
        op: "addElements",
        elements: [{ type: "rectangle", x: 20, y: 20, width: 200, height: 100 }]
      }
    ] as any);

    expect(patch.scene.elements.length).toBeGreaterThan(0);

    const validation = await service.validateScene("unit-scene");
    expect(validation.valid).toBe(true);

    const saved = await service.saveScene("unit-scene");
    expect(saved.metadata.updatedAt).toBeTruthy();
  });

  it("attaches and detaches files", async () => {
    await service.createScene({ sceneId: "file-scene" });

    const attached = await service.attachFile("file-scene", {
      mimeType: "image/png",
      base64: Buffer.from("file-content").toString("base64")
    });

    expect(attached.fileId).toBeTruthy();

    const detached = await service.detachFile("file-scene", attached.fileId);
    expect(detached.removed).toBe(true);
  });
});
