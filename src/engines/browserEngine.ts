import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import pLimit from "p-limit";
import type { ExportOptions, SceneEnvelope } from "../types/contracts.js";
import { AppError } from "../utils/errors.js";

export interface BrowserExportResult {
  mimeType: string;
  base64: string;
  width: number;
  height: number;
}

export interface BrowserEngineOptions {
  maxConcurrency?: number;
  idleRecycleMs?: number;
}

export class BrowserEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly runLimited;
  private readonly idleRecycleMs: number;
  private recycleTimer: NodeJS.Timeout | null = null;

  constructor(options: BrowserEngineOptions = {}) {
    const maxConcurrency = options.maxConcurrency ?? 2;
    this.runLimited = pLimit(maxConcurrency);
    this.idleRecycleMs = options.idleRecycleMs ?? 90_000;
  }

  async health(): Promise<{ ready: boolean; details: string }> {
    try {
      await this.ensurePage();
      return {
        ready: true,
        details: "Browser engine available"
      };
    } catch (error) {
      return {
        ready: false,
        details: error instanceof Error ? error.message : "Unknown browser initialization error"
      };
    }
  }

  async exportScene(scene: SceneEnvelope, options: ExportOptions): Promise<BrowserExportResult> {
    return this.runLimited(async () => {
      const page = await this.ensurePage();
      this.bumpRecycleTimer();

      if (options.format === "json") {
        throw new AppError("BAD_REQUEST", "Browser engine does not handle json exports", 400);
      }

      try {
        const result = await page.evaluate(
          async ({ inputScene, exportOptions }) => {
            const state = globalThis as unknown as {
              __excalidrawModule?: any;
            };

            if (!state.__excalidrawModule) {
              const moduleUrl = "https://esm.sh/@excalidraw/excalidraw@0.18.0?bundle";
              state.__excalidrawModule = await import(moduleUrl);
            }

            const mod = state.__excalidrawModule;
            const elements = (inputScene.elements ?? []).filter((element: any) => !element.isDeleted);
            const appState = {
              ...(inputScene.appState ?? {}),
              exportWithDarkMode: exportOptions.darkMode ?? Boolean((inputScene.appState as any)?.exportWithDarkMode),
              exportBackground: true,
              exportEmbedScene: exportOptions.embedScene ?? false
            };
            const files = inputScene.files ?? {};

            if (exportOptions.format === "svg") {
              const svgNode = await mod.exportToSvg({
                elements,
                appState,
                files,
                exportPadding: exportOptions.padding ?? 16
              });

              const xml = new XMLSerializer().serializeToString(svgNode);
              const encoded = new TextEncoder().encode(xml);
              let binary = "";
              for (let i = 0; i < encoded.length; i += 1) {
                binary += String.fromCharCode(encoded[i]);
              }

              return {
                mimeType: "image/svg+xml",
                base64: btoa(binary),
                width: Number(svgNode.getAttribute("width") ?? 0),
                height: Number(svgNode.getAttribute("height") ?? 0)
              };
            }

            const mimeType = exportOptions.format === "webp" ? "image/webp" : "image/png";
            const blob = await mod.exportToBlob({
              elements,
              appState,
              files,
              exportPadding: exportOptions.padding ?? 16,
              maxWidthOrHeight: exportOptions.maxWidthOrHeight,
              quality: exportOptions.quality,
              mimeType
            });

            const buffer = new Uint8Array(await blob.arrayBuffer());
            let binary = "";
            for (let i = 0; i < buffer.length; i += 1) {
              binary += String.fromCharCode(buffer[i]);
            }

            const bitmap = await createImageBitmap(blob);
            const width = bitmap.width;
            const height = bitmap.height;
            bitmap.close();

            return {
              mimeType,
              base64: btoa(binary),
              width,
              height
            };
          },
          {
            inputScene: scene,
            exportOptions: options
          }
        );

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown browser export error";
        throw new AppError("DEGRADED_MODE", `Browser export failed: ${message}`, 503, {
          format: options.format
        });
      }
    });
  }

  async close(): Promise<void> {
    if (this.recycleTimer) {
      clearTimeout(this.recycleTimer);
      this.recycleTimer = null;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async ensurePage(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true
      });
    }

    if (!this.context) {
      this.context = await this.browser.newContext();
    }

    if (!this.page || this.page.isClosed()) {
      this.page = await this.context.newPage();
      await this.page.goto("about:blank", {
        waitUntil: "domcontentloaded"
      });
    }

    return this.page;
  }

  private bumpRecycleTimer(): void {
    if (this.recycleTimer) {
      clearTimeout(this.recycleTimer);
    }

    this.recycleTimer = setTimeout(() => {
      void this.close().catch(() => {
        // ignore cleanup errors
      });
    }, this.idleRecycleMs);
  }
}
