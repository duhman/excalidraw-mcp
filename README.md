# excalidraw-mcp

A full-capability MCP server for Excalidraw with:
- scene lifecycle + element/app state/file/library tools
- Mermaid conversion
- JSON and image exports
- dual transport (`stdio` + Streamable HTTP)
- account-linking workflows for Excalidraw / Excalidraw+ via authenticated browser sessions

## Documentation
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Tool reference: [`docs/TOOL_REFERENCE.md`](docs/TOOL_REFERENCE.md)
- Account linking: [`docs/ACCOUNT_LINKING.md`](docs/ACCOUNT_LINKING.md)

## Features

### MCP Surfaces
- Tools: scene, elements, appstate, files, library, diagram, view, export, account, session, health
- Resources:
  - `excalidraw://scenes`
  - `excalidraw://scene/{sceneId}/summary`
  - `excalidraw://scene/{sceneId}/json`
  - `excalidraw://scene/{sceneId}/elements`
  - `excalidraw://scene/{sceneId}/app-state`
  - `excalidraw://scene/{sceneId}/library`
  - `excalidraw://scene/{sceneId}/files`
- Prompts:
  - `diagram-from-spec`
  - `refine-layout`
  - `convert-notes-to-scene`
  - `scene-review-checklist`

### Engine Model
- JSON engine for deterministic data operations.
- Browser engine (Playwright + Chromium) for high-fidelity exports and account import automation.

### Storage Model
- Scene store: `.excalidraw-mcp/scenes/*.excalidraw.json`
- Account profiles/history/artifacts: `.excalidraw-mcp/account/*`

## Requirements
- Node.js 20+
- npm

## Install
```bash
npm install
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
- `MCP_HTTP_HOST` (default `127.0.0.1`)
- `MCP_HTTP_PORT` (default `8788`)
- `MCP_HTTP_PATH` (default `/mcp`)
- `MCP_WORKSPACE_ROOT` (default current working directory)

## Account Linking Quick Start
1. Create/open a scene with MCP tools.
2. Prepare auth session:
```json
{
  "name": "account.login_session",
  "arguments": {
    "destination": "plus",
    "mode": "headed",
    "session": "duhman-main",
    "timeoutSec": 300,
    "closeOnComplete": false
  }
}
```
3. Import scene:
```json
{
  "name": "account.import_scene",
  "arguments": {
    "session": "duhman-main",
    "destination": "plus",
    "mode": "headed"
  }
}
```
4. Inspect status/history:
```json
{
  "name": "account.link_status",
  "arguments": {
    "session": "duhman-main"
  }
}
```

## Development
```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Notes
- Account linking is implemented via authenticated UI automation, not private Excalidraw API tokens.
- For Playwright browser setup issues:
```bash
npx playwright install chromium
```
