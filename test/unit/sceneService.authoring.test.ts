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
        libraryItems: [
          {
            id: "lib1",
            status: "published",
            created: Date.now(),
            name: "Reusable Box",
            elements: [
              {
                id: "lib-rect",
                type: "rectangle",
                x: 0,
                y: 0,
                width: 120,
                height: 64,
              },
            ],
          },
        ]
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
    expect(connector.x).toBeCloseTo(160.5, 3);
    expect(connector.y).toBeCloseTo(40, 3);
    expect(connector.points[0]).toEqual([0, 0]);
    expect(connector.points[1][0]).toBeGreaterThan(0);
    expect(result.scene.elements.some((element: any) => element.type === "text" && element.containerId === connector.id)).toBe(true);
  });

  it("creates public Excalidraw skeleton element types with rich image and frame fields", async () => {
    await service.createScene({ sceneId: "skeleton-scene" });
    const file = await service.attachFile("skeleton-scene", {
      mimeType: "image/png",
      base64: Buffer.from("image").toString("base64"),
      metadata: { source: "unit-test" },
    });

    const result = await service.createElementsFromSkeletons("skeleton-scene", [
      { id: "rect", type: "rectangle", x: 0, y: 0, width: 100, height: 60, link: "https://example.com", locked: true },
      { id: "diamond", type: "diamond", x: 130, y: 0, width: 100, height: 60 },
      { id: "ellipse", type: "ellipse", x: 260, y: 0, width: 100, height: 60 },
      { id: "line", type: "line", x: 0, y: 100, points: [[0, 0], [100, 40]] },
      { id: "arrow", type: "arrow", x: 140, y: 100, points: [[0, 0], [100, 40]], endArrowhead: "crowfoot_many" },
      { id: "text", type: "text", x: 0, y: 180, text: "Typed text", fontSize: 18, textAlign: "center" },
      { id: "free", type: "freedraw", x: 260, y: 100, width: 80, height: 40, points: [[0, 0], [20, 10], [80, 40]], pressures: [0.2, 0.5, 0.7], simulatePressure: true },
      { id: "embed", type: "embeddable", x: 400, y: 0, width: 160, height: 90, link: "https://example.com/embed" },
      { id: "iframe", type: "iframe", x: 400, y: 120, width: 160, height: 90, link: "https://example.com/frame" },
      {
        id: "img",
        type: "image",
        x: 600,
        y: 0,
        width: 96,
        height: 64,
        fileId: file.fileId,
        status: "saved",
        scale: [1, -1],
        crop: { x: 0, y: 0, width: 20, height: 20, naturalWidth: 40, naturalHeight: 40 },
      },
      { id: "frame", type: "frame", x: -20, y: -20, width: 420, height: 260, children: ["rect", "diamond"], name: "Frame" },
      { id: "magic", type: "magicframe", x: 380, y: -20, width: 360, height: 260, children: ["embed", "iframe", "img"], name: "Magic" },
    ]);

    const byId = Object.fromEntries(result.scene.elements.map((element: any) => [element.id, element]));
    expect(Object.keys(byId)).toEqual(expect.arrayContaining(["rect", "diamond", "ellipse", "line", "arrow", "text", "free", "embed", "iframe", "img", "frame", "magic"]));
    expect(byId.rect.locked).toBe(true);
    expect(byId.img.fileId).toBe(file.fileId);
    expect(byId.img.crop).toEqual({ x: 0, y: 0, width: 20, height: 20, naturalWidth: 40, naturalHeight: 40 });
    expect(byId.img.scale).toEqual([1, -1]);
    expect(byId.frame.type).toBe("frame");
    expect(byId.magic.type).toBe("magicframe");
    expect(byId.rect.frameId).toBe("frame");
    expect(byId.img.frameId).toBe("magic");
    expect(result.scene.files[file.fileId]?.source).toBe("unit-test");
  });

  it("supports full public arrowhead values on connectors", async () => {
    await service.createScene({
      sceneId: "arrowhead-scene",
      elements: [
        { id: "left", type: "rectangle", x: 0, y: 0, width: 160, height: 80 },
        { id: "right", type: "rectangle", x: 320, y: 0, width: 160, height: 80 },
      ],
    });

    const result = await service.createConnector("arrowhead-scene", {
      sourceElementId: "left",
      targetElementId: "right",
      connectorType: "arrow",
      startArrowhead: "diamond_outline",
      endArrowhead: "crowfoot_one_or_many",
      points: [[0, 0], [80, -40], [160, 0]],
    });

    const connector = result.scene.elements.find((element: any) => element.id === result.connectorId);
    expect(connector?.startArrowhead).toBe("diamond_outline");
    expect(connector?.endArrowhead).toBe("crowfoot_one_or_many");
    expect(connector?.points).toHaveLength(3);
    expect(connector?.points[1][0]).toBeGreaterThan(79);
    expect(connector?.points[1][0]).toBeLessThan(81);
    expect(connector?.points[1][1]).toBeGreaterThan(-41);
    expect(connector?.points[1][1]).toBeLessThan(-39);
  });

  it("creates magic frames with official children input", async () => {
    await service.createScene({
      sceneId: "magic-frame-scene",
      elements: [
        { id: "child", type: "rectangle", x: 40, y: 40, width: 100, height: 60 },
      ],
    });

    const result = await service.createFrame("magic-frame-scene", {
      frameId: "magic-frame",
      kind: "magicframe",
      name: "Magic Frame",
      x: 20,
      y: 20,
      width: 180,
      height: 120,
      children: ["child"],
    });

    const frame = result.scene.elements.find((element: any) => element.id === "magic-frame");
    const child = result.scene.elements.find((element: any) => element.id === "child");
    expect(frame?.type).toBe("magicframe");
    expect(child?.frameId).toBe("magic-frame");
  });

  it("composes semantic nodes with wrapped body text, icon slot, image slot, and frame assignment", async () => {
    await service.createScene({ sceneId: "compose-scene" });
    const attached = await service.attachFile("compose-scene", {
      mimeType: "image/png",
      base64: Buffer.from("node-image").toString("base64"),
    });

    await service.createFrame("compose-scene", {
      frameId: "frame-a",
      name: "Area A",
      x: 40,
      y: 40,
      width: 420,
      height: 260,
    });

    const composed = await service.composeNodes("compose-scene", {
      preset: "process",
      nodes: [
        {
          nodeId: "semantic-node",
          x: 80,
          y: 100,
          width: 220,
          minHeight: 120,
          title: "Primary Node",
          body: "This body text should wrap into multiple lines for deterministic sizing.",
          iconText: "AI",
          imageFileId: attached.fileId,
          frameId: "frame-a",
        },
      ],
    });

    const container = composed.scene.elements.find((element: any) => element.id === "semantic-node");
    const title = composed.scene.elements.find((element: any) => element.id === composed.nodes[0]?.titleTextId);
    const body = composed.scene.elements.find((element: any) => element.id === composed.nodes[0]?.bodyTextId);
    const icon = composed.scene.elements.find((element: any) => element.id === composed.nodes[0]?.iconElementId);
    const image = composed.scene.elements.find((element: any) => element.id === composed.nodes[0]?.imageElementId);

    expect(composed.nodes).toHaveLength(1);
    expect(container?.type).toBe("rectangle");
    expect(container?.frameId).toBe("frame-a");
    expect(Number(container?.height)).toBeGreaterThanOrEqual(120);
    expect(title?.text).toContain("Primary Node");
    expect(body?.text).toContain("\n");
    expect(body?.frameId).toBe("frame-a");
    expect(icon?.type).toBe("rectangle");
    expect(image?.type).toBe("image");
    expect(image?.fileId).toBe(attached.fileId);
  });

  it("creates swimlanes with headers and assigns lane-local content into frames", async () => {
    await service.createScene({
      sceneId: "swimlane-scene",
      elements: [
        { id: "lead", type: "rectangle", x: 0, y: 0, width: 140, height: 72 },
        { id: "build", type: "rectangle", x: 320, y: 140, width: 160, height: 72 },
      ],
    });

    const result = await service.layoutSwimlanes("swimlane-scene", {
      laneArrangement: "columns",
      originX: 24,
      originY: 40,
      laneWidth: 280,
      laneHeight: 260,
      lanes: [
        { laneId: "lane-sales", label: "Sales", elementIds: ["lead"] },
        { laneId: "lane-ops", label: "Operations", elementIds: ["build"] },
      ],
    });

    const laneSales = result.scene.elements.find((element: any) => element.id === "lane-sales");
    const laneOps = result.scene.elements.find((element: any) => element.id === "lane-ops");
    const lead = result.scene.elements.find((element: any) => element.id === "lead");
    const build = result.scene.elements.find((element: any) => element.id === "build");
    const headers = result.scene.elements.filter(
      (element: any) => element.customData?.semanticRole === "lane-header",
    );

    expect(result.laneFrameIds).toEqual(["lane-sales", "lane-ops"]);
    expect(result.laneHeaderIds).toHaveLength(2);
    expect(headers.map((header: any) => header.text)).toEqual(
      expect.arrayContaining(["Sales", "Operations"]),
    );
    expect(laneSales?.type).toBe("frame");
    expect(laneOps?.type).toBe("frame");
    expect(lead?.frameId).toBe("lane-sales");
    expect(build?.frameId).toBe("lane-ops");
    expect(Number(lead?.x)).toBeGreaterThanOrEqual(Number(laneSales?.x));
    expect(Number(build?.x)).toBeGreaterThanOrEqual(Number(laneOps?.x));
  });

  it("deterministically polishes overlap-heavy layouts", async () => {
    await service.createScene({
      sceneId: "polish-scene",
      elements: [
        { id: "one", type: "rectangle", x: 80, y: 120, width: 180, height: 96 },
        { id: "two", type: "rectangle", x: 140, y: 150, width: 180, height: 96 },
      ],
    });

    const before = await service.analyzeScene("polish-scene");
    expect(before.issues.some((issue) => issue.code === "ELEMENT_OVERLAP")).toBe(
      true,
    );

    const polished = await service.layoutPolish("polish-scene", {
      issueCodes: ["ELEMENT_OVERLAP"],
      mode: "safe",
    });

    const after = await service.analyzeScene("polish-scene");
    expect(polished.appliedActions).toContain("resolved_overlaps");
    expect(after.issues.filter((issue) => issue.code === "ELEMENT_OVERLAP").length).toBeLessThan(
      before.issues.filter((issue) => issue.code === "ELEMENT_OVERLAP").length,
    );
  });

  it("composes a semantic diagram and reports quality-gate status", async () => {
    const result = await service.composeDiagram({
      sceneId: "composed-diagram",
      title: "Agent Diagram",
      diagramType: "flow",
      stylePreset: "process",
      qualityTarget: 70,
      nodes: [
        { id: "start", title: "Start", body: "Collect input" },
        { id: "finish", title: "Finish", body: "Ship output" },
      ],
      edges: [{ source: "start", target: "finish", label: "then" }],
      legend: "Legend: arrows show sequence",
    });

    expect(result.scene.metadata.sceneId).toBe("composed-diagram");
    expect(result.nodeIds).toEqual(["start", "finish"]);
    expect(result.connectorIds).toHaveLength(1);
    expect(result.validation.valid).toBe(true);
    expect(result.qualityGate.passed).toBe(true);
  });

  it("fails the default quality gate for missing title and low score", async () => {
    await service.createScene({
      sceneId: "quality-scene",
      elements: [
        { id: "one", type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
        { id: "two", type: "rectangle", x: 20, y: 20, width: 100, height: 60 },
      ],
    });

    const gate = await service.qualityGate("quality-scene");
    expect(gate.passed).toBe(false);
    expect(gate.failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining(["MISSING_TITLE", "ELEMENT_OVERLAP"]),
    );
  });
});
