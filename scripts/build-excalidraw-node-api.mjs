import { build } from "esbuild";

await build({
  entryPoints: ["src/excalidraw/native/excalidrawNodeApi.ts"],
  outfile: "src/excalidraw/native/excalidrawNodeApi.bundle.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  logLevel: "silent",
});
