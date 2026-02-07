import { randomUUID } from "node:crypto";
import type { SceneEnvelope, ScenePatchOperation } from "../types/contracts.js";
import { computeRevisionHash, normalizeElements, normalizeScene } from "../domain/validators.js";
import { AppError } from "../utils/errors.js";

function mapById(elements: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const element of elements) {
    map.set(element.id, element);
  }
  return map;
}

function mergeLibraryItems(existing: any[], incoming: any[]): any[] {
  const keyFor = (item: any): string => String(item?.id ?? item?.name ?? JSON.stringify(item));
  const merged = new Map<string, any>();

  for (const item of existing) {
    merged.set(keyFor(item), item);
  }

  for (const item of incoming) {
    merged.set(keyFor(item), item);
  }

  return [...merged.values()];
}

export class JsonEngine {
  normalize(scene: SceneEnvelope): SceneEnvelope {
    return normalizeScene(scene);
  }

  createElementsFromSkeleton(skeletons: any[]): any[] {
    return skeletons.map((skeleton) => ({
      id: typeof skeleton.id === "string" ? skeleton.id : randomUUID(),
      type: typeof skeleton.type === "string" ? skeleton.type : "rectangle",
      x: Number(skeleton.x ?? 0),
      y: Number(skeleton.y ?? 0),
      width: Number(skeleton.width ?? 120),
      height: Number(skeleton.height ?? 80),
      angle: Number(skeleton.angle ?? 0),
      strokeColor: skeleton.strokeColor ?? "#1e1e1e",
      backgroundColor: skeleton.backgroundColor ?? "transparent",
      fillStyle: skeleton.fillStyle ?? "hachure",
      strokeWidth: Number(skeleton.strokeWidth ?? 1),
      strokeStyle: skeleton.strokeStyle ?? "solid",
      roughness: Number(skeleton.roughness ?? 1),
      opacity: Number(skeleton.opacity ?? 100),
      groupIds: Array.isArray(skeleton.groupIds) ? skeleton.groupIds : [],
      frameId: skeleton.frameId ?? null,
      roundness: skeleton.roundness ?? null,
      seed: Number(skeleton.seed ?? Math.floor(Math.random() * 1000000)),
      version: Number(skeleton.version ?? 1),
      versionNonce: Number(skeleton.versionNonce ?? Math.floor(Math.random() * 1_000_000_000)),
      isDeleted: Boolean(skeleton.isDeleted),
      boundElements: Array.isArray(skeleton.boundElements) ? skeleton.boundElements : null,
      updated: Number(skeleton.updated ?? Date.now()),
      link: skeleton.link ?? null,
      locked: Boolean(skeleton.locked),
      ...skeleton
    }));
  }

  fitToContent(scene: SceneEnvelope): SceneEnvelope {
    const nonDeleted = scene.elements.filter((element) => !element.isDeleted);
    if (nonDeleted.length === 0) {
      return scene;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const element of nonDeleted) {
      const x = Number(element.x ?? 0);
      const y = Number(element.y ?? 0);
      const width = Number(element.width ?? 0);
      const height = Number(element.height ?? 0);

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    return this.normalize({
      ...scene,
      appState: {
        ...scene.appState,
        scrollX: -cx,
        scrollY: -cy,
        zoom: { value: 1 }
      }
    });
  }

  applyPatch(scene: SceneEnvelope, operations: ScenePatchOperation[]): { scene: SceneEnvelope; changedElementIds: string[] } {
    const next: SceneEnvelope = structuredClone(scene);
    const changedElementIds = new Set<string>();

    for (const operation of operations) {
      switch (operation.op) {
        case "setName": {
          next.metadata.name = operation.name;
          break;
        }

        case "addElements": {
          const current = next.elements;
          const created = this.createElementsFromSkeleton(operation.elements);
          const normalized = normalizeElements([...current, ...created]);
          for (const element of created) {
            if (element?.id) {
              changedElementIds.add(element.id);
            }
          }
          next.elements = normalized;
          break;
        }

        case "updateElements": {
          const currentById = mapById(next.elements);
          for (const update of operation.elements) {
            const existing = currentById.get(update.id);
            if (!existing) {
              throw new AppError("NOT_FOUND", `Element not found: ${update.id}`, 404, {
                elementId: update.id
              });
            }
            currentById.set(update.id, {
              ...existing,
              ...update.patch,
              version: Number(existing.version ?? 1) + 1,
              updated: Date.now()
            });
            changedElementIds.add(update.id);
          }
          next.elements = normalizeElements([...currentById.values()]);
          break;
        }

        case "deleteElements": {
          const ids = new Set(operation.elementIds);
          next.elements = next.elements
            .map((element) => {
              if (!ids.has(element.id)) {
                return element;
              }

              changedElementIds.add(element.id);
              if (operation.hardDelete) {
                return null;
              }

              return {
                ...element,
                isDeleted: true,
                version: Number(element.version ?? 1) + 1,
                updated: Date.now()
              };
            })
            .filter(Boolean) as any[];
          break;
        }

        case "setAppState": {
          next.appState = operation.merge
            ? { ...next.appState, ...operation.appState }
            : { ...operation.appState };
          break;
        }

        case "setLibrary": {
          next.libraryItems = operation.merge
            ? mergeLibraryItems(next.libraryItems as any, operation.libraryItems as any)
            : operation.libraryItems;
          break;
        }

        case "setFiles": {
          next.files = operation.merge ? { ...next.files, ...operation.files } : { ...operation.files };
          break;
        }

        default: {
          const unreachable: never = operation;
          throw new AppError("BAD_REQUEST", `Unsupported patch operation ${(unreachable as any).op}`, 400);
        }
      }
    }

    const normalized = this.normalize(next);
    normalized.metadata.revisionHash = computeRevisionHash(
      normalized.elements,
      normalized.appState,
      normalized.files,
      normalized.libraryItems
    );

    return {
      scene: normalized,
      changedElementIds: [...changedElementIds].sort()
    };
  }
}
