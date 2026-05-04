# Agent Playbook

This document is the shortest path to using `excalidraw-mcp` well as an LLM agent.

The server exposes low-level scene mutation tools, but the best results come from using the higher-level helpers first and treating direct patching as a last resort.

For Claude Code and Claude Desktop installation, see [`CLAUDE_CLIENTS.md`](CLAUDE_CLIENTS.md).

## Default Operating Loop

1. `scene_analyze`
2. `scene_normalize` if structural issues are present
3. higher-level authoring and layout helpers
4. `scene_validate`
5. `scene_quality_gate`
6. export

Treat `TEXT_OVERFLOW`, `ELEMENT_OVERLAP`, `CONNECTOR_CROSSING`, and structural errors as release blockers. Use `scene_normalize` and `layout_polish` until the quality gate passes instead of exporting a nearly finished scene.

Recommended export order:

1. `export_svg` for review and diffability
2. `export_png` or `export_webp` for final rendered output
3. `export_json` when you need the raw Excalidraw scene payload

## Tool Selection Guide

Use this table when deciding what to call next.

| Goal | Preferred tools | Notes |
| --- | --- | --- |
| Understand what is wrong with the scene | `scene_analyze` | Best first read. Returns issue codes, score, and `recommendedActions`. |
| Confirm hard correctness before export | `scene_validate` | Use near the end. Treat this as the release gate for structure. |
| Block imperfect final output | `scene_quality_gate` | Fails on score, overlap, crossings, text overflow, missing titles, and missing legends. |
| Repair broken scene invariants | `scene_normalize` | Safe for geometry, file references, bindings, frames, and container backlinks. |
| Build semantic diagram cards or blocks | `nodes_compose` | Preferred over manual rectangles + text. Supports title, body, icon, image, auto-height, and frame assignment. |
| Build simple shaped nodes quickly | `nodes_create` | Good for lighter-weight diagrams when semantic slots are unnecessary. |
| Turn a list of nodes into a sequence | `layout_flow` | Best for left-to-right or top-to-bottom processes. Can connect nodes automatically. |
| Build swimlanes | `layout_swimlanes` | Preferred over manually creating frames and headers. |
| Tidy overlap, spacing, labels, and supporting text | `layout_polish` | Deterministic cleanup only. Does not invent new content. |
| Move or align existing items | `elements_arrange` | Dependency-aware by default, so labels and container text move with roots. |
| Group content into a boundary or named area | `frames_create`, `frames_assign_elements` | Use for architecture zones, swimlanes, stages, or ownership boundaries. |
| Apply consistent visual language | `styles_apply_preset` | Prefer this over ad hoc color/font/stroke edits. |
| Fine-tune exact geometry | `elements_update` or `scene_patch` | Only after higher-level tools are exhausted. |

## Best-Practice Patterns

### Prefer semantic composition over raw shapes

Instead of:

- `elements_create` rectangle
- `elements_create` title text
- `elements_create` body text
- manual alignment

Prefer:

- `nodes_compose`

This keeps spacing, wrapping, typography, and container relationships consistent.

### Use `recommendedActions` as the next-step planner

When `scene_analyze` returns `recommendedActions`, prefer following those in order before inventing a custom sequence.

Typical loop:

1. `scene_analyze`
2. apply `scene_normalize` if recommended
3. apply `layout_polish` and/or `styles_apply_preset`
4. rerun `scene_analyze`
5. `scene_validate`

### Keep deterministic tools ahead of direct patches

The safest priority order is:

1. semantic helpers
2. layout helpers
3. style helpers
4. validation / analysis
5. direct patch operations

Direct patching is most appropriate for:

- one-off annotations
- custom connector labels
- exact viewport/app-state tweaks
- intentional exceptions to the normal layout system

## Common Recipes

### Build a polished process diagram

1. `scene_create`
2. `nodes_compose`
3. `layout_flow`
4. `styles_apply_preset`
5. add title and legend if needed
6. `scene_analyze`
7. `layout_polish`
8. `scene_validate`
9. `export_svg`

### Build a swimlane board

1. `scene_create`
2. `nodes_compose`
3. `layout_swimlanes`
4. `connectors_create` or `layout_flow` inside lanes if needed
5. `styles_apply_preset`
6. `scene_analyze`
7. `layout_polish`
8. `scene_validate`
9. export

### Refine an existing messy scene

1. `scene_analyze`
2. `scene_normalize` if structural issues exist
3. `elements_arrange`, `layout_flow`, `layout_swimlanes`, or `frames_assign_elements` depending on the problem
4. `layout_polish`
5. `styles_apply_preset`
6. `scene_validate`

## Quality Heuristics

Aim for:

- visible title when the scene is intended as a presentation asset
- legend when symbols, arrows, or color meanings are non-obvious
- no overflowing, clipped, or manually detached text; prefer `nodes_compose` and `connectors_create`
- consistent typography scale
- enough spacing that nodes do not visually merge at 100% zoom
- connectors that support the story instead of crossing unnecessarily
- frame usage that clarifies ownership, stage, or grouping

Watch for these issue codes in `scene_analyze` and `scene_validate`:

- `ELEMENT_OVERLAP`
- `DENSE_CLUSTER`
- `CONNECTOR_CROSSING`
- `TEXT_UNREADABLE`
- `TEXT_OVERFLOW`
- `TYPOGRAPHY_INCONSISTENT`
- `MISSING_TITLE`
- `MISSING_LEGEND`
- `CONTAINER_TEXT_UNBOUND`
- `GEOMETRY_INVALID`

## Anti-Patterns

Avoid these unless there is a strong reason:

- starting with `scene_patch` before you know whether semantic helpers can do the job
- creating raw text children manually when `nodes_compose` can keep the relationship intact
- moving container labels independently from their parent node
- mixing multiple visual presets across the same semantic layer without intent
- exporting before `scene_validate`

## Account-Link Workflow

Use account-linking only after the local scene is already valid and export-ready.

Preferred order:

1. complete the local scene workflow
2. `account_login_session`
3. `account_import_scene` or `account_import_library`
4. `account_link_status`

If a login is not ready, expect `reasonCode: "AUTH_NOT_READY"` and reuse the same `session`.

## Prompt Discovery

The server also exposes prompts that help agents plan good tool sequences:

- `agent-workflow-guide`
- `diagram-from-spec`
- `refine-layout`
- `convert-notes-to-scene`
- `scene-review-checklist`
