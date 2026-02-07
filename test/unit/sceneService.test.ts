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

  it("auto-fixes connector bindings and detects text overflow quality warnings", async () => {
    await service.createScene({ sceneId: "quality-scene" });

    const patch = await service.patchScene("quality-scene", [
      {
        op: "addElements",
        elements: [
          { id: "n1", type: "rectangle", x: 0, y: 0, width: 180, height: 80 },
          { id: "n2", type: "rectangle", x: 340, y: 0, width: 180, height: 80 },
          {
            id: "t1",
            type: "text",
            containerId: "n1",
            x: 10,
            y: 20,
            width: 500,
            height: 24,
            fontSize: 20,
            lineHeight: 1.2,
            text: "This is a very long label that should wrap inside the container"
          },
          {
            id: "c1",
            type: "arrow",
            x: 80,
            y: 40,
            points: [
              [0, 0],
              [320, 0]
            ],
            customData: { fromId: "n1", toId: "n2" }
          }
        ]
      }
    ] as any);

    const connector = patch.scene.elements.find((element: any) => element.id === "c1");
    expect(connector?.startBinding?.elementId).toBe("n1");
    expect(connector?.endBinding?.elementId).toBe("n2");

    const wrappedText = patch.scene.elements.find((element: any) => element.id === "t1");
    expect(String(wrappedText?.text ?? "")).toContain("\n");

    const validation = await service.validateScene("quality-scene");
    expect(validation.valid).toBe(true);
    expect(validation.qualityIssues.some((issue) => issue.code === "TEXT_OVERFLOW")).toBe(false);
  });
});
