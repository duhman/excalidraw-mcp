import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function ensureBuiltDist(): Promise<void> {
  const registerToolsPath = "dist/src/server/registerTools.js";
  const current = await readFile(registerToolsPath, "utf8").catch(() => null);
  if (
    current?.includes('"nodes_compose"') &&
    current.includes('"layout_swimlanes"') &&
    current.includes('"layout_polish"')
  ) {
    return;
  }

  await execFileAsync(npmCommand, ["run", "build"], {
    cwd: process.cwd(),
    env: process.env,
  });
}

describe("Compiled dist stdio smoke", () => {
  it(
    "starts the built server and exercises the additive tool surface over stdio",
    async () => {
      await ensureBuiltDist();
      const { stdout, stderr } = await execFileAsync(process.execPath, [
        "scripts/dist-stdio-smoke.mjs",
      ], {
        cwd: process.cwd(),
        env: process.env,
      });

      expect(stderr.includes("Failed to start")).toBe(false);
      expect(stdout).toContain("dist stdio smoke passed");
    },
    120_000,
  );
});
