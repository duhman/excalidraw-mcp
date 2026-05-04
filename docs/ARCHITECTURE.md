# Architecture

## Overview

`excalidraw-mcp` is a TypeScript MCP server that turns Excalidraw into an agent-friendly authoring backend.

The runtime is intentionally split into:

- deterministic scene/domain logic for safe authoring and repair
- Excalidraw-native runtime helpers for normalization/export parity
- browser-backed export and account-link automation

## Core Layers

### Server Layer

Files:

- `src/server/createServer.ts`
- `src/server/registerTools.ts`
- `src/server/registerResources.ts`
- `src/server/registerPrompts.ts`

Responsibilities:

- initialize the MCP server and declare capabilities
- register the canonical snake_case tool surface
- expose read-only scene resources
- expose planning/review prompts that steer agents toward deterministic helpers first

### Domain Layer

Files:

- `src/domain/sceneStore.ts`
- `src/domain/sceneService.ts`
- `src/domain/validators.ts`
- `src/domain/diagramQuality.ts`
- `src/domain/stylePresets.ts`

Responsibilities:

- scene persistence in `.excalidraw-mcp/scenes/*.excalidraw.json`
- scene lifecycle and patch operations
- file/library handling
- higher-level authoring helpers
- layout transforms
- structural validation and repair
- quality analysis, scoring, and recommended next actions

Important behaviors in this layer:

- normalization repairs Excalidraw invariants instead of just accepting raw input
- dependency-aware layout keeps grouped semantic children and bound content together
- styling and semantic authoring share the same spacing/type scale
- `scene_analyze` stays read-only and emits `recommendedActions`
- `layout_polish` applies deterministic cleanup only

### Engine Layer

Files:

- `src/engines/jsonEngine.ts`
- `src/engines/browserEngine.ts`
- `src/engines/browser/page/excalidrawHost.html`
- `src/excalidraw/native/excalidrawNodeApi.ts`

Responsibilities:

- JSON engine for deterministic mutation/patch workflows
- browser engine for `svg/png/webp` export
- local Excalidraw host/runtime bundle so export works without runtime CDN dependencies
- Excalidraw-native restore/export helpers shared between browser and Node-side flows

### Export Layer

Files:

- `src/export/exportService.ts`

Responsibilities:

- unified export interface
- checksum metadata
- JSON export from scene data
- browser-engine delegation for rendered exports

### Account Linking Layer

Files:

- `src/account/accountImporter.ts`

Responsibilities:

- persistent browser profiles per session
- login readiness checks
- scene/library import through real UI automation
- strategy cascade `A/B/C`
- screenshot and history persistence
- explicit app-level reason codes for auth readiness, strategy failure, and post-import verification

## High-Level Authoring Surface

The server keeps primitive tools for full control, but the preferred authoring path is additive:

- `nodes_compose`
- `layout_swimlanes`
- `layout_flow`
- `layout_polish`
- `frames_create`
- `frames_assign_elements`
- `styles_apply_preset`
- `layers_reorder`

These tools are built on shared preset/layout tokens:

- spacing `8 / 16 / 24 / 32 / 48 / 72`
- text `30 / 18 / 16 / 14`
- node padding `20`
- frame/lane padding `24`

## Quality Pipeline

### Structural Repair

`scene_normalize` and the internal normalization path repair hard scene invariants such as:

- invalid geometry
- missing frame targets
- missing image files
- connector bindings and backreferences
- missing container-text backlinks

### Analysis

`scene_analyze` returns:

- scene bounds and graph summary
- quality issues with codes/severity
- score
- `recommendedActions`

Covered diagnostics include:

- overlaps
- off-canvas placement
- crowding/density
- connector crossings
- unreadable text
- typography inconsistency
- missing titles/legends
- container/frame/file issues

### Deterministic Cleanup

`layout_polish` is the read-analysis companion for safe refinement. It can:

- resolve non-frame overlaps
- spread dense clusters
- recenter connector labels and refresh connector geometry
- rebalance existing title/legend placement

It intentionally does not invent missing semantic content.

## Resources

Important resource URIs:

- `excalidraw://scenes`
- `excalidraw://scene/{sceneId}/summary`
- `excalidraw://scene/{sceneId}/analysis`
- `excalidraw://scene/{sceneId}/json`
- `excalidraw://scene/{sceneId}/elements`
- `excalidraw://scene/{sceneId}/app-state`
- `excalidraw://scene/{sceneId}/library`
- `excalidraw://scene/{sceneId}/files`

## Persistent Data Layout

All runtime data lives under `.excalidraw-mcp/`:

- `scenes/`
- `account/profiles/`
- `account/artifacts/`
- `account/import-history.jsonl`
- `account/last-*.json`

## Testing And Release Trust

Protection layers:

- unit tests for authoring, normalization, quality analysis, and account-link logic
- integration tests over in-memory MCP transport
- browser export tests
- agent release E2E tests over MCP transport
- demo smoke
- compiled `dist` stdio smoke
- structural visual fixtures
- canonicalized SVG goldens
- CI on push and pull request

The release bar is:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run smoke:dist`
