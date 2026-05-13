# Excalidraw+ API adapter research

Date: 2026-05-13
Linear: ADR-182

## Sources

- https://plus.excalidraw.com/docs/api
- https://plus.excalidraw.com/docs/api/scenes
- https://plus.excalidraw.com/docs/api/scenes/get
- https://plus.excalidraw.com/docs/api/scenes/post
- https://plus.excalidraw.com/docs/api/scenes/sceneId-content-get
- https://plus.excalidraw.com/docs/api/scenes/sceneId-content-put
- https://plus.excalidraw.com/docs/api/scene-content/scenes-sceneId-content-patch
- https://plus.excalidraw.com/docs/api/scene-content-schema
- https://plus.excalidraw.com/docs/mcp/tools
- https://plus.excalidraw.com/docs/mcp/auth-and-permissions
- https://github.com/excalidraw/excalidraw-mcp

## API facts

- Base URL: `https://api.excalidraw.com/api/v1`.
- Auth: `Authorization: Bearer <API_KEY>`.
- API is public beta; names/schemas/behavior can change.
- API key is workspace-scoped; MCP tool availability mirrors route permissions.
- Recommended practice: separate direct API and MCP keys, least privilege, rotate/expire test keys.

## Scene endpoints needed for ADR-182

### List scenes

`GET /api/v1/scenes`

Query params:
- `limit`: 1..100
- `offset`: non-negative integer
- `collectionId`: optional string

Returns `{ limit, offset, hasNextPage, data: [{ metadata, readOnlyLinks, sharedSlidesLinks }] }`.

### Create scene

`POST /api/v1/scenes`

Body:
- `name`: required string
- `pinned`: required boolean
- `collectionId`: required string

Important: this creates metadata + empty scene only. Content must be written through content endpoints after creation.

### Get scene content

`GET /api/v1/scenes/{sceneId}/content`

Returns full scene content:
- `type`
- `version`
- `source`
- `appState`
- `elements`
- `sceneVersion`
- `files`
- optional `filesFailedToEmbed`

### Replace scene content

`PUT /api/v1/scenes/{sceneId}/content`

Body requires:
- `type: "excalidraw"`
- `version`
- `source`
- `appState`
- `elements`
- `files`

Semantics:
- authoritative full replacement;
- existing elements not included are removed;
- connected editors are forced to reload instead of incremental reconciliation;
- request `sceneVersion` is ignored; server recomputes it;
- use for full programmatic generation, backup restore, or authoritative correction.

### Patch scene content

`PATCH /api/v1/scenes/{sceneId}/content`

Body accepts any subset of:
- `elements`
- `appState`
- `files`
- `filesFailedToEmbed` accepted but ignored on writes

At least one of `elements`, `appState`, or `files` must be present.

Semantics:
- server-side merge;
- elements merged by element ID using version-based reconciliation;
- higher version wins; equal versions resolve by `versionNonce` tie-break;
- omitted elements are preserved;
- soft-delete by sending elements with `isDeleted: true`;
- appState shallow merges;
- files add/replace by file ID;
- does not force reload and may temporarily diverge under concurrent edits.

## Scene-content schema implications

- `appState` stored subset includes `viewBackgroundColor`, `lockedMultiSelections`.
- Files keyed by `fileId` include `id`, `mimeType`, `created`, `dataURL`, optional `lastRetrieved`, optional `version`.
- Frame membership is absolute-coordinate `frameId`; `frameId` does not offset children.
- Common element fields include style, ordering, lifecycle, grouping, `boundElements`, `customData`.
- Write schema may accept scene-scoped IDs but canonical persisted IDs are server-normalized.

## Adapter design recommendation

Implement a thin, testable `ExcalidrawPlusApiClient` first, separate from local scene service:

- Constructor accepts `apiKey`, optional `baseUrl`, optional `fetch` implementation for tests.
- Never logs or returns API keys.
- Central request helper maps HTTP errors to `AppError` with status and redacted details.
- Methods:
  - `status()` / `isConfigured()`
  - `listScenes({ limit, offset, collectionId })`
  - `createScene({ name, pinned, collectionId })`
  - `getSceneContent(sceneId)`
  - `replaceSceneContent(sceneId, content)`
  - `patchSceneContent(sceneId, patch)`
- Optional env resolution helper reads `EXCALIDRAW_PLUS_API_KEY` and `EXCALIDRAW_PLUS_API_BASE_URL`.

Then expose MCP tools in a later or same bounded slice:

- `plus_api_status`
- `plus_scenes_list`
- `plus_scene_create`
- `plus_scene_content_get`
- `plus_scene_content_replace`
- `plus_scene_content_patch`

Boundary: local `scene_analyze`, `scene_quality_gate`, rendered exports, and visual goldens remain the authoring quality layer. The Plus API adapter is persistence/collaboration, not a replacement compiler.

## Risk gates

- No live API call in automated tests unless explicitly enabled by env; default tests mock fetch.
- Do not persist credentials in repo or logs.
- Do not mutate remote Plus scenes without explicit tool call and API key.
- PUT is destructive full replacement; tool descriptions must clearly call that out.
- PATCH is merge/reconcile and should be preferred for incremental remote edits.
