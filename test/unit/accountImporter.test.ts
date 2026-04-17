import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountImporter } from "../../src/account/accountImporter.js";

class FakeFileChooser {
  constructor(private readonly onSetFiles: (inputPath: string) => Promise<void>) {}

  async setFiles(inputPath: string): Promise<void> {
    await this.onSetFiles(inputPath);
  }
}

class FakeLocator {
  constructor(
    private readonly countValue: () => number,
    private readonly onSetInputFiles?: (inputPath: string) => Promise<void>,
  ) {}

  async count(): Promise<number> {
    return this.countValue();
  }

  first(): { setInputFiles: (inputPath: string) => Promise<void> } {
    return {
      setInputFiles: async (inputPath: string) => {
        if (!this.onSetInputFiles) {
          throw new Error("No file input available");
        }
        await this.onSetInputFiles(inputPath);
      },
    };
  }
}

class FakePage {
  public currentUrl = "https://plus.excalidraw.com";
  public canvasCount = 1;
  public fileInputCount = 1;
  public allowStrategyCClick = true;
  public chooserAvailable = { B: false, C: false };
  public keyboardPresses: string[] = [];
  public waitCalls: number[] = [];
  public screenshots: string[] = [];
  public strategyAttempts: string[] = [];
  public lastInputPath: string | null = null;
  public errorToast = false;
  public errorToastSequence: boolean[] = [];

  private pendingChooserStrategy: "B" | "C" | null = null;
  private chooserWaiter:
    | { resolve: (chooser: FakeFileChooser) => void; reject: (error: Error) => void }
    | null = null;

  public readonly keyboard = {
    press: async (shortcut: string) => {
      this.keyboardPresses.push(shortcut);
      this.pendingChooserStrategy = "B";
      this.flushChooserWaiter();
    },
  };

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
  }

  url(): string {
    return this.currentUrl;
  }

  locator(selector: string): FakeLocator {
    if (selector === 'input[type="file"]') {
      return new FakeLocator(
        () => this.fileInputCount,
        async (inputPath) => {
          this.strategyAttempts.push("A");
          this.lastInputPath = inputPath;
        },
      );
    }

    return new FakeLocator(() => this.canvasCount);
  }

  async waitForTimeout(ms: number): Promise<void> {
    this.waitCalls.push(ms);
  }

  async screenshot(options: { path: string }): Promise<void> {
    this.screenshots.push(options.path);
  }

  async waitForEvent(eventName: string): Promise<FakeFileChooser> {
    if (eventName !== "filechooser") {
      throw new Error(`Unsupported event ${eventName}`);
    }

    return new Promise<FakeFileChooser>((resolve, reject) => {
      this.chooserWaiter = { resolve, reject };
      this.flushChooserWaiter();
    });
  }

  async evaluate(callback: unknown): Promise<boolean> {
    const source = String(callback);
    if (source.includes("(failed|error|invalid|unable|could not)")) {
      if (this.errorToastSequence.length > 0) {
        return this.errorToastSequence.shift() ?? false;
      }
      return this.errorToast;
    }

    if (source.includes("(open|import|load|file)")) {
      if (!this.allowStrategyCClick) {
        return false;
      }
      this.pendingChooserStrategy = "C";
      this.flushChooserWaiter();
      return true;
    }

    return false;
  }

  private flushChooserWaiter(): void {
    if (!this.chooserWaiter || !this.pendingChooserStrategy) {
      return;
    }

    const strategy = this.pendingChooserStrategy;
    const waiter = this.chooserWaiter;
    this.pendingChooserStrategy = null;
    this.chooserWaiter = null;

    if (!this.chooserAvailable[strategy]) {
      waiter.reject(new Error("No file chooser available"));
      return;
    }

    waiter.resolve(
      new FakeFileChooser(async (inputPath) => {
        this.strategyAttempts.push(strategy);
        this.lastInputPath = inputPath;
      }),
    );
  }
}

class FakeContext {
  public closed = false;

  constructor(private readonly pageInstance: FakePage) {}

  pages(): FakePage[] {
    return [this.pageInstance];
  }

