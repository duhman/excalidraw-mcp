# Claude Client Setup

This server is intended to run as a local stdio MCP server for both Claude Code and Claude Desktop.

## Prerequisites

Build the latest local server before pointing clients at it:

```bash
npm install
npm run build
npx playwright install chromium
```

The production entry point is:

```bash
node /Users/workboi/projects/excalidraw-mcp/dist/src/index.js --transport stdio
```

Set `MCP_WORKSPACE_ROOT` to the repository root so scenes, account profiles, and generated artifacts stay under this project.

## Claude Code

Install the MCP server in user scope:

```bash
claude mcp add-json -s user excalidraw '{
  "type": "stdio",
  "command": "node",
  "args": [
    "/Users/workboi/projects/excalidraw-mcp/dist/src/index.js",
    "--transport",
    "stdio"
  ],
  "env": {
    "MCP_WORKSPACE_ROOT": "/Users/workboi/projects/excalidraw-mcp"
  }
}'
```

Verify it:

```bash
claude mcp get excalidraw
```

Expected status: `Connected`.

## Claude Desktop

Update `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": [
        "/Users/workboi/projects/excalidraw-mcp/dist/src/index.js",
        "--transport",
        "stdio"
      ],
      "env": {
        "MCP_WORKSPACE_ROOT": "/Users/workboi/projects/excalidraw-mcp"
      }
    }
  }
}
```

Preserve any other existing `mcpServers` entries. Restart Claude Desktop after editing the file.

## Recommended Agent Flow

Use `agent-workflow-guide` first when available. For final output, follow:

1. `diagram_compose` or `nodes_compose`
2. `scene_analyze`
3. `scene_normalize` when recommended
4. `layout_polish` and `styles_apply_preset`
5. `scene_validate`
6. `scene_quality_gate`
7. `export_svg`, `export_png`, `export_webp`, or `export_json`

Treat `TEXT_OVERFLOW`, `CONNECTOR_UNBOUND`, `ELEMENT_OVERLAP`, and `CONNECTOR_CROSSING` as release blockers.
