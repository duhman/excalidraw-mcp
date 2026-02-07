import { resolve, relative, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { AppError } from "./errors.js";

export function ensureInsideRoot(root: string, candidate: string): string {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(candidate);
  const rel = relative(absoluteRoot, absoluteCandidate);

  if (rel.startsWith("..") || rel.includes(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new AppError("BAD_REQUEST", `Path escapes root: ${candidate}`, 400, {
      root: absoluteRoot,
      candidate: absoluteCandidate
    });
  }

  return absoluteCandidate;
}

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export function sanitizeSceneId(sceneId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(sceneId)) {
    throw new AppError("BAD_REQUEST", "Invalid sceneId format", 400, { sceneId });
  }

  return sceneId;
}
