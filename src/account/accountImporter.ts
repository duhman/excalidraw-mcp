import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { AppError } from "../utils/errors.js";

export type AccountDestination = "plus" | "excalidraw";
export type AccountImportKind = "scene" | "library";
export type AccountImportMode = "headed" | "headless";

export interface AccountImportOptions {
  inputPath: string;
  destination?: AccountDestination;
  kind: AccountImportKind;
  mode?: AccountImportMode;
  session?: string;
  timeoutSec?: number;
  allowInteractiveLogin?: boolean;
  closeOnComplete?: boolean;
}

export interface AccountLoginOptions {
  destination?: AccountDestination;
  mode?: AccountImportMode;
  session?: string;
  timeoutSec?: number;
  closeOnComplete?: boolean;
}

export interface AccountImportResult {
  status: "success" | "checkpoint_required";
  reason: string;
  destination: AccountDestination;
  kind: AccountImportKind;
  session: string;
  strategy: "A" | "B" | "C" | "none";
  screenshotPath: string;
  url: string;
  timestamp: string;
}

export interface AccountLoginResult {
  status: "ready" | "checkpoint_required";
  reason: string;
  destination: AccountDestination;
  session: string;
  screenshotPath: string;
  url: string;
  profilePath: string;
  timestamp: string;
}

export interface AccountLinkStatus {
  rootDir: string;
  sessions: Array<{
    session: string;
    profilePath: string;
    hasProfileData: boolean;
    lastLogin: AccountLoginResult | null;
    lastImport: AccountImportResult | null;
  }>;
  importsCount: number;
}

const STRATEGIES = ["A", "B", "C"] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120) || "default";
}

function destinationUrl(destination: AccountDestination): string {
  return destination === "plus" ? "https://plus.excalidraw.com" : "https://excalidraw.com";
}

function destinationHost(destination: AccountDestination): string {
  return destination === "plus" ? "plus.excalidraw.com" : "excalidraw.com";
}

export class AccountImporter {
  private readonly rootDir: string;
  private readonly profilesDir: string;
  private readonly artifactsDir: string;
  private readonly historyPath: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.profilesDir = join(rootDir, "profiles");
    this.artifactsDir = join(rootDir, "artifacts");
    this.historyPath = join(rootDir, "import-history.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(this.profilesDir, { recursive: true });
    await mkdir(this.artifactsDir, { recursive: true });
  }

  async loginSession(options: AccountLoginOptions): Promise<AccountLoginResult> {
    await this.init();

    const destination = options.destination ?? "plus";
    const mode = options.mode ?? "headed";
    const session = safeName(options.session ?? "default");
    const timeoutMs = Math.max(10, Math.floor(options.timeoutSec ?? 300)) * 1000;
    const url = destinationUrl(destination);
    const expectedHost = destinationHost(destination);
    const profilePath = join(this.profilesDir, session);
    const screenshotPath = this.buildScreenshotPath({
      inputPath: session,
      destination,
      suffix: "login"
    });

    const context = await chromium.launchPersistentContext(profilePath, {
      headless: mode === "headless"
    });

    try {
      const page = await this.getOrCreatePage(context);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

      const ready = await this.isUiReady(page, expectedHost, timeoutMs);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

      const result: AccountLoginResult = {
        status: ready ? "ready" : "checkpoint_required",
        reason: ready
          ? "Session is authenticated and Excalidraw canvas is ready."
          : "Session not ready. Complete sign-in in this profile and rerun login_session.",
        destination,
        session,
        screenshotPath,
        url: page.url(),
        profilePath,
        timestamp: nowIso()
      };

      await this.writeLastLogin(result);
      return result;
    } finally {
      if (options.closeOnComplete ?? true) {
        await context.close().catch(() => undefined);
      }
    }
  }

