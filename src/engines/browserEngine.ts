import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
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
  private readonly browserPageDir: string;
  private readonly browserBundleEntryPath: string;
  private readonly browserBundlePath: string;
  private readonly excalidrawAssetRoot: string;
  private recycleTimer: NodeJS.Timeout | null = null;
  private bundleReady: Promise<void> | null = null;
  private assetServer: Server | null = null;
  private assetServerBaseUrl: string | null = null;
  private activeOperations = 0;

  constructor(options: BrowserEngineOptions = {}) {
    const maxConcurrency = options.maxConcurrency ?? 2;
    this.runLimited = pLimit(maxConcurrency);
    this.idleRecycleMs = options.idleRecycleMs ?? 90_000;
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const hostPagePathCandidates = [
      resolve(currentDir, "browser/page/excalidrawHost.html"),
      resolve(currentDir, "../../../src/engines/browser/page/excalidrawHost.html"),
    ];
    const hostPagePath =
      hostPagePathCandidates.find((candidate) => existsSync(candidate)) ??
      hostPagePathCandidates[hostPagePathCandidates.length - 1]!;
    this.browserPageDir = dirname(hostPagePath);
    this.browserBundleEntryPath = resolve(this.browserPageDir, "excalidrawApi.ts");
    this.browserBundlePath = resolve(this.browserPageDir, "excalidrawApi.bundle.js");
    this.excalidrawAssetRoot = resolve(
      this.browserPageDir,
      "../../../../node_modules/@excalidraw/excalidraw/dist/prod",
    );
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
      const scale = Number(options.scale ?? 1);
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new AppError("BAD_REQUEST", "Export scale must be a positive number", 400, {
          scale: options.scale,
        });
      }

      this.beginActiveOperation();

      try {
        const page = await this.ensurePage();

        if (options.format === "json") {
          throw new AppError("BAD_REQUEST", "Browser engine does not handle json exports", 400);
        }

        const result = await page.evaluate(
          async ({ inputScene, exportOptions }) => {
            const state = globalThis as unknown as {
              __excalidrawApi?: any;
            };
            const api = state.__excalidrawApi;

            if (!api) {
              throw new Error("Excalidraw browser bundle did not initialize");
            }

            const elements = (inputScene.elements ?? []).filter((element: any) => !element.isDeleted);
            const appState = {
              ...(inputScene.appState ?? {}),
              exportWithDarkMode: exportOptions.darkMode ?? Boolean((inputScene.appState as any)?.exportWithDarkMode),
              exportBackground: true,
              exportEmbedScene: exportOptions.embedScene ?? false
            };
            const files = inputScene.files ?? {};
            const scale = Number(exportOptions.scale ?? 1);

            if (exportOptions.format === "svg") {
              const svgNode = await api.exportToSvg({
                elements,
                appState,
                files,
                exportPadding: exportOptions.padding ?? 16
              });

              if (scale !== 1) {
                const width = Number(svgNode.getAttribute("width") ?? 0);
                const height = Number(svgNode.getAttribute("height") ?? 0);
                if (width > 0) {
                  svgNode.setAttribute("width", String(Math.round(width * scale)));
                }
                if (height > 0) {
                  svgNode.setAttribute("height", String(Math.round(height * scale)));
                }
              }

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
            const blob = await api.exportToBlob({
              elements,
              appState,
              files,
              getDimensions:
                scale === 1
                  ? undefined
                  : (width: number, height: number) => ({
                      width: Math.max(1, Math.round(width * scale)),
                      height: Math.max(1, Math.round(height * scale)),
                      scale
                    }),
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
        if (error instanceof AppError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : "Unknown browser export error";
        throw new AppError("DEGRADED_MODE", `Browser export failed: ${message}`, 503, {
          format: options.format
        });
      } finally {
        this.endActiveOperation();
      }
    });
  }

  async close(): Promise<void> {
    if (this.recycleTimer) {
      clearTimeout(this.recycleTimer);
      this.recycleTimer = null;
    }

    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // ignore disposal races during shutdown
      }
      this.context = null;
      this.page = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // ignore disposal races during shutdown
      }
      this.browser = null;
    }

    if (this.assetServer) {
      await new Promise<void>((resolveClose) => {
        this.assetServer?.close(() => resolveClose());
      });
      this.assetServer = null;
      this.assetServerBaseUrl = null;
    }
  }

  private async ensurePage(): Promise<Page> {
    await this.ensureBrowserBundle();
    const assetServerBaseUrl = await this.ensureAssetServer();

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
      await this.page.goto(`${assetServerBaseUrl}/excalidrawHost.html`, {
        waitUntil: "domcontentloaded"
      });
      await this.page.waitForFunction(
        () => Boolean((globalThis as { __excalidrawApi?: unknown }).__excalidrawApi),
      );
    }

    return this.page;
  }

  private async ensureBrowserBundle(): Promise<void> {
    if (!this.bundleReady) {
      this.bundleReady = this.buildBrowserBundleIfNeeded().catch((error) => {
        this.bundleReady = null;
        throw error;
      });
    }

    await this.bundleReady;
  }

  private async buildBrowserBundleIfNeeded(): Promise<void> {
    const [entryStats, bundleStats] = await Promise.all([
      stat(this.browserBundleEntryPath).catch(() => null),
      stat(this.browserBundlePath).catch(() => null),
    ]);

    if (!entryStats) {
      throw new AppError(
        "INTERNAL",
        "Missing Excalidraw browser bundle entry source",
        500,
        { entryPath: this.browserBundleEntryPath },
      );
    }

    if (bundleStats && bundleStats.mtimeMs >= entryStats.mtimeMs) {
      return;
    }

    await build({
      entryPoints: [this.browserBundleEntryPath],
      outfile: this.browserBundlePath,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      logLevel: "silent",
    });
  }

  private async ensureAssetServer(): Promise<string> {
    if (this.assetServerBaseUrl) {
      return this.assetServerBaseUrl;
    }

    this.assetServer = createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
        const relativePath =
          requestUrl.pathname === "/"
            ? "excalidrawHost.html"
            : requestUrl.pathname.replace(/^\/+/, "");

        const candidates = [
          resolve(this.browserPageDir, relativePath),
          resolve(this.excalidrawAssetRoot, relativePath),
        ].filter((candidate, index, all) => all.indexOf(candidate) === index);

        const filePath = candidates.find((candidate) => existsSync(candidate));
        if (!filePath) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        const data = await readFile(filePath);
        response.writeHead(200, {
          "content-type": this.mimeTypeForPath(filePath),
          "cache-control": "no-store",
        });
        response.end(data);
      } catch (error) {
        response.writeHead(500);
        response.end(
          error instanceof Error ? error.message : "Unknown asset server error",
        );
      }
    });

    await new Promise<void>((resolveListen, rejectListen) => {
      this.assetServer?.once("error", rejectListen);
      this.assetServer?.listen(0, "127.0.0.1", () => resolveListen());
    });

    const address = this.assetServer.address() as AddressInfo;
    this.assetServerBaseUrl = `http://127.0.0.1:${address.port}`;
    return this.assetServerBaseUrl;
  }

  private mimeTypeForPath(filePath: string): string {
    if (filePath.endsWith(".html")) {
      return "text/html; charset=utf-8";
    }
    if (filePath.endsWith(".js")) {
      return "text/javascript; charset=utf-8";
    }
    if (filePath.endsWith(".json")) {
      return "application/json; charset=utf-8";
    }
    if (filePath.endsWith(".css")) {
      return "text/css; charset=utf-8";
    }
    if (filePath.endsWith(".woff2")) {
      return "font/woff2";
    }
    if (filePath.endsWith(".svg")) {
      return "image/svg+xml";
    }
    return "application/octet-stream";
  }

  private bumpRecycleTimer(): void {
    if (this.recycleTimer) {
      clearTimeout(this.recycleTimer);
    }

    this.recycleTimer = setTimeout(() => {
      if (this.activeOperations > 0) {
        this.bumpRecycleTimer();
        return;
      }

      void this.close().catch(() => {
        // ignore cleanup errors
      });
    }, this.idleRecycleMs);
  }

  private beginActiveOperation(): void {
    this.activeOperations += 1;
    if (this.recycleTimer) {
      clearTimeout(this.recycleTimer);
      this.recycleTimer = null;
    }
  }

  private endActiveOperation(): void {
    this.activeOperations = Math.max(0, this.activeOperations - 1);
    if (this.activeOperations === 0) {
      this.bumpRecycleTimer();
    }
  }
}
