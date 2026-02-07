# Architecture

## Overview
`excalidraw-mcp` is a TypeScript MCP server that exposes Excalidraw scene operations, resources, prompts, exports, and account-linked imports.

Core runtime model:
- `JSON engine` for deterministic scene mutations and normalization.
- `Browser engine` (Playwright/Chromium) for high-fidelity visual export.
- `Workspace-backed storage` for scenes and account link artifacts.

## Major Components

### Server Layer
- `src/server/createServer.ts`
- `src/server/registerTools.ts`
- `src/server/registerResources.ts`
- `src/server/registerPrompts.ts`

Responsibilities:
- MCP server initialization and capability declaration.
- Tool/resource/prompt registration.
- Dependency wiring for domain and engine services.

### Transport Layer
- `src/transports/stdio.ts`
- `src/transports/http.ts`

Responsibilities:
- `stdio` transport for local clients.
- Streamable HTTP transport with session lifecycle (`POST` initialize/calls, `GET` SSE/stream, `DELETE` close).
- Host/origin safety checks for HTTP mode.

### Domain Layer
- `src/domain/sceneStore.ts`
- `src/domain/sceneService.ts`
- `src/domain/validators.ts`
- `src/domain/diagramQuality.ts`

Responsibilities:
- Scene persistence (`.excalidraw-mcp/scenes/*.excalidraw.json`).
- Scene lifecycle (create/open/get/save/close/list).
- Patch operations, element operations, app state updates, files/library updates.
- Mermaid conversion and derived operations (fit/scroll).
- Session-local active scene context.
- Diagram quality guardrails:
  - connector binding auto-repair
  - text overflow wrapping in containerized text

### Engine Layer
- `src/engines/jsonEngine.ts`
- `src/engines/browserEngine.ts`

Responsibilities:
- JSON engine: deterministic mutation pipeline for scene data.
- Browser engine: visual export (`svg/png/webp`) via browser context.

### Export Layer
- `src/export/exportService.ts`

Responsibilities:
- Unified export interface with checksums.
- JSON export from scene data.
- Delegation to browser engine for image exports.

### Account Linking Layer
- `src/account/accountImporter.ts`

Responsibilities:
- Persistent login profile sessions for Excalidraw/Excalidraw+.
- Auth readiness checkpoint (`account.login_session`).
- UI-import strategy execution for scene/library (`A/B/C` strategy cascade).
- Proof screenshots and import history persistence.

## Persistent Data Layout

All runtime data is under:
- `.excalidraw-mcp/`

Subdirectories:
- `.excalidraw-mcp/scenes/`: scene JSON files.
- `.excalidraw-mcp/account/profiles/`: persistent browser profiles by session.
- `.excalidraw-mcp/account/artifacts/`: login/import screenshots.
- `.excalidraw-mcp/account/import-history.jsonl`: append-only import log.
- `.excalidraw-mcp/account/last-*.json`: latest per-session results.

## Request Flow (Tools)
1. Client calls MCP tool.
2. Tool schema validates input.
3. Service/engine executes business logic.
4. Tool returns:
   - `structuredContent` (machine-readable)
   - `content` (human-readable summary)

## Error Model
- Standard app error mapping through `AppError` (`BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `LOCKED`, `DEGRADED_MODE`, `INTERNAL`).
- Tool outputs include deterministic structured error payload.

## Testing Strategy
- Unit: scene service lifecycle/mutation.
- Integration (in-memory transport): MCP tool/resource/prompt behavior.
- Integration (HTTP transport): session bootstrap and tool calls over streamable HTTP.

## Runtime Constraints
- Node.js 20+ recommended.
- Playwright/Chromium required for browser-backed exports and account-link UI workflows.
- Account linking uses authenticated UI flow, not private Excalidraw account API tokens.
