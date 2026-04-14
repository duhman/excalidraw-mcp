import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SceneStore } from "../../src/domain/sceneStore.js";
import { SceneService } from "../../src/domain/sceneService.js";
import { JsonEngine } from "../../src/engines/jsonEngine.js";

describe("SceneService advanced authoring", () => {
  let rootDir: string;
  let service: SceneService;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-authoring-"));
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

  it("imports full Excalidraw scene payload into a new managed scene", async () => {
    const imported = await service.importSceneFromJson({
      sceneId: "imported-scene",
      payload: {
        type: "excalidraw",
        version: 2,
        source: "https://excalidraw.com",
        elements: [
          { id: "r1", type: "rectangle", x: 10, y: 20, width: 180, height: 100 },
          { id: "t1", type: "text", x: 30, y: 50, width: 80, height: 24, text: "Hello" }
        ],
        appState: { viewBackgroundColor: "#ffffff", scrollX: 15 },
        files: {
          file1: {
            id: "file1",
            mimeType: "image/png",
            dataURL: `data:image/png;base64,${Buffer.from("img").toString("base64")}`
          }
        },
        libraryItems: [{ id: "lib1", status: "published", elements: [] }]
      }
    });

    expect(imported.createdScene).toBe(true);
    expect(imported.scene.metadata.sceneId).toBe("imported-scene");
    expect(imported.scene.elements).toHaveLength(2);
    expect(imported.scene.libraryItems).toHaveLength(1);
    expect(Object.keys(imported.scene.files)).toEqual(["file1"]);
  });

  it("arranges elements into a vertical stack with deterministic spacing", async () => {
    await service.createScene({
      sceneId: "arrange-scene",
      elements: [
        { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 40 },
        { id: "b", type: "rectangle", x: 200, y: 120, width: 100, height: 40 },
        { id: "c", type: "rectangle", x: 400, y: 240, width: 100, height: 40 }
      ]
    });

    const arranged = await service.arrangeElements("arrange-scene", {
      elementIds: ["a", "b", "c"],
      mode: "stack",
      axis: "y",
      gap: 30,
      anchor: "min"
    });

    const elements = Object.fromEntries(arranged.scene.elements.map((element: any) => [element.id, element]));
    expect(elements.a.y).toBe(0);
    expect(elements.b.y).toBe(70);
    expect(elements.c.y).toBe(140);
    expect(elements.a.x).toBe(elements.b.x);
    expect(elements.b.x).toBe(elements.c.x);
  });

  it("creates a bound connector with optional label between two nodes", async () => {
    await service.createScene({
      sceneId: "connector-scene",
      elements: [
        { id: "left", type: "rectangle", x: 0, y: 0, width: 160, height: 80 },
        { id: "right", type: "rectangle", x: 320, y: 0, width: 160, height: 80 }
      ]
    });

    const result = await service.createConnector("connector-scene", {
      sourceElementId: "left",
      targetElementId: "right",
      label: "syncs",
      connectorType: "arrow"
    });

    const connector = result.scene.elements.find((element: any) => element.type === "arrow");
    expect(connector).toBeTruthy();
    expect(connector.startBinding.elementId).toBe("left");
    expect(connector.endBinding.elementId).toBe("right");
    expect(connector.x).toBe(160);
    expect(connector.y).toBe(40);
    expect(connector.points[0]).toEqual([0, 0]);
    expect(connector.points[1][0]).toBeGreaterThan(0);
    expect(result.scene.elements.some((element: any) => element.type === "text" && element.containerId === connector.id)).toBe(true);
  });
});