  async importToAccount(options: AccountImportOptions): Promise<AccountImportResult> {
    await this.init();

    const destination = options.destination ?? "plus";
    const mode = options.mode ?? "headed";
    const session = safeName(options.session ?? "default");
    const allowInteractiveLogin = options.allowInteractiveLogin ?? true;
    const timeoutMs = Math.max(10, Math.floor(options.timeoutSec ?? 180)) * 1000;

    const url = destinationUrl(destination);
    const expectedHost = destinationHost(destination);
    const profilePath = join(this.profilesDir, session);

    const screenshotPath = this.buildScreenshotPath({
      inputPath: options.inputPath,
      destination
    });

    const context = await chromium.launchPersistentContext(profilePath, {
      headless: mode === "headless"
    });

    try {
      const page = await this.getOrCreatePage(context);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

      if (allowInteractiveLogin && mode === "headed") {
        await page.waitForTimeout(4_000);
      }

      const authReady = await this.isUiReady(page, expectedHost, timeoutMs / 2);
      if (!authReady) {
        const checkpointResult: AccountImportResult = {
          status: "checkpoint_required",
          reason:
            "Authenticated Excalidraw session not ready. Sign in manually in the profile and retry, or call again with mode=headed and allowInteractiveLogin=true.",
          destination,
          kind: options.kind,
          session,
          strategy: "none",
          screenshotPath,
          url: page.url(),
          timestamp: nowIso()
        };

        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
        await this.appendHistory(checkpointResult);
        return checkpointResult;
      }

      let successStrategy: AccountImportResult["strategy"] = "none";

      for (const strategy of STRATEGIES) {
        const applied = await this.applyImportStrategy(page, strategy, options.inputPath);
        if (!applied) {
          continue;
        }

        const uiOk = await this.assertUi(page, expectedHost);
        if (uiOk) {
          successStrategy = strategy;
          break;
        }
      }

      if (successStrategy === "none") {
        throw new AppError("BAD_REQUEST", "All import strategies failed", 400, {
          destination,
          kind: options.kind
        });
      }

      await page.screenshot({ path: screenshotPath, fullPage: true });
      const verified = await this.assertUi(page, expectedHost);
      if (!verified) {
        throw new AppError("BAD_REQUEST", "Import completed but post-import assertions failed", 400);
      }

      const result: AccountImportResult = {
        status: "success",
        reason: "imported",
        destination,
        kind: options.kind,
        session,
        strategy: successStrategy,
        screenshotPath,
        url: page.url(),
        timestamp: nowIso()
      };

      await this.appendHistory(result);
      return result;
    } finally {
      if (options.closeOnComplete ?? true) {
        await context.close().catch(() => undefined);
      }
    }
  }

  async getLinkStatus(sessionFilter?: string): Promise<AccountLinkStatus> {
    await this.init();

    const history = await this.readHistory();
    const entries = await readdir(this.profilesDir, { withFileTypes: true });
    const sessions = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((session) => (sessionFilter ? session === safeName(sessionFilter) : true))
      .sort();

    const statusSessions: AccountLinkStatus["sessions"] = [];
    for (const session of sessions) {
      const profilePath = join(this.profilesDir, session);
      const dirEntries = await readdir(profilePath).catch(() => []);
      const hasProfileData = dirEntries.length > 0;
      const lastImport = [...history].reverse().find((item) => item.session === session) ?? null;

      statusSessions.push({
        session,
        profilePath,
        hasProfileData,
        lastLogin: await this.readLastLogin(session),
        lastImport
      });
    }

    if (statusSessions.length === 0 && sessionFilter) {
      statusSessions.push({
        session: safeName(sessionFilter),
        profilePath: join(this.profilesDir, safeName(sessionFilter)),
        hasProfileData: false,
        lastLogin: null,
        lastImport: null
      });
    }

    return {
      rootDir: this.rootDir,
      sessions: statusSessions,
      importsCount: history.length
    };
  }

  private async readHistory(): Promise<AccountImportResult[]> {
    const raw = await readFile(this.historyPath, "utf8").catch(() => "");
    if (!raw.trim()) {
      return [];
    }

    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const parsed: AccountImportResult[] = [];
    for (const line of lines) {
      try {
        const item = JSON.parse(line) as AccountImportResult;
        parsed.push(item);
      } catch {
        // ignore malformed lines
      }
    }

    return parsed;
  }

