# Tool Reference

All tools return structured output with shape:
- `ok: boolean`
- `data?: object`
- `error?: { code, message, details? }`

## Scene Tools
- `scene.create`: create scene file.
- `scene.open`: set active scene for current MCP session.
- `scene.list`: list scene metadata.
- `scene.get`: get full scene payload.
- `scene.save`: persist scene.
- `scene.close`: clear active scene for session.
- `scene.patch`: apply ordered patch operations.
- `scene.validate`: static scene checks.
- `scene.normalize`: normalize/repair scene payload.

`scene.validate` now includes quality diagnostics:
- connector binding integrity (`CONNECTOR_UNBOUND`)
- text overflow in containerized text (`TEXT_OVERFLOW`)

## Element Tools
- `elements.create`: append elements.
- `elements.update`: patch elements by id.
- `elements.delete`: soft/hard delete by ids.
- `elements.list`: list/filter elements.

## App State Tools
- `appstate.get`: fetch app state.
- `appstate.patch`: merge/replace app state.

## File Tools
- `files.attach`: add base64 file to scene.
- `files.detach`: remove file from scene.

## Library Tools
- `library.get`: read scene library items.
- `library.update`: merge/replace library items.

## Diagram/View Tools
- `diagram.from_mermaid`: convert Mermaid and merge/create scene.
- `view.fit_to_content`: set viewport to visible bounds.
- `view.scroll_to_content`: center viewport on content.

## Export Tools
- `export.svg`
- `export.png`
- `export.webp`
- `export.json`

## Account-Linking Tools
- `account.login_session`
- `account.import_scene`
- `account.import_library`
- `account.link_status`

## Session / Health
- `session.reset`: clear active scene binding for caller session.
- `health.ping`: service/browser health snapshot.

---

## Built-in Quality Guardrails
For mutation tools, normalization now auto-applies diagram quality fixes:
- connectors (`arrow`/`line`) are auto-bound when endpoints or explicit hints indicate source/target nodes
- overflow text inside containerized text elements is wrapped to fit container width

This runs through the same normalization path used by scene create/patch/update flows.

---

## Account Tool Usage Examples

### 1) Prepare authenticated session
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

### 2) Import active scene into account
```json
{
  "name": "account.import_scene",
  "arguments": {
    "destination": "plus",
    "mode": "headed",
    "session": "duhman-main",
    "allowInteractiveLogin": false,
    "timeoutSec": 180
  }
}
```

### 3) Inspect session/link status
```json
{
  "name": "account.link_status",
  "arguments": {
    "session": "duhman-main"
  }
}
```

## Resource URIs
- `excalidraw://scenes`
- `excalidraw://scene/{sceneId}/summary`
- `excalidraw://scene/{sceneId}/json`
- `excalidraw://scene/{sceneId}/elements`
- `excalidraw://scene/{sceneId}/app-state`
- `excalidraw://scene/{sceneId}/library`
- `excalidraw://scene/{sceneId}/files`

## Prompts
- `diagram-from-spec`
- `refine-layout`
- `convert-notes-to-scene`
- `scene-review-checklist`
