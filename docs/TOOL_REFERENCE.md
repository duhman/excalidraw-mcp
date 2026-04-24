# Tool Reference

All tools return structured output shaped like:

- `ok: boolean`
- `data?: object`
- `error?: { code, message, details? }`

## Scene Tools

- `scene_create`
- `scene_import_json`
- `scene_open`
- `scene_list`
- `scene_get`
- `scene_save`
- `scene_close`
- `scene_patch`
- `scene_validate`
- `scene_normalize`
- `scene_analyze`
- `scene_quality_gate`

### `scene_validate`

Use for hard correctness checks. Returns:

- `valid`
- `issues`
- `qualityIssues`
- `qualityScore`
- `summary`
- `revisionHash`

### `scene_analyze`

Use for richer review and deterministic follow-up planning. Returns:

- `issues`
- `score`
- `summary`
- `recommendedActions`

`recommendedActions` currently points agents toward deterministic helpers such as:

- `scene_normalize`
- `layout_polish`
- `styles_apply_preset`
- other targeted follow-up tools when applicable

## Element Tools

- `elements_create`
- `elements_create_skeletons`
- `elements_update`
- `elements_delete`
- `elements_list`
- `elements_arrange`

`elements_arrange` is dependency-aware by default, so grouped semantic children, bound labels, and container text move with the selected roots.

## Higher-Level Authoring Tools

- `frames_create`
- `frames_assign_elements`
- `styles_apply_preset`
- `layers_reorder`
- `diagram_compose`
- `nodes_create`
- `nodes_compose`
- `layout_flow`
- `layout_swimlanes`
- `layout_polish`
- `connectors_create`

### `elements_create_skeletons`

Preferred low-level parity tool for public Excalidraw primitives. It uses Excalidraw's Skeleton API and supports `rectangle`, `diamond`, `ellipse`, `line`, `arrow`, `text`, `image`, `freedraw`, `embeddable`, `iframe`, `frame`, and `magicframe`.

### `diagram_compose`

Preferred high-level full-scene authoring tool for agents. It accepts semantic `title`, `diagramType`, `nodes`, `edges`, `frames` or `lanes`, optional `legend`, `stylePreset`, and `qualityTarget`, then runs deterministic authoring, polish, validation, and quality-gate checks.

### `scene_quality_gate`

Read-only release gate for high-quality output. Defaults to minimum score `90`, no structural errors, no overlaps/crossings/text overflow, title required for non-empty scenes, and legend required when relationships or multiple visual semantics are present.

### `connectors_create`

Creates line/arrow connectors with labels, explicit points, start/end bindings, and Excalidraw's public arrowhead enum.

### `nodes_compose`

Creates semantic nodes with:

- container
- title text
- optional body text
- optional icon slot
- optional image slot
- fixed padding and auto-height growth

Prefer this over hand-assembling rectangles and text whenever you want polished programmatic output.

### `layout_swimlanes`

Creates or updates swimlane frames with:

- lane frames
- lane headers
- optional element assignment into frames
- deterministic lane-local layout

Prefer this over manual frame creation when the scene has owners, stages, departments, or lanes.

### `layout_polish`

Applies safe deterministic cleanup for:

- overlap reduction
- density expansion
- off-canvas recovery
- connector label recentering
- title/legend rebalance when those elements already exist

Run this after `scene_analyze` and before `scene_validate`.

## App State Tools

- `appstate_get`
- `appstate_patch`

## File Tools

- `files_attach`
- `files_detach`

File attach now deduplicates by decoded binary bytes, not raw data URL text.

## Library Tools

- `library_get`
- `library_update`
- `library_import_json`

## Diagram / View Tools

- `diagram_from_mermaid`
- `view_fit_to_content`
- `view_scroll_to_content`

## Export Tools

- `export_svg`
- `export_png`
- `export_webp`
- `export_json`

Rendered export now uses a local Excalidraw runtime bundle and validates `scale` instead of silently ignoring it.

## Account-Linking Tools

- `account_login_session`
- `account_import_scene`
- `account_import_library`
- `account_link_status`

Account results include `reasonCode` values such as:

- `READY`
- `AUTH_NOT_READY`
- `IMPORTED`
- `IMPORT_STRATEGY_FAILED`
- `POST_IMPORT_VERIFICATION_FAILED`

## Session / Health Tools

- `session_reset`
- `health_ping`

## Style Presets

Available preset names:

- `process`
- `decision`
- `note`
- `title`
- `legend`
- `accent`
- `swimlane`
- `boundary`
- `supporting_text`

## Quality Issue Codes

Current issue codes emitted by validation/analysis:

- `CONNECTOR_UNBOUND`
- `CONNECTOR_CROSSING`
- `CONTAINER_MISSING`
- `CONTAINER_TEXT_UNBOUND`
- `DENSE_CLUSTER`
- `ELEMENT_OFF_CANVAS`
- `ELEMENT_OVERLAP`
- `FRAME_TARGET_MISSING`
- `GEOMETRY_INVALID`
- `IMAGE_FILE_MISSING`
- `MISSING_LEGEND`
- `MISSING_TITLE`
- `TEXT_OVERFLOW`
- `TEXT_UNREADABLE`
- `TYPOGRAPHY_INCONSISTENT`

## Resource URIs

- `excalidraw://scenes`
- `excalidraw://scene/{sceneId}/summary`
- `excalidraw://scene/{sceneId}/analysis`
- `excalidraw://scene/{sceneId}/json`
- `excalidraw://scene/{sceneId}/elements`
- `excalidraw://scene/{sceneId}/app-state`
- `excalidraw://scene/{sceneId}/library`
- `excalidraw://scene/{sceneId}/files`

## Prompt Catalog

- `agent-workflow-guide`
- `diagram-from-spec`
- `refine-layout`
- `convert-notes-to-scene`
- `scene-review-checklist`

## Suggested Agent Cookbook

Preferred deterministic loop:

1. `scene_analyze`
2. apply `scene_normalize` if structural issues exist
3. use higher-level helpers:
   `diagram_compose`, `elements_create_skeletons`, `nodes_compose`, `layout_swimlanes`, `layout_flow`, `layout_polish`, `styles_apply_preset`
4. `scene_validate`
5. `scene_quality_gate`
6. export

Worked examples are easiest to inspect in:

- `scripts/demo-sales-process-board.mjs`
- `test/integration/visualFixtures.ts`
- `docs/AGENT_PLAYBOOK.md`
