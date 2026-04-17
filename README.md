# excalidraw-mcp

`excalidraw-mcp` is a self-hosted MCP server for programmatic Excalidraw authoring.

The goal is not just to mutate scene JSON. The server gives agents a safer abstraction over Excalidraw so they can:

- create and refine scenes without hand-managing fragile internals
- use higher-level authoring helpers for nodes, flows, swimlanes, frames, layers, and styling
- analyze quality before export
- apply deterministic cleanup before final polish
- export offline through a local Excalidraw bundle
- optionally import scenes into authenticated Excalidraw / Excalidraw+ accounts

## Documentation

- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Tool reference: [`docs/TOOL_REFERENCE.md`](docs/TOOL_REFERENCE.md)
- Agent playbook: [`docs/AGENT_PLAYBOOK.md`](docs/AGENT_PLAYBOOK.md)
- Account linking: [`docs/ACCOUNT_LINKING.md`](docs/ACCOUNT_LINKING.md)

## What’s In The Server

- Scene lifecycle, patching, app state, files, library items, Mermaid conversion, and exports
- Deterministic layout helpers:
  - `elements_arrange`
  - `layout_flow`
  - `layout_swimlanes`
  - `layout_polish`
- Higher-level authoring helpers:
  - `nodes_create`
  - `nodes_compose`
  - `frames_create`
  - `frames_assign_elements`
  - `styles_apply_preset`
  - `layers_reorder`
- Quality and repair helpers:
  - `scene_validate`
  - `scene_normalize`
  - `scene_analyze`
- Resources including:
  - `excalidraw://scenes`
  - `excalidraw://scene/{sceneId}/summary`
  - `excalidraw://scene/{sceneId}/analysis`
  - `excalidraw://scene/{sceneId}/json`
- Prompts for planning, refinement, conversion, and review

## Agent Workflow

Recommended loop for agents:

1. `scene_analyze`
2. Deterministic helpers:
   `nodes_compose`, `layout_swimlanes`, `layout_flow`, `layout_polish`, `styles_apply_preset`, `frames_assign_elements`
3. `scene_validate`
4. `export_svg` / `export_png` / `export_webp`

Use `scene_normalize` first whenever analysis shows structural issues such as broken bindings, missing container backlinks, missing files, or invalid geometry.

If the client supports MCP prompts, start with `agent-workflow-guide` for an in-band summary of the preferred tool-selection strategy.

### Worked Example: Semantic Node

```json
{
  "name": "nodes_compose",
  "arguments": {
    "sceneId": "system-map",
    "preset": "process",
    "nodes": [
      {
        "nodeId": "api",
        "x": 120,
        "y": 140,
        "width": 240,
        "minHeight": 132,
        "title": "API Gateway",
        "body": "Receives requests, validates auth, and routes traffic.",
        "iconText": "API"
      }
    ]
  }
}
```

### Worked Example: Swimlanes

```json
{
  "name": "layout_swimlanes",
  "arguments": {
    "sceneId": "system-map",
    "laneArrangement": "columns",
    "originX": 40,
    "originY": 80,
    "laneWidth": 320,
    "laneHeight": 260,
    "lanes": [
      { "laneId": "lane-intake", "label": "Intake", "elementIds": ["api"] },
      { "laneId": "lane-processing", "label": "Processing", "elementIds": ["worker"] }
    ]
  }
}
```

## Quality Model

`scene_analyze` reports:

- scene bounds and graph summary
- overlaps and dense clusters
- off-canvas elements
- connector crossings
- typography inconsistency
- unreadable text
- missing titles and legends
- container/frame/file integrity issues
- `recommendedActions` that point to deterministic next tools

`layout_polish` is intentionally conservative. It resolves deterministic layout problems like overlap, spacing, connector label recentering, and supporting-text rebalance without inventing new semantic content.

## Presets

Built-in presets:

- `process`
- `decision`
- `note`
- `title`
- `legend`
- `accent`
- `swimlane`
- `boundary`
- `supporting_text`

All higher-level authoring helpers share the same spacing and typography scale:

- spacing: `8 / 16 / 24 / 32 / 48 / 72`
- text: `30 / 18 / 16 / 14`
- node padding: `20`
- frame/lane padding: `24`

## Runtime Model

- JSON engine for deterministic scene operations and normalization
- Local browser engine (Playwright + Chromium) for offline Excalidraw-native export
- Local Excalidraw runtime bundle checked into the repo for export/repair parity
- Workspace-backed storage under `.excalidraw-mcp/`

## Install

```bash
npm install
```

Playwright browser install if needed:

```bash
npx playwright install chromium
```

## Run

### Stdio

```bash
npm run dev
# or
npm run start:stdio
```

### HTTP

```bash
npm run dev:http
# or
npm run start:http
```

Optional environment variables:

- `MCP_HTTP_HOST` default `127.0.0.1`
- `MCP_HTTP_PORT` default `8788`
- `MCP_HTTP_PATH` default `/mcp`
- `MCP_WORKSPACE_ROOT` default current working directory

## Verification

Main local gate:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Extra smoke paths:

```bash
npm run smoke:dist
npm run smoke:account:plus
npm run smoke:account:excalidraw
```

Notes:

- `smoke:dist` exercises the built `dist` server over stdio.
- `smoke:account:*` are opt-in manual checks and require a real authenticated browser session.

## Visual Regression

The repo includes structural fixture tests and committed canonicalized SVG goldens for:

- simple flow
- process board
- swimlane board
- frame-based architecture

Refresh goldens intentionally only:

```bash
UPDATE_GOLDENS=1 npx vitest run test/integration/visual.goldens.test.ts
```

## Account Linking Quick Start

1. Prepare a headed login session:

```json
{
  "name": "account_login_session",
  "arguments": {
    "destination": "plus",
    "mode": "headed",
    "session": "main-profile",
    "timeoutSec": 300,
    "closeOnComplete": false
  }
}
```

2. Import a scene:

```json
{
  "name": "account_import_scene",
  "arguments": {
    "sceneId": "my-scene",
    "destination": "plus",
    "mode": "headed",
    "session": "main-profile",
    "allowInteractiveLogin": false
  }
}
```

3. Inspect recent status:

```json
{
  "name": "account_link_status",
  "arguments": {
    "session": "main-profile"
  }
}
```

Account results now include explicit `reasonCode` values like `READY`, `AUTH_NOT_READY`, `IMPORTED`, `IMPORT_STRATEGY_FAILED`, and `POST_IMPORT_VERIFICATION_FAILED`.

## Demo

Generate a realistic sales-process board through the MCP server itself:

```bash
node scripts/demo-sales-process-board.mjs
```

Artifacts are written under `tmp/generated/sales-process-overview/`.

## For Agent Authors

If you are wiring this server into another agent stack, the best onboarding path is:

1. read [`docs/AGENT_PLAYBOOK.md`](docs/AGENT_PLAYBOOK.md)
2. inspect [`docs/TOOL_REFERENCE.md`](docs/TOOL_REFERENCE.md)
3. use the `agent-workflow-guide` prompt
4. prefer `nodes_compose`, `layout_swimlanes`, `layout_flow`, `layout_polish`, and `styles_apply_preset` over raw patching
