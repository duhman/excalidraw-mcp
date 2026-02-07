import { access, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const roughDir = join(projectRoot, "node_modules", "roughjs", "bin");
const source = join(roughDir, "rough.js");
const target = join(roughDir, "rough");

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const sourceExists = await exists(source);
if (!sourceExists) {
  process.exit(0);
}

const targetExists = await exists(target);
if (!targetExists) {
  await copyFile(source, target);
  process.stdout.write("Created roughjs/bin/rough shim for Node ESM compatibility.\n");
}
