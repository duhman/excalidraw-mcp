import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SceneService } from "../domain/sceneService.js";

function asJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const SKILL_REFERENCES_DIR = fileURLToPath(
  new URL("../../skills/excalidraw-agent/references/", import.meta.url),
);

interface SkillDoc {
  topic: string;
  filename: string;
  title: string;
}

function discoverSkillDocs(): SkillDoc[] {
  if (!existsSync(SKILL_REFERENCES_DIR)) return [];
  return readdirSync(SKILL_REFERENCES_DIR)
    .filter((entry) => entry.endsWith(".md"))
    .sort()
    .map((filename) => {
      const topic = filename.replace(/\.md$/, "");
      let title = topic;
      try {
        const text = readFileSync(join(SKILL_REFERENCES_DIR, filename), "utf8");
        const match = text.match(/^#\s+(.+)$/m);
        if (match) title = match[1].trim();
      } catch {
        // fall back to topic slug if file is unreadable at startup
      }
      return { topic, filename, title };
    });
}

export function registerResources(
  server: McpServer,
  sceneService: SceneService,
): void {
  server.registerResource(
    "scenes",
    "excalidraw://scenes",
    {
      title: "Scene Index",
      description: "List of available Excalidraw scenes",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.7,
        lastModified: new Date().toISOString(),
      },
    },
    async () => {
      const scenes = await sceneService.listScenes();
      return {
        contents: [
          {
            uri: "excalidraw://scenes",
            mimeType: "application/json",
            text: asJsonText({ scenes, count: scenes.length }),
          },
        ],
      };
    },
  );

  const makeSceneTemplate = (
    name: string,
    uriTemplate: string,
    description: string,
    load: (sceneId: string, uri: URL) => Promise<unknown>,
  ) => {
    server.registerResource(
      name,
      new ResourceTemplate(uriTemplate, {
        list: async () => {
          const scenes = await sceneService.listScenes();
          return {
            resources: scenes.map((scene) => ({
              uri: uriTemplate.replace("{sceneId}", scene.sceneId),
              name: `${name}:${scene.sceneId}`,
            })),
          };
        },
      }),
      {
        description,
        mimeType: "application/json",
        annotations: {
          audience: ["assistant"],
          priority: name === "scene-json" ? 0.4 : 0.8,
          lastModified: new Date().toISOString(),
        },
      },
      async (uri, variables) => {
        const sceneId = String(variables.sceneId ?? "");
        const payload = await load(sceneId, uri);
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: asJsonText(payload),
            },
          ],
        };
      },
    );
  };

  makeSceneTemplate(
    "scene-summary",
    "excalidraw://scene/{sceneId}/summary",
    "Compact scene summary with metadata and topology hints",
    async (sceneId) => {
      const scene = await sceneService.getScene(sceneId);
      const visibleElements = scene.elements.filter(
        (element) => !element.isDeleted,
      );
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
          zoom: scene.appState.zoom,
        },
      };
    },
  );

  makeSceneTemplate(
    "scene-analysis",
    "excalidraw://scene/{sceneId}/analysis",
    "Scene quality analysis with diagnostics, scoring, and summary metrics",
    async (sceneId) => {
      const analysis = await sceneService.analyzeScene(sceneId);
      return {
        sceneId,
        score: analysis.score,
        summary: analysis.summary,
        issues: analysis.issues,
        recommendedActions: analysis.recommendedActions,
      };
    },
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
        scene,
      };
    },
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
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      return {
        sceneId,
        count: elements.length,
        elements,
      };
    },
  );

  makeSceneTemplate(
    "scene-app-state",
    "excalidraw://scene/{sceneId}/app-state",
    "Scene appState payload",
    async (sceneId) => ({
      sceneId,
      appState: await sceneService.getAppState(sceneId),
    }),
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
        libraryItems,
      };
    },
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
        sizeEstimate:
          typeof file.dataURL === "string" ? file.dataURL.length : 0,
      }));

      return {
        sceneId,
        count: files.length,
        files,
      };
    },
  );

  const skillDocs = discoverSkillDocs();
  const docsLastModified = new Date().toISOString();

  server.registerResource(
    "docs-index",
    "excalidraw://docs",
    {
      title: "Excalidraw Skill Documentation",
      description:
        "Index of bundled Excalidraw integration, API, and troubleshooting references (mirrors skills/excalidraw-agent/references)",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.6,
        lastModified: docsLastModified,
      },
    },
    async () => ({
      contents: [
        {
          uri: "excalidraw://docs",
          mimeType: "application/json",
          text: asJsonText({
            count: skillDocs.length,
            topics: skillDocs.map((doc) => ({
              topic: doc.topic,
              title: doc.title,
              uri: `excalidraw://docs/${doc.topic}`,
            })),
          }),
        },
      ],
    }),
  );

  for (const doc of skillDocs) {
    const uri = `excalidraw://docs/${doc.topic}`;
    server.registerResource(
      `docs:${doc.topic}`,
      uri,
      {
        title: doc.title,
        description: `Excalidraw skill reference: ${doc.title}`,
        mimeType: "text/markdown",
        annotations: {
          audience: ["assistant"],
          priority: 0.5,
          lastModified: docsLastModified,
        },
      },
      async () => {
        const text = readFileSync(
          join(SKILL_REFERENCES_DIR, doc.filename),
          "utf8",
        );
        return {
          contents: [
            {
              uri,
              mimeType: "text/markdown",
              text,
            },
          ],
        };
      },
    );
  }
}
