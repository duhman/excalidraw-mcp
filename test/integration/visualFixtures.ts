import type { ExcalidrawMcpServices } from "../../src/server/createServer.js";

export interface VisualFixture {
  name: string;
  sceneId: string;
  expectedLabels: string[];
  minScore: number;
  expectedFrames: number;
  expectedConnectors: number;
  build: (services: ExcalidrawMcpServices) => Promise<void>;
}

async function addText(
  services: ExcalidrawMcpServices,
  sceneId: string,
  input: {
    id: string;
    text: string;
    x: number;
    y: number;
    preset?: "title" | "legend" | "accent";
  },
) {
  await services.sceneService.patchScene(sceneId, [
    {
      op: "addElements",
      elements: [
        {
          id: input.id,
          type: "text",
          x: input.x,
          y: input.y,
          text: input.text,
          originalText: input.text,
          fontSize: input.preset === "title" ? 28 : 16,
          fontFamily: 1,
          autoResize: true,
        },
      ],
    } as any,
  ]);

  if (input.preset) {
    await services.sceneService.applyStylePreset(sceneId, {
      elementIds: [input.id],
      preset: input.preset,
      includeDependents: false,
    });
  }
}

export const visualFixtures: readonly VisualFixture[] = [
  {
    name: "simple flow",
    sceneId: "fixture-simple-flow",
    expectedLabels: ["Simple Flow", "Start", "Finish", "Legend"],
    minScore: 80,
    expectedFrames: 0,
    expectedConnectors: 1,
    build: async (services: ExcalidrawMcpServices) => {
      await services.sceneService.createScene({
        sceneId: "fixture-simple-flow",
        name: "Simple Flow",
      });

      await addText(services, "fixture-simple-flow", {
        id: "simple-title",
        text: "Simple Flow",
        x: 24,
        y: 16,
        preset: "title",
      });

      await services.sceneService.createNodes("fixture-simple-flow", {
        preset: "process",
        nodes: [
          {
            id: "start",
            label: "Start",
            body: "Collect inputs",
            x: 80,
            y: 120,
            width: 180,
            height: 96,
          },
          {
            id: "finish",
            label: "Finish",
            body: "Deliver output",
            x: 360,
            y: 120,
            width: 180,
            height: 96,
          },
        ],
      });

      await services.sceneService.layoutFlow("fixture-simple-flow", {
        elementIds: ["start", "finish"],
        direction: "horizontal",
        gap: 120,
        connect: true,
      });

      await addText(services, "fixture-simple-flow", {
        id: "simple-legend",
        text: "Legend: arrows show transition",
        x: 24,
        y: 280,
        preset: "legend",
      });
    },
  },
  {
    name: "process board",
    sceneId: "fixture-process-board",
    expectedLabels: ["Sales Process", "Lead", "Qualify", "Propose", "Close"],
    minScore: 78,
    expectedFrames: 1,
    expectedConnectors: 3,
    build: async (services: ExcalidrawMcpServices) => {
      await services.sceneService.createScene({
        sceneId: "fixture-process-board",
        name: "Sales Process",
      });

      await addText(services, "fixture-process-board", {
        id: "process-title",
        text: "Sales Process",
        x: 24,
        y: 16,
        preset: "title",
      });

      await services.sceneService.createNodes("fixture-process-board", {
        preset: "process",
        nodes: [
          { id: "lead", label: "Lead", body: "Source", x: 40, y: 120 },
          { id: "qualify", label: "Qualify", body: "Score fit", x: 280, y: 120 },
          { id: "propose", label: "Propose", body: "Shape offer", x: 520, y: 120 },
          { id: "close", label: "Close", body: "Sign deal", x: 760, y: 120 },
        ],
      });

      await services.sceneService.layoutFlow("fixture-process-board", {
        elementIds: ["lead", "qualify", "propose", "close"],
        direction: "horizontal",
        gap: 72,
        connect: true,
      });

      await services.sceneService.createFrame("fixture-process-board", {
        frameId: "pipeline-frame",
        name: "Pipeline",
        x: 20,
        y: 88,
        width: 980,
        height: 180,
        elementIds: ["lead", "qualify", "propose", "close"],
      });

      await addText(services, "fixture-process-board", {
        id: "process-legend",
        text: "Legend: arrows show handoff",
        x: 24,
        y: 300,
        preset: "legend",
      });
    },
  },
  {
    name: "swimlane board",
    sceneId: "fixture-swimlane-board",
    expectedLabels: ["Swimlane Board", "Discovery", "Provision", "Rollout"],
    minScore: 76,
    expectedFrames: 3,
    expectedConnectors: 2,
    build: async (services: ExcalidrawMcpServices) => {
      await services.sceneService.createScene({
        sceneId: "fixture-swimlane-board",
        name: "Swimlane Board",
      });

      await addText(services, "fixture-swimlane-board", {
        id: "swimlane-title",
        text: "Swimlane Board",
        x: 24,
        y: 16,
        preset: "title",
      });

      await services.sceneService.createNodes("fixture-swimlane-board", {
        preset: "note",
        nodes: [
          { id: "discovery", label: "Discovery", body: "Qualify needs", x: 70, y: 170 },
          { id: "provision", label: "Provision", body: "Set up workspace", x: 410, y: 170 },
          { id: "rollout", label: "Rollout", body: "Enable teams", x: 750, y: 170 },
        ],
      });

      await services.sceneService.layoutSwimlanes("fixture-swimlane-board", {
        laneArrangement: "columns",
        originX: 20,
        originY: 80,
        laneWidth: 300,
        laneHeight: 220,
        lanes: [
          { laneId: "lane-sales-frame", label: "Sales", elementIds: ["discovery"] },
          { laneId: "lane-ops-frame", label: "Operations", elementIds: ["provision"] },
          { laneId: "lane-cs-frame", label: "Customer Success", elementIds: ["rollout"] },
        ],
      });

      await services.sceneService.createConnector("fixture-swimlane-board", {
        sourceElementId: "discovery",
        targetElementId: "provision",
      });
      await services.sceneService.createConnector("fixture-swimlane-board", {
        sourceElementId: "provision",
        targetElementId: "rollout",
      });

      await addText(services, "fixture-swimlane-board", {
        id: "swimlane-legend",
        text: "Legend: frames act as lanes",
        x: 24,
        y: 320,
        preset: "legend",
      });
    },
  },
  {
    name: "frame-based architecture",
    sceneId: "fixture-framed-architecture",
    expectedLabels: ["Framed Architecture", "API", "Worker", "Retry Queue"],
    minScore: 76,
    expectedFrames: 2,
    expectedConnectors: 2,
    build: async (services: ExcalidrawMcpServices) => {
      await services.sceneService.createScene({
        sceneId: "fixture-framed-architecture",
        name: "Framed Architecture",
      });

      await addText(services, "fixture-framed-architecture", {
        id: "architecture-title",
        text: "Framed Architecture",
        x: 24,
        y: 16,
        preset: "title",
      });

      await services.sceneService.createNodes("fixture-framed-architecture", {
        preset: "process",
        nodes: [
          { id: "api", label: "API", body: "Accept jobs", x: 90, y: 160 },
          { id: "worker", label: "Worker", body: "Execute tasks", x: 280, y: 160 },
        ],
      });

      await services.sceneService.createNodes("fixture-framed-architecture", {
        preset: "note",
        nodes: [
          {
            id: "retry-queue",
            label: "Retry Queue",
            body: "Backoff and replay",
            x: 560,
            y: 170,
          },
        ],
      });

      await services.sceneService.createFrame("fixture-framed-architecture", {
        frameId: "compute-frame",
        name: "Execution",
        x: 40,
        y: 100,
        width: 420,
        height: 220,
        elementIds: ["api", "worker"],
      });
      await services.sceneService.createFrame("fixture-framed-architecture", {
        frameId: "queue-frame",
        name: "Recovery",
        x: 500,
        y: 100,
        width: 280,
        height: 180,
        elementIds: ["retry-queue"],
      });

      await services.sceneService.createConnector("fixture-framed-architecture", {
        sourceElementId: "api",
        targetElementId: "worker",
        label: "dispatches",
      });
      await services.sceneService.createConnector("fixture-framed-architecture", {
        sourceElementId: "worker",
        targetElementId: "retry-queue",
        label: "retries",
      });

      await addText(services, "fixture-framed-architecture", {
        id: "architecture-legend",
        text: "Legend: frames group related responsibilities",
        x: 24,
        y: 340,
        preset: "legend",
      });
    },
  },
];

