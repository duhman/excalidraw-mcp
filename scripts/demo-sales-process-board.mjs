import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = process.cwd();
const outDir = process.env.DEMO_OUT_DIR ?? join(repoRoot, 'tmp', 'generated', 'sales-process-overview');
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const transportArgs = [tsxCli, 'src/index.ts', '--transport', 'stdio'];

function assertOk(result, label) {
  if (result?.isError) {
    throw new Error(`${label} failed: ${JSON.stringify(result, null, 2)}`);
  }
  return result;
}

function dataOf(result) {
  return result?.structuredContent?.data ?? {};
}

function textNode(id, text, x, y, width = 150, height = 24, fontSize = 20, containerId = undefined) {
  return {
    id,
    type: 'text',
    x,
    y,
    width,
    height,
    text,
    originalText: text,
    fontSize,
    fontFamily: 1,
    strokeColor: '#1e1e1e',
    textAlign: 'center',
    verticalAlign: 'middle',
    autoResize: true,
    ...(containerId ? { containerId } : {})
  };
}

function shapeNode({ id, x, y, width = 180, height = 84, backgroundColor = '#a5d8ff', textId }) {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width,
    height,
    roundness: { type: 3 },
    backgroundColor,
    fillStyle: 'solid',
    strokeColor: '#1e1e1e',
    strokeWidth: 2,
    roughness: 1,
    boundElements: textId ? [{ id: textId, type: 'text' }] : []
  };
}

const client = new Client({ name: 'sales-process-demo', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: transportArgs,
  env: {
    ...process.env,
    MCP_WORKSPACE_ROOT: process.env.MCP_WORKSPACE_ROOT ?? repoRoot
  }
});

const sceneId = 'sales-process-overview';

const mainStages = [
  { id: 'lead', textId: 'label_lead', label: 'Lead Intake', color: '#cfe8ff', x: 80, y: 160 },
  { id: 'qualify', textId: 'label_qualify', label: 'Qualification', color: '#cfe8ff', x: 280, y: 160 },
  { id: 'discovery', textId: 'label_discovery', label: 'Discovery Call', color: '#d9f7be', x: 480, y: 160 },
  { id: 'demo', textId: 'label_demo', label: 'Demo / Solution Fit', color: '#d9f7be', x: 680, y: 160 },
  { id: 'proposal', textId: 'label_proposal', label: 'Proposal', color: '#fff3bf', x: 880, y: 160 },
  { id: 'review', textId: 'label_review', label: 'Negotiation + Review', color: '#ffd8a8', x: 1080, y: 160 },
  { id: 'won', textId: 'label_won', label: 'Closed Won', color: '#b2f2bb', x: 1280, y: 160 },
  { id: 'handoff', textId: 'label_handoff', label: 'Implementation Handoff', color: '#d0bfff', x: 1480, y: 160 }
];

const sideStages = [
  { id: 'nurture', textId: 'label_nurture', label: 'Nurture / Recycle', color: '#fff3bf', x: 460, y: 390 },
  { id: 'lost', textId: 'label_lost', label: 'Closed Lost', color: '#ffc9c9', x: 1140, y: 390 }
];

await mkdir(outDir, { recursive: true });
await client.connect(transport);

