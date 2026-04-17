import { afterEach, describe, expect, it } from "vitest";
import { BrowserEngine } from "../../src/engines/browserEngine.js";

function makeScene() {
  return {
    metadata: {
      sceneId: "browser-export-scene",
      name: "Browser Export Scene",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      elementCount: 2,
      fileCount: 0,
      engineHints: {
        hasFrames: false,
        hasEmbeddables: false,
        hasImages: false,
      },
      revisionHash: "test",
    },
    elements: [
      {
        id: "box",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 220,
        height: 120,
        boundElements: [{ id: "label", type: "text" }],
      },
      {
        id: "label",
        type: "text",
        x: 24,
        y: 44,
        width: 172,
        height: 28,
        text: "Export me",
        originalText: "Export me",
        fontSize: 22,
        containerId: "box",
        autoResize: true,
      },
    ],
    appState: {
      viewBackgroundColor: "#ffffff",
    },
    files: {},
    libraryItems: [],
  };
}

describe("BrowserEngine export", () => {
  let engine: BrowserEngine | null = null;

  afterEach(async () => {
    if (engine) {
      await engine.close();
      engine = null;
    }
  });

  it("exports locally and applies scale to raster and svg output", async () => {
    engine = new BrowserEngine({ idleRecycleMs: 1_000 });
    const scene = makeScene();

    const png1x = await engine.exportScene(scene as any, {
      format: "png",
      padding: 0,
      scale: 1,
    });
    const png2x = await engine.exportScene(scene as any, {
      format: "png",
      padding: 0,
      scale: 2,
    });
    const svg2x = await engine.exportScene(scene as any, {
      format: "svg",
      padding: 0,
      scale: 2,
    });

    expect(png1x.mimeType).toBe("image/png");
    expect(png1x.width).toBeGreaterThan(0);
    expect(png1x.height).toBeGreaterThan(0);
    expect(png2x.width).toBeGreaterThan(png1x.width);
    expect(png2x.height).toBeGreaterThan(png1x.height);
    expect(svg2x.mimeType).toBe("image/svg+xml");

    const svgXml = Buffer.from(svg2x.base64, "base64").toString("utf8");
    expect(svgXml).toContain("<svg");
    expect(svg2x.width).toBeGreaterThan(0);
    expect(svg2x.height).toBeGreaterThan(0);
  }, 60_000);

  it("fails fast on invalid scale values", async () => {
    engine = new BrowserEngine({ idleRecycleMs: 1_000 });

    await expect(
      engine.exportScene(makeScene() as any, {
        format: "png",
        scale: 0,
      } as any),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