export function fixtureGoldenSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeSvgNumbers(value: string): string {
  return value.replace(/-?\d*\.?\d+/g, (raw) => {
    const numeric = Number.parseFloat(raw);
    if (!Number.isFinite(numeric)) {
      return raw;
    }

    const roundedToHalf = Math.round(numeric * 2) / 2;
    if (Math.abs(roundedToHalf - Math.trunc(roundedToHalf)) < 1e-9) {
      return String(Math.trunc(roundedToHalf));
    }

    return roundedToHalf.toFixed(1).replace(/\.0$/, "");
  });
}

export function canonicalizeSvg(svg: string): string {
  const idMap = new Map<string, string>();
  let index = 0;

  let canonical = svg.replace(/\bid="([^"]+)"/g, (_match, id: string) => {
    const replacement = `id-${index}`;
    index += 1;
    idMap.set(id, replacement);
    return `id="${replacement}"`;
  });

  for (const [original, replacement] of idMap.entries()) {
    canonical = canonical
      .replaceAll(`url(#${original})`, `url(#${replacement})`)
      .replaceAll(`href="#${original}"`, `href="#${replacement}"`)
      .replaceAll(`xlink:href="#${original}"`, `xlink:href="#${replacement}"`);
  }

  canonical = canonical.replace(/\sd="[^"]*"/g, ' d="PATH"');
  canonical = canonical.replace(
    /\b(transform|viewBox|x|y|width|height|rx|ry)="([^"]+)"/g,
    (_match, attribute: string, value: string) =>
      `${attribute}="${normalizeSvgNumbers(value)}"`,
  );
  canonical = canonical
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();

  return `${canonical}\n`;
}
