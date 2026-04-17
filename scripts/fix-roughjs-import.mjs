import { access, copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const roughDir = join(projectRoot, "node_modules", "roughjs", "bin");
const source = join(roughDir, "rough.js");
const target = join(roughDir, "rough");
const openColorPackagePath = join(
  projectRoot,
  "node_modules",
  "open-color",
  "package.json",
);
const openColorNodeShimPath = join(
  projectRoot,
  "node_modules",
  "open-color",
  "open-color.node.cjs",
);
const excalidrawDistDir = join(
  projectRoot,
  "node_modules",
  "@excalidraw",
  "excalidraw",
  "dist",
);

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function patchRoughImports(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await patchRoughImports(fullPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!(entry.name.endsWith(".js") || entry.name === "rough")) {
      continue;
    }

    const raw = await readFile(fullPath, "utf8");
    const patched = raw.replace(
      /(from\s+['"])(\.\.?(?:\/[^'".]+)+)(['"])/g,
      (_match, prefix, specifier, suffix) => `${prefix}${specifier}.js${suffix}`,
    );

    if (patched !== raw) {
      await writeFile(fullPath, patched, "utf8");
    }
  }
}

async function patchExcalidrawRoughImports(dir) {
  if (!(await exists(dir))) {
    return;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await patchExcalidrawRoughImports(fullPath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue;
    }

    const raw = await readFile(fullPath, "utf8");
    const patched = raw.replace(
      /(["'])roughjs\/bin\/([^"'./]+)\1/g,
      (_match, quote, moduleName) => `${quote}roughjs/bin/${moduleName}.js${quote}`,
    );

    if (patched !== raw) {
      await writeFile(fullPath, patched, "utf8");
    }
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

if (await exists(roughDir)) {
  await patchRoughImports(roughDir);
}

await patchExcalidrawRoughImports(excalidrawDistDir);

if (await exists(openColorPackagePath)) {
  const raw = await readFile(openColorPackagePath, "utf8");
  const pkg = JSON.parse(raw);

  await writeFile(
    openColorNodeShimPath,
    "module.exports = require('./open-color.json');\n",
    "utf8",
  );

  if (pkg.main !== "open-color.node.cjs") {
    pkg.main = "open-color.node.cjs";
    await writeFile(
      openColorPackagePath,
      `${JSON.stringify(pkg, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(
      "Repointed open-color main entry to open-color.node.cjs for Node ESM compatibility.\n",
    );
  }
}
