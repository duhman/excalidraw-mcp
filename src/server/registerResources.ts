import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SceneService } from "../domain/sceneService.js";

function asJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function registerResources(server: McpServer, sceneService: SceneService): void {
  server.registerResource(
    "scenes",
    "excalidraw://scenes",
    {
      title: "Scene Index",
      description: "List of available Excalidraw scenes",
      mimeType: "application/json"
    },
    async () => {
      const scenes = await sceneService.listScenes();
      return {
        contents: [
          {
            uri: "excalidraw://scenes",
            mimeType: "application/json",
            text: asJsonText({ scenes, count: scenes.length })
          }
        ]
      };
    }
  );

  const makeSceneTemplate = (
    name: string,
    uriTemplate: string,
    description: string,
    load: (sceneId: string, uri: URL) => Promise<unknown>
  ) => {
    server.registerResource(
      name,
      new ResourceTemplate(uriTemplate, {
        list: async () => {
          const scenes = await sceneService.listScenes();
          return {
            resources: scenes.map((scene) => ({
              uri: uriTemplate.replace("{sceneId}", scene.sceneId),
              name: `${name}:${scene.sceneId}`
            }))
          };
        }
      }),
      {
        description,
        mimeType: "application/json"
      },
      async (uri, variables) => {
        const sceneId = String(variables.sceneId ?? "");
        const payload = await load(sceneId, uri);
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: asJsonText(payload)
            }
          ]
        };
      }
    );
  };

  makeSceneTemplate(
    "scene-summary",
    "excalidraw://scene/{sceneId}/summary",
    "Compact scene summary with metadata and topology hints",
    async (sceneId) => {
      const scene = await sceneService.getScene(sceneId);
      const visibleElements = scene.elements.filter((element) => !element.isDeleted);
      const typeHistogram: Record<string, number> = {};
      for (const element of visibleElements) {
        const type = String(element.type ?? "unknown");
        typeHistogram[type] = (typeHistogram[type] ?? 0) + 1;
      }

      return {
        metadata: scene.metadata,
        visibleElementCount: visibleElements.length,
        deletedElementCount: scene.elements.length - visibleElements.length,
        typeHistogram,
        appStateSubset: {
          theme: scene.appState.theme,
          viewModeEnabled: scene.appState.viewModeEnabled,
          scrollX: scene.appState.scrollX,
          scrollY: scene.appState.scrollY,
          zoom: scene.appState.zoom
        }
      };
    }
  );

  makeSceneTemplate(
    "scene-json",
    "excalidraw://scene/{sceneId}/json",
    "Complete Excalidraw scene payload",
    async (sceneId) => {
      const scene = await sceneService.getScene(sceneId);
      return {
        schemaVersion: 1,
        revisionHash: scene.metadata.revisionHash,
        scene
      };
    }
  );

  makeSceneTemplate(
    "scene-elements",
    "excalidraw://scene/{sceneId}/elements",
    "Scene elements list with optional URI query parameter limit",
    async (sceneId, uri) => {
      const limitParam = uri.searchParams.get("limit");
      const limit = limitParam ? Number(limitParam) : undefined;
      const elements = await sceneService.listElements(sceneId, {
        includeDeleted: true,
        limit: Number.isFinite(limit) ? limit : undefined
      });
      return {
        sceneId,
        count: elements.length,
        elements
      };
    }
  );

  makeSceneTemplate(
    "scene-app-state",
    "excalidraw://scene/{sceneId}/app-state",
    "Scene appState payload",
    async (sceneId) => ({
      sceneId,
      appState: await sceneService.getAppState(sceneId)
    })
  );

  makeSceneTemplate(
    "scene-library",
    "excalidraw://scene/{sceneId}/library",
    "Scene library items",
    async (sceneId) => {
      const libraryItems = await sceneService.getLibrary(sceneId);
      return {
        sceneId,
        count: libraryItems.length,
        libraryItems
      };
    }
  );

  makeSceneTemplate(
    "scene-files",
    "excalidraw://scene/{sceneId}/files",
    "Scene binary files metadata",
    async (sceneId) => {
      const scene = await sceneService.getScene(sceneId);
      const files = Object.values(scene.files).map((file: any) => ({
        id: file.id,
        mimeType: file.mimeType,
        created: file.created,
        lastRetrieved: file.lastRetrieved,
        sizeEstimate: typeof file.dataURL === "string" ? file.dataURL.length : 0
      }));

      return {
        sceneId,
        count: files.length,
        files
      };
    }
  );
}