  async newPage(): Promise<FakePage> {
    return this.pageInstance;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe("AccountImporter", () => {
  let rootDir: string;
  let inputPath: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "excalidraw-mcp-account-"));
    inputPath = join(rootDir, "fixture.excalidraw");
    await writeFile(inputPath, JSON.stringify({ ok: true }), "utf8");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  async function createImporter(page: FakePage): Promise<AccountImporter> {
    let nowMs = 0;
    const originalWaitForTimeout = page.waitForTimeout.bind(page);
    page.waitForTimeout = async (ms: number) => {
      nowMs += ms;
      await originalWaitForTimeout(ms);
    };

    return new AccountImporter(rootDir, {
      now: () => "2026-04-17T10:00:00.000Z",
      nowMs: () => nowMs,
      readinessPollMs: 5,
      interactiveLoginWaitMs: 0,
      importSettleMs: 0,
      launchPersistentContext: async (profilePath) => {
        await mkdir(profilePath, { recursive: true });
        await writeFile(join(profilePath, "Profile"), "ready", "utf8");
        return new FakeContext(page) as any;
      },
    });
  }

  it("returns ready login status when the authenticated canvas is available", async () => {
    const page = new FakePage();
    const importer = await createImporter(page);

    const result = await importer.loginSession({
      destination: "plus",
      session: "team session",
    });

    expect(result.status).toBe("ready");
    expect(result.reasonCode).toBe("READY");
    expect(result.session).toBe("team-session");

    const lastLogin = JSON.parse(
      await readFile(join(rootDir, "last-login-team-session.json"), "utf8"),
    );
    expect(lastLogin.reasonCode).toBe("READY");
  });

  it("returns checkpoint status when authentication is not ready", async () => {
    const page = new FakePage();
    page.canvasCount = 0;
    const importer = await createImporter(page);

    const login = await importer.loginSession({
      destination: "plus",
      session: "checkpoint",
    });
    expect(login.status).toBe("checkpoint_required");
    expect(login.reasonCode).toBe("AUTH_NOT_READY");

    const imported = await importer.importToAccount({
      inputPath,
      kind: "scene",
      destination: "plus",
      session: "checkpoint",
      allowInteractiveLogin: false,
    });
    expect(imported.status).toBe("checkpoint_required");
    expect(imported.reasonCode).toBe("AUTH_NOT_READY");
  });

  it("falls back across import strategies and persists history and status", async () => {
    const page = new FakePage();
    page.fileInputCount = 0;
    page.chooserAvailable.B = false;
    page.chooserAvailable.C = true;
    const importer = await createImporter(page);

    const login = await importer.loginSession({
      destination: "plus",
      session: "fallback",
    });
    expect(login.reasonCode).toBe("READY");

    const result = await importer.importToAccount({
      inputPath,
      kind: "scene",
      destination: "plus",
      session: "fallback",
      allowInteractiveLogin: false,
    });

    expect(result.status).toBe("success");
    expect(result.reasonCode).toBe("IMPORTED");
    expect(result.strategy).toBe("C");
    expect(page.strategyAttempts).toEqual(["C"]);

    const historyRaw = await readFile(join(rootDir, "import-history.jsonl"), "utf8");
    expect(historyRaw).toContain('"reasonCode":"IMPORTED"');

    const status = await importer.getLinkStatus("fallback");
    expect(status.sessions).toHaveLength(1);
    expect(status.sessions[0]?.lastLogin?.reasonCode).toBe("READY");
    expect(status.sessions[0]?.lastImport?.strategy).toBe("C");
    expect(status.sessions[0]?.hasProfileData).toBe(true);
  });

  it("classifies strategy failure and post-import verification failure with app-level reason codes", async () => {
    const strategyFailurePage = new FakePage();
    strategyFailurePage.fileInputCount = 0;
    strategyFailurePage.chooserAvailable.B = false;
    strategyFailurePage.chooserAvailable.C = false;
    strategyFailurePage.allowStrategyCClick = false;
    const strategyFailureImporter = await createImporter(strategyFailurePage);

    await expect(
      strategyFailureImporter.importToAccount({
        inputPath,
        kind: "scene",
        destination: "plus",
        session: "strategy-failure",
        allowInteractiveLogin: false,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      details: {
        reasonCode: "IMPORT_STRATEGY_FAILED",
      },
    });

    const verificationFailurePage = new FakePage();
    verificationFailurePage.fileInputCount = 1;
    verificationFailurePage.errorToastSequence = [false, true];
    const verificationFailureImporter = await createImporter(verificationFailurePage);

    await expect(
      verificationFailureImporter.importToAccount({
        inputPath,
        kind: "scene",
        destination: "plus",
        session: "verification-failure",
        allowInteractiveLogin: false,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      details: {
        reasonCode: "POST_IMPORT_VERIFICATION_FAILED",
      },
    });
  });
});
