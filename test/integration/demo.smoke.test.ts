import { execFile } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("sales process demo smoke test", () => {
  it("runs the demo script with canonical snake_case MCP tool names", async () => {
    const repoRoot = process.cwd();
    const outDir = join(repoRoot, "tmp", "generated", "sales-process-overview");
    await rm(outDir, { recursive: true, force: true });

    const { stdout } = await execFileAsync(
      process.execPath,
      ["scripts/demo-sales-process-board.mjs"],
      {
        cwd: repoRoot,
        env: process.env,
        maxBuffer: 16 * 1024 * 1024,
      },
    );

    const summary = JSON.parse(stdout.trim());

    expect(summary.sceneId).toBe("sales-process-overview");
    expect(summary.validation?.ok).toBe(true);
    expect(summary.validation?.data?.valid).toBe(true);
    expect(summary.toolsUsed).toContain("scene_import_json");
    expect(summary.toolsUsed).toContain("elements_arrange");
    expect(summary.toolsUsed).toContain("scene_validate");
    expect(summary.pngError).toBeNull();
    expect(summary.pngPath).toBeTruthy();

    await access(summary.excalidrawPath);
    await access(summary.pngPath);

    const savedSummary = JSON.parse(
      await readFile(join(outDir, "summary.json"), "utf8"),
    );
    expect(savedSummary.sceneId).toBe("sales-process-overview");
  }, 120_000);
});