try {
  await client.callTool({
    name: 'scene_import_json',
    arguments: {
      sceneId,
      merge: false,
      openAfterImport: true,
      payload: {
        type: 'excalidraw',
        version: 2,
        source: 'https://excalidraw.com',
        elements: [
          { id: 'band_main', type: 'rectangle', x: 40, y: 120, width: 1680, height: 170, backgroundColor: '#f1f8ff', fillStyle: 'solid', strokeColor: '#d0ebff', strokeWidth: 1, roughness: 0, opacity: 100 },
          { id: 'band_alt', type: 'rectangle', x: 330, y: 350, width: 1060, height: 120, backgroundColor: '#fff9db', fillStyle: 'solid', strokeColor: '#ffe066', strokeWidth: 1, roughness: 0, opacity: 100 },
          textNode('title', 'Sales Process Overview', 60, 30, 520, 40, 28),
          textNode('subtitle', 'Programmatically generated via excalidraw-mcp to test LLM-driven process mapping', 60, 70, 760, 24, 18),
          textNode('lane_main', 'Core revenue path', 60, 126, 220, 24, 18),
          textNode('lane_alt', 'Alternative outcomes', 350, 356, 220, 24, 18),
          textNode('legend', 'Example scope: from lead intake through handoff, plus recycle / lost branches', 60, 520, 920, 22, 16)
        ],
        appState: { viewBackgroundColor: '#ffffff' },
        files: {},
        libraryItems: []
      }
    }
  }).then((r) => assertOk(r, 'scene_import_json'));

  await client.callTool({
    name: 'elements_create',
    arguments: {
      sceneId,
      elements: [
        ...mainStages.map((stage) => shapeNode(stage)),
        ...sideStages.map((stage) => shapeNode(stage))
      ]
    }
  }).then((r) => assertOk(r, 'elements_create shapes'));

  await client.callTool({
    name: 'elements_arrange',
    arguments: {
      sceneId,
      elementIds: mainStages.map((stage) => stage.id),
      mode: 'stack',
      axis: 'x',
      gap: 70,
      anchor: 'center'
    }
  }).then((r) => assertOk(r, 'elements_arrange main flow'));

  const elementsResult = await client.callTool({
    name: 'elements_list',
    arguments: { sceneId, limit: 500 }
  }).then((r) => assertOk(r, 'elements_list'));

  const elements = dataOf(elementsResult).elements;
  const byId = new Map(elements.map((element) => [element.id, element]));

  const textElements = [];
  for (const stage of [...mainStages, ...sideStages]) {
    const shape = byId.get(stage.id);
    textElements.push(
      textNode(
        stage.textId,
        stage.label,
        shape.x + 12,
        shape.y + (shape.height / 2) - 12,
        shape.width - 24,
        24,
        18,
        stage.id
      )
    );
  }

  await client.callTool({
    name: 'elements_create',
    arguments: {
      sceneId,
      elements: textElements
    }
  }).then((r) => assertOk(r, 'elements_create labels'));

  const mainConnectorPairs = [
    ['lead', 'qualify'],
    ['qualify', 'discovery'],
    ['discovery', 'demo'],
    ['demo', 'proposal'],
    ['proposal', 'review'],
    ['review', 'won'],
    ['won', 'handoff']
  ];

  for (const [sourceElementId, targetElementId] of mainConnectorPairs) {
    await client.callTool({
      name: 'connectors_create',
      arguments: { sceneId, sourceElementId, targetElementId }
    }).then((r) => assertOk(r, `connectors_create ${sourceElementId}->${targetElementId}`));
  }

  await client.callTool({
    name: 'connectors_create',
    arguments: {
      sceneId,
      sourceElementId: 'qualify',
      targetElementId: 'nurture'
    }
  }).then((r) => assertOk(r, 'connector branch nurture'));

  await client.callTool({
    name: 'connectors_create',
    arguments: {
      sceneId,
      sourceElementId: 'review',
      targetElementId: 'lost'
    }
  }).then((r) => assertOk(r, 'connector branch lost'));

  await client.callTool({
    name: 'elements_create',
    arguments: {
      sceneId,
      elements: [
        textNode('note_recycle', 'recycle if not ready', 470, 300, 180, 20, 14),
        textNode('note_lost', 'drop out after review', 1100, 300, 180, 20, 14)
      ]
    }
  }).then((r) => assertOk(r, 'elements_create branch notes'));

  await client.callTool({
    name: 'view_fit_to_content',
    arguments: { sceneId }
  }).then((r) => assertOk(r, 'view_fit_to_content'));

  const validation = await client.callTool({
    name: 'scene_validate',
    arguments: { sceneId }
  }).then((r) => assertOk(r, 'scene_validate'));

  const validationData = validation.structuredContent;

  const jsonExport = await client.callTool({
    name: 'export_json',
    arguments: { sceneId }
  }).then((r) => assertOk(r, 'export_json'));
  const jsonData = dataOf(jsonExport);
  const jsonBuffer = Buffer.from(jsonData.base64, 'base64');
  const excalidrawPath = join(outDir, 'sales-process-overview.excalidraw');
  await writeFile(excalidrawPath, jsonBuffer);

  let pngPath = null;
  let pngError = null;
  try {
    const pngExport = await client.callTool({
      name: 'export_png',
      arguments: { sceneId, options: { padding: 24, darkMode: false, maxWidthOrHeight: 2200 } }
    }).then((r) => assertOk(r, 'export_png'));
    const pngData = dataOf(pngExport);
    pngPath = join(outDir, 'sales-process-overview.png');
    await writeFile(pngPath, Buffer.from(pngData.base64, 'base64'));
  } catch (error) {
    pngError = String(error instanceof Error ? error.message : error);
  }

  const summary = {
    sceneId,
    outputDir: outDir,
    excalidrawPath,
    pngPath,
    pngError,
    validation: validationData,
    toolsUsed: [
      'scene_import_json',
      'elements_create',
      'elements_arrange',
      'connectors_create',
      'view_fit_to_content',
      'scene_validate',
      'export_json',
      'export_png'
    ]
  };

  await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await client.close();
}