  private async appendHistory(result: AccountImportResult): Promise<void> {
    await appendFile(this.historyPath, `${JSON.stringify(result)}\n`, "utf8");

    const latestPath = join(this.rootDir, `last-${result.session}.json`);
    await writeFile(latestPath, JSON.stringify(result, null, 2), "utf8");
  }

  private async writeLastLogin(result: AccountLoginResult): Promise<void> {
    const latestPath = join(this.rootDir, `last-login-${result.session}.json`);
    await writeFile(latestPath, JSON.stringify(result, null, 2), "utf8");
  }

  private async readLastLogin(session: string): Promise<AccountLoginResult | null> {
    const path = join(this.rootDir, `last-login-${session}.json`);
    const raw = await readFile(path, "utf8").catch(() => null);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as AccountLoginResult;
    } catch {
      return null;
    }
  }

  private buildScreenshotPath(input: {
    inputPath: string;
    destination: AccountDestination;
    suffix?: string;
  }): string {
    const stamp = new Date().toISOString().replace(/[.:]/g, "-");
    const prefix = basename(input.inputPath).replace(/\.[^/.]+$/, "");
    const suffix = input.suffix ? `-${input.suffix}` : "";
    return join(this.artifactsDir, `${prefix}-${input.destination}${suffix}-${stamp}.png`);
  }

  private async getOrCreatePage(context: BrowserContext): Promise<Page> {
    const existing = context.pages();
    if (existing.length > 0) {
      return existing[0]!;
    }

    return context.newPage();
  }

  private async isUiReady(page: Page, expectedHost: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const host = new URL(page.url()).host;
      const hostOk = host === expectedHost || host.endsWith(`.${expectedHost}`);
      const hasCanvas = (await page.locator(".excalidraw canvas, canvas").count()) > 0;

      if (hostOk && hasCanvas) {
        return true;
      }

      await page.waitForTimeout(750);
    }

    return false;
  }

  private async assertUi(page: Page, expectedHost: string): Promise<boolean> {
    const host = new URL(page.url()).host;
    if (!(host === expectedHost || host.endsWith(`.${expectedHost}`))) {
      return false;
    }

    const canvasCount = await page.locator(".excalidraw canvas, canvas").count();
    if (canvasCount === 0) {
      return false;
    }

    const hasErrorToast = await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll('[role="alert"], [data-testid*="toast"], .Toastify__toast, .toast, [class*="toast"]')
      );
      return nodes.some((node) => /(failed|error|invalid|unable|could not)/i.test((node.textContent || "").trim()));
    });

    return !hasErrorToast;
  }

  private async applyImportStrategy(page: Page, strategy: "A" | "B" | "C", inputPath: string): Promise<boolean> {
    try {
      if (strategy === "A") {
        const fileInputs = page.locator('input[type="file"]');
        if ((await fileInputs.count()) === 0) {
          return false;
        }

        await fileInputs.first().setInputFiles(inputPath);
        await page.waitForTimeout(1_200);
        return true;
      }

      if (strategy === "B") {
        const chooserPromise = page.waitForEvent("filechooser", { timeout: 2_000 }).catch(() => null);
        await page.keyboard.press(process.platform === "darwin" ? "Meta+O" : "Control+O").catch(() => undefined);
        const chooser = await chooserPromise;
        if (!chooser) {
          return false;
        }
        await chooser.setFiles(inputPath);
        await page.waitForTimeout(1_200);
        return true;
      }

      const chooserPromise = page.waitForEvent("filechooser", { timeout: 2_500 }).catch(() => null);
      const clicked = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("button, [role='menuitem'], a, div"));
        const target = nodes.find((node) => /(open|import|load|file)/i.test((node.textContent || "").trim()));
        if (!target) {
          return false;
        }

        (target as HTMLElement).click();
        return true;
      });

      if (!clicked) {
        return false;
      }

      const chooser = await chooserPromise;
      if (!chooser) {
        return false;
      }

      await chooser.setFiles(inputPath);
      await page.waitForTimeout(1_200);
      return true;
    } catch {
      return false;
    }
  }
}
