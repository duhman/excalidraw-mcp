import { createHash } from "node:crypto";
import type { ExportOptions } from "../types/contracts.js";
import type { SceneService } from "../domain/sceneService.js";

export class ExportService {
  private readonly sceneService: SceneService;

  constructor(sceneService: SceneService) {
    this.sceneService = sceneService;
  }

  async export(sceneId: string, options: ExportOptions): Promise<{
    mimeType: string;
    base64: string;
    width: number;
    height: number;
    checksum: string;
  }> {
    if (options.format === "json") {
      const scene = await this.sceneService.getScene(sceneId);
      const json = JSON.stringify(
        {
          type: "excalidraw",
          version: 2,
          source: "excalidraw-mcp",
          elements: scene.elements,
          appState: scene.appState,
          files: scene.files,
          libraryItems: scene.libraryItems
        },
        null,
        2
      );

      const base64 = Buffer.from(json, "utf8").toString("base64");
      return {
        mimeType: "application/json",
        base64,
        width: 0,
        height: 0,
        checksum: createHash("sha256").update(json).digest("hex")
      };
    }

    const rendered = await this.sceneService.exportScene(sceneId, options);
    const checksum = createHash("sha256").update(Buffer.from(rendered.base64, "base64")).digest("hex");

    return {
      ...rendered,
      checksum
    };
  }
}
