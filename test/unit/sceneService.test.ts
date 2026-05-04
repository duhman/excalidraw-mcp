import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { SceneStore } from "../../src/domain/sceneStore.js";
import { SceneService } from "../../src/domain/sceneService.js";
import { JsonEngine } from "../../src/engines/jsonEngine.js";

describe("SceneService", () => {
  let rootDir: string;
  let store: SceneStore;
  let service: SceneService;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-test-"));
    store = new SceneStore(join(rootDir, "scenes"));
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

  it("deduplicates identical file uploads by decoded bytes", async () => {
    await service.createScene({ sceneId: "dedup-scene" });
    const base64 = Buffer.from("same-file-content").toString("base64");

    const first = await service.attachFile("dedup-scene", {
      mimeType: "image/png",
      base64,
    });
    const second = await service.attachFile("dedup-scene", {
      mimeType: "image/png",
      base64,
    });

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.fileId).toBe(first.fileId);

    const scene = await service.getScene("dedup-scene");
    expect(Object.keys(scene.files)).toHaveLength(1);
  });

  it("reports and repairs missing container text backlinks", async () => {
    const scene = await service.createScene({ sceneId: "container-scene" });
    await store.save({
      ...scene,
      elements: [
        {
          id: "box",
          type: "rectangle",
          x: 20,
          y: 20,
          width: 240,
          height: 100,
        },
        {
          id: "label",
          type: "text",
          containerId: "box",
          x: 40,
          y: 58,
          width: 180,
          height: 24,
          fontSize: 20,
          text: "Container label",
          originalText: "Container label",
          autoResize: true,
        },
      ],
    });

    const before = await service.validateScene("container-scene");
    expect(
      before.qualityIssues.some(
        (issue) => issue.code === "CONTAINER_TEXT_UNBOUND",
      ),
    ).toBe(true);

    const normalized = await service.normalizeScene("container-scene");
    const container = normalized.elements.find((element: any) => element.id === "box");
    expect(container?.boundElements).toEqual([{ id: "label", type: "text" }]);

    const after = await service.validateScene("container-scene");
    expect(
      after.qualityIssues.some(
        (issue) => issue.code === "CONTAINER_TEXT_UNBOUND",
      ),
    ).toBe(false);
  });

  it("repairs invalid persisted geometry during normalization", async () => {
    const scene = await service.createScene({ sceneId: "normalize-scene" });
    await store.save({
      ...scene,
      elements: [
        {
          id: "bad-shape",
          type: "rectangle",
          x: "oops",
          y: Number.NaN,
          width: "bad",
          height: Number.POSITIVE_INFINITY,
        },
      ],
    } as any);

    const before = await service.validateScene("normalize-scene");
    expect(before.valid).toBe(false);
    expect(
      before.qualityIssues.some((issue) => issue.code === "GEOMETRY_INVALID"),
    ).toBe(true);

    const normalized = await service.normalizeScene("normalize-scene");
    const repaired = normalized.elements.find(
      (element: any) => element.id === "bad-shape",
    );

    expect(typeof repaired?.x).toBe("number");
    expect(Number.isFinite(repaired?.x)).toBe(true);
    expect(typeof repaired?.y).toBe("number");
    expect(Number.isFinite(repaired?.y)).toBe(true);
    expect(typeof repaired?.width).toBe("number");
    expect(Number.isFinite(repaired?.width)).toBe(true);
    expect(typeof repaired?.height).toBe("number");
    expect(Number.isFinite(repaired?.height)).toBe(true);

    const after = await service.validateScene("normalize-scene");
    expect(after.valid).toBe(true);
    expect(
      after.qualityIssues.some((issue) => issue.code === "GEOMETRY_INVALID"),
    ).toBe(false);
  });

  it("moves bound dependent text when arranging its parent element", async () => {
    await service.createScene({
      sceneId: "dependents-scene",
      elements: [
        {
          id: "left",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 120,
          height: 80,
        },
        {
          id: "right",
          type: "rectangle",
          x: 420,
          y: 160,
          width: 120,
          height: 80,
          boundElements: [{ id: "right-label", type: "text" }],
        },
        {
          id: "right-label",
          type: "text",
          x: 440,
          y: 188,
          width: 80,
          height: 24,
          text: "Right",
          originalText: "Right",
          containerId: "right",
          fontSize: 18,
          autoResize: true,
        },
      ],
    });

    const before = await service.getScene("dependents-scene");
    const beforeRight = before.elements.find((element: any) => element.id === "right");
    const beforeLabel = before.elements.find(
      (element: any) => element.id === "right-label",
    );

    const arranged = await service.arrangeElements("dependents-scene", {
      elementIds: ["left", "right"],
      mode: "stack",
      axis: "x",
      gap: 40,
      anchor: "center",
    });

    const afterRight = arranged.scene.elements.find((element: any) => element.id === "right");
    const afterLabel = arranged.scene.elements.find(
      (element: any) => element.id === "right-label",
    );
    const deltaX = Number(afterRight?.x) - Number(beforeRight?.x);
    const deltaY = Number(afterRight?.y) - Number(beforeRight?.y);

    expect(arranged.changedElementIds).toContain("right-label");
    expect(Number(afterLabel?.x) - Number(beforeLabel?.x)).toBe(deltaX);
    expect(Number(afterLabel?.y) - Number(beforeLabel?.y)).toBe(deltaY);
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

  it("analyzes richer scene quality signals with scoring", async () => {
    await service.createScene({
      sceneId: "analysis-scene",
      elements: [
        {
          id: "a",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 180,
          height: 100,
        },
        {
          id: "b",
          type: "rectangle",
          x: 80,
          y: 40,
          width: 180,
          height: 100,
        },
        {
          id: "tiny",
          type: "text",
          x: 20,
          y: 180,
          width: 120,
          height: 20,
          text: "tiny label",
          originalText: "tiny label",
          fontSize: 10,
        },
      ],
    });

    await service.createConnector("analysis-scene", {
      sourceElementId: "a",
      targetElementId: "b",
      connectorType: "arrow",
    });
    await service.createConnector("analysis-scene", {
      sourceElementId: "b",
      targetElementId: "a",
      connectorType: "arrow",
    });

    const analysis = await service.analyzeScene("analysis-scene");
    const issueCodes = analysis.issues.map((issue) => issue.code);

    expect(analysis.score).toBeLessThan(100);
    expect(issueCodes).toContain("ELEMENT_OVERLAP");
    expect(issueCodes).toContain("TEXT_UNREADABLE");
    expect(issueCodes).toContain("MISSING_TITLE");
    expect(issueCodes).toContain("MISSING_LEGEND");
    expect(analysis.summary.visibleElementCount).toBe(5);
    expect(analysis.summary.graph.connectorCount).toBe(2);
  });

  it("emits recommended deterministic follow-up actions in scene analysis", async () => {
    await service.createScene({
      sceneId: "recommend-scene",
      elements: [
        {
          id: "small-text",
          type: "text",
          x: 0,
          y: 0,
          width: 80,
          height: 16,
          text: "tiny",
          originalText: "tiny",
          fontSize: 10,
        },
        {
          id: "overlap-a",
          type: "rectangle",
          x: 40,
          y: 80,
          width: 180,
          height: 96,
        },
        {
          id: "overlap-b",
          type: "rectangle",
          x: 90,
          y: 110,
          width: 180,
          height: 96,
        },
        {
          id: "broken-image",
          type: "image",
          x: 280,
          y: 80,
          width: 80,
          height: 80,
          fileId: "missing-file",
        },
      ],
    });

    const analysis = await service.analyzeScene("recommend-scene");
    const tools = analysis.recommendedActions.map((action) => action.tool);

    expect(tools).toContain("scene_normalize");
    expect(tools).toContain("layout_polish");
    expect(tools).toContain("styles_apply_preset");
  });

  it("expands containers when wrapped text needs more vertical room", async () => {
    await service.createScene({ sceneId: "vertical-overflow-scene" });

    const patched = await service.patchScene("vertical-overflow-scene", [
      {
        op: "addElements",
        elements: [
          {
            id: "box",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 140,
            height: 48,
          },
          {
            id: "box-text",
            type: "text",
            containerId: "box",
            x: 8,
            y: 8,
            width: 300,
            height: 18,
            fontSize: 18,
            lineHeight: 1.25,
            text: "This content wraps across several lines and must remain inside the box",
          },
        ],
      },
    ] as any);

    const box = patched.scene.elements.find((element: any) => element.id === "box");
    const text = patched.scene.elements.find((element: any) => element.id === "box-text");

    expect(String(text?.text ?? "")).toContain("\n");
    expect(Number(box?.height)).toBeGreaterThan(48);
    expect(Number(text?.y) + Number(text?.height)).toBeLessThanOrEqual(
      Number(box?.y) + Number(box?.height),
    );

    const validation = await service.validateScene("vertical-overflow-scene");
    expect(validation.qualityIssues.some((issue) => issue.code === "TEXT_OVERFLOW")).toBe(false);
  });

  it("repositions bound text that would otherwise sit outside its container", async () => {
    await service.createScene({ sceneId: "text-placement-scene" });

    const patched = await service.patchScene("text-placement-scene", [
      {
        op: "addElements",
        elements: [
          { id: "box", type: "rectangle", x: 100, y: 100, width: 180, height: 96 },
          {
            id: "label",
            type: "text",
            containerId: "box",
            x: 260,
            y: 170,
            width: 64,
            height: 20,
            fontSize: 16,
            text: "Inside",
          },
        ],
      },
    ] as any);

    const box = patched.scene.elements.find((element: any) => element.id === "box");
    const label = patched.scene.elements.find((element: any) => element.id === "label");

    expect(Number(label?.x)).toBeGreaterThanOrEqual(Number(box?.x));
    expect(Number(label?.y)).toBeGreaterThanOrEqual(Number(box?.y));
    expect(Number(label?.x) + Number(label?.width)).toBeLessThanOrEqual(
      Number(box?.x) + Number(box?.width),
    );
    expect(Number(label?.y) + Number(label?.height)).toBeLessThanOrEqual(
      Number(box?.y) + Number(box?.height),
    );

    const validation = await service.validateScene("text-placement-scene");
    expect(validation.qualityIssues.some((issue) => issue.code === "TEXT_OVERFLOW")).toBe(false);
  });

  it("wraps long connector labels and keeps them centered on the connector", async () => {
    await service.createScene({
      sceneId: "connector-label-fit-scene",
      elements: [
        { id: "left", type: "rectangle", x: 0, y: 0, width: 120, height: 64 },
        { id: "right", type: "rectangle", x: 300, y: 0, width: 120, height: 64 },
      ],
    });

    const result = await service.createConnector("connector-label-fit-scene", {
      sourceElementId: "left",
      targetElementId: "right",
      label: "approval payload with unusually detailed context",
      connectorType: "arrow",
    });

    const connector = result.scene.elements.find((element: any) => element.id === result.connectorId);
    const label = result.scene.elements.find((element: any) => element.id === result.labelId);
    const connectorCenterX = Number(connector?.x) + Number(connector?.width) / 2;
    const connectorCenterY = Number(connector?.y) + Number(connector?.height) / 2;

    expect(String(label?.text ?? "")).toContain("\n");
    expect(Number(label?.width)).toBeLessThanOrEqual(220);
    expect(Number(label?.x) + Number(label?.width) / 2).toBeCloseTo(connectorCenterX, 3);
    expect(Number(label?.y) + Number(label?.height) / 2).toBeCloseTo(connectorCenterY, 3);

    const validation = await service.validateScene("connector-label-fit-scene");
    expect(validation.qualityIssues.some((issue) => issue.code === "TEXT_OVERFLOW")).toBe(false);
  });
});
