# Excalidraw Public API Capability Matrix

This matrix tracks public/open-source Excalidraw capabilities against the MCP surface. Private Excalidraw+ APIs, realtime collaboration, clipboard internals, and Magic AI generation internals are intentionally out of scope.

| Capability | MCP Surface | Notes |
| --- | --- | --- |
| Scene lifecycle | `scene_create`, `scene_import_json`, `scene_open`, `scene_save`, `scene_close`, `scene_list`, `scene_get` | Managed workspace storage with active-session fallback. |
| Raw scene mutation | `scene_patch` | Escape hatch for exact JSON changes. Prefer typed tools first. |
| Official element skeletons | `elements_create_skeletons` | Uses Excalidraw's Skeleton API for rectangles, diamonds, ellipses, lines, arrows, text, images, freedraw, embeddables, iframes, frames, and magic frames. |
| Primitive element CRUD | `elements_create`, `elements_update`, `elements_delete`, `elements_list` | Backwards-compatible low-level surface. |
| Style fields | `elements_create_skeletons`, `elements_update`, `styles_apply_preset` | Supports fill/stroke styles, roughness, roundness, opacity, fonts, alignment, links, locks, groups, frames, and custom data. |
| Bindings and connectors | `connectors_create`, `scene_normalize` | Supports start/end bindings, labels, explicit points, line/arrow connectors, and the full public arrowhead enum. |
| Frames and magic frames | `frames_create`, `frames_assign_elements`, `layout_swimlanes`, `elements_create_skeletons` | `frames_create.kind` selects `frame` or `magicframe`; `children` maps to frame membership. |
| Images and binary files | `files_attach`, `files_detach`, `elements_create_skeletons`, `nodes_compose` | Files are stored in the scene file map; image elements can use crop, scale, status, link, lock, frame, and custom metadata. |
| Freehand and embeds | `elements_create_skeletons` | Supports public `freedraw`, `embeddable`, and `iframe` skeletons. |
| Libraries | `library_get`, `library_update`, `library_import_json` | Uses Excalidraw library JSON payloads and restore normalization. |
| App state and viewport | `appstate_get`, `appstate_patch`, `view_fit_to_content`, `view_scroll_to_content` | Covers view/export-facing app state. |
| Mermaid conversion | `diagram_from_mermaid` | Delegates to `@excalidraw/mermaid-to-excalidraw`. |
| Semantic authoring | `diagram_compose`, `nodes_compose`, `nodes_create`, `layout_flow`, `layout_swimlanes` | Recommended for LLM agents that need polished drawings. |
| Quality analysis and repair | `scene_analyze`, `scene_normalize`, `layout_polish`, `scene_quality_gate`, `scene_validate` | Quality gate is the release check for high-quality agent output. |
| Export | `export_svg`, `export_png`, `export_webp`, `export_json` | Browser-backed native Excalidraw export for rendered formats. |
| Account import | `account_login_session`, `account_import_scene`, `account_import_library`, `account_link_status` | UI automation only; no private account APIs. |

## Recommended Agent Path

1. Use `diagram_compose` for full semantic diagrams, or `elements_create_skeletons` for exact public Excalidraw primitives.
2. Run `scene_analyze` and follow `recommendedActions`.
3. Run `layout_polish` and `styles_apply_preset` where appropriate.
4. Run `scene_validate` and `scene_quality_gate`.
5. Export with `export_svg` first, then `export_png` or `export_webp` for final rendered output.
