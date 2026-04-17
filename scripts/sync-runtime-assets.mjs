import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const runtimeAssets = [
  [
    "src/excalidraw/native/excalidrawNodeApi.bundle.js",
    "dist/src/excalidraw/native/excalidrawNodeApi.bundle.js",
  ],
  [
    "src/excalidraw/native/excalidrawNodeApi.bundle.d.ts",
    "dist/src/excalidraw/native/excalidrawNodeApi.bundle.d.ts",
  ],
  [
    "src/engines/browser/page/excalidrawHost.html",
    "dist/src/engines/browser/page/excalidrawHost.html",
  ],
  [
    "src/engines/browser/page/excalidrawApi.ts",
    "dist/src/engines/browser/page/excalidrawApi.ts",
  ],
];

for (const [sourcePath, targetPath] of runtimeAssets) {
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}
