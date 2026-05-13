---
name: excalidraw-agent
description: Integrate and automate Excalidraw in React and Next.js apps, build and edit .excalidraw scenes (including Mermaid conversion), merge .excalidrawlib libraries, export to SVG/PNG/WebP, push scenes into authenticated Excalidraw / Excalidraw+ workspaces, and troubleshoot runtime issues. Use when users mention Excalidraw, Mermaid diagrams, .excalidraw or .excalidrawlib files, Excalidraw API props/methods, export/import flows, or host-app collaboration wiring.
license: Proprietary. LICENSE.txt has complete terms
compatibility: Designed to be paired with the excalidraw-mcp MCP server. Falls back to host-side scripting only if the MCP server is not connected.
---

# Excalidraw Agent

## Overview

Use this skill to deliver end-to-end Excalidraw work: integration into host apps, API-driven scene updates, Mermaid conversion, library operations, export/import pipelines, collaboration patterns, and runtime diagnostics.

This skill is bundled with the [excalidraw-mcp](https://github.com/duhman/excalidraw-mcp) MCP server. When that server is connected to your agent client, all scene authoring, validation, export, and account import work runs through MCP tools — there is no need to invoke local bash scripts.

If the MCP server is not connected, this skill still serves as a reference guide for host-app embedding work (React / Next.js / Preact) in `references/`.

## Core Workflow

1. Confirm the `excalidraw-mcp` MCP server is connected. Check `health_ping`.
2. Triage the request type.
3. Load only the required reference file(s) from `references/`. They are also exposed by the MCP server as `excalidraw://docs/<topic>` resources.
4. Execute the task by calling MCP tools (preferred) or by guiding host-app code edits.
5. Validate output using `scene_validate` and (when high quality is required) `scene_quality_gate`.
6. Report what changed, what was verified, and remaining risks.

## Task Triage

- Installation or framework embedding (React / Next.js / Preact host apps): load `references/excalidraw-install-and-integration.md`.
- Props and imperative API usage: load `references/excalidraw-props-and-api.md`.
- Serialization, restore, and export/import: load `references/excalidraw-utils-restore-export.md`.
- Editor composition (`MainMenu`, `Sidebar`, `WelcomeScreen`, `Footer`): load `references/excalidraw-ui-composition.md`.
- Mermaid conversion workflows: load `references/excalidraw-mermaid-conversion.md`.
- Collaboration architecture and remote update behavior: load `references/excalidraw-collaboration-pattern.md`.
- Account-linked import/publish via authenticated browser session: load `references/excalidraw-account-linking.md`.
- Client setup/portability across Codex, Claude Code, Cursor, and Zed: load `references/excalidraw-client-compatibility.md`.
- Runtime or build failures: load `references/excalidraw-troubleshooting.md`.
- Skills protocol constraints and metadata behavior: load `references/agent-skills-protocol-notes.md`.

## MCP Tool Mapping

These are the canonical execution paths. Prefer them over any local scripting. All tools use the canonical `snake_case` surface.

| Intent                                           | MCP tool                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create / open / list scenes                      | `scene_create`, `scene_open`, `scene_list`, `scene_get`, `scene_save`, `scene_close`                                                                                      |
| Official-compatible scene content                | `read_excalidraw_format`, `get_scene_content`, `search_scene_content`, `edit_scene_content`                                                                               |
| Official Excalidraw+ persistence adapter          | `plus_api_status`, `plus_scenes_list`, `plus_scene_content_get`, `plus_scene_create`, `plus_scene_content_patch`, `plus_scene_content_replace`                            |
| Import an existing `.excalidraw` file            | `scene_import_json`                                                                                                                                                       |
| Mutate scene at the primitive level              | `scene_patch`, `elements_create`, `elements_create_skeletons`, `elements_update`, `elements_delete`, `elements_list`                                                      |
| Layout cleanup                                   | `elements_arrange` (align / distribute / stack / grid), `layout_polish`                                                                                                   |
| High-level authoring (preferred for new scenes)  | `diagram_compose`, `nodes_compose`, `nodes_create`, `layout_flow`, `layout_swimlanes`, `frames_create`, `frames_assign_elements`, `layers_reorder`, `styles_apply_preset` |
| Create connectors between nodes                  | `connectors_create`                                                                                                                                                       |
| Convert Mermaid → `.excalidraw`                  | `diagram_from_mermaid`                                                                                                                                                    |
| Validate / analyze / normalize                   | `scene_validate`, `scene_analyze`, `scene_normalize`                                                                                                                      |
| Quality gate before export                       | `scene_quality_gate`                                                                                                                                                      |
| Library                                          | `library_get`, `library_update`, `library_import_json`                                                                                                                    |
| App state                                        | `appstate_get`, `appstate_patch`                                                                                                                                          |
| Files                                            | `files_attach`, `files_detach`                                                                                                                                            |
| Set viewport                                     | `view_fit_to_content`, `view_scroll_to_content`                                                                                                                           |
| Export                                           | `export_json`, `export_svg`, `export_png`, `export_webp`                                                                                                                  |
| Authenticated import to Excalidraw / Excalidraw+ | `account_login_session`, `account_import_scene`, `account_import_library`, `account_link_status`                                                                          |
| Health / session                                 | `health_ping`, `session_reset`                                                                                                                                            |

The companion server also exposes these read-only resources for context:

- `excalidraw://scenes`
- `excalidraw://scene/{sceneId}/summary`
- `excalidraw://scene/{sceneId}/analysis`
- `excalidraw://scene/{sceneId}/json`
- `excalidraw://scene/{sceneId}/elements`
- `excalidraw://scene/{sceneId}/app-state`
- `excalidraw://scene/{sceneId}/library`
- `excalidraw://scene/{sceneId}/files`
- `excalidraw://docs` (index of the bundled skill references)
- `excalidraw://docs/<topic>` (the same files in `references/`)

And these prompts:

- `agent-workflow-guide`
- `diagram-from-spec`
- `refine-layout`
- `convert-notes-to-scene`
- `scene-review-checklist`

## Hard Integration Requirements (host app embedding)

Apply these on every Excalidraw integration unless the user explicitly asks otherwise:

1. Import the Excalidraw stylesheet:
   - `import "@excalidraw/excalidraw/index.css";`
2. Render inside a container with non-zero height and width.
3. Use the `excalidrawAPI` callback for imperative control. Do not use removed legacy `ref` API patterns.
4. For Next.js, disable SSR for the Excalidraw component using a `dynamic` import with `ssr: false`.
5. If self-hosting fonts/assets, set `window.EXCALIDRAW_ASSET_PATH` correctly.

## Execution Paths

### 1) Embed Excalidraw in a Host App

1. Load `references/excalidraw-install-and-integration.md`.
2. Implement base integration for React/Next.js/Preact as needed.
3. Confirm CSS import and non-zero container dimensions.
4. Validate editor rendering and input behavior.

This path is _not_ served by the MCP server — it requires editing the host application's source.

### 2) Implement API-Driven Scene or UI Behavior

1. Load `references/excalidraw-props-and-api.md`.
2. Use `excalidrawAPI` callback to capture the API instance.
3. Use `updateScene` and `captureUpdate` semantics intentionally:
   - local undoable updates: `IMMEDIATELY`
   - async grouped updates: `EVENTUALLY`
   - remote / collab updates: `NEVER`
4. Verify behavior via event subscriptions (`onChange`, pointer handlers).

### 3) Compose a Scene From Spec (preferred high-level path)

1. Call `diagram_compose` with semantic `title`, `nodes`, `edges`, and optional `frames` / `lanes`, `legend`, `stylePreset`, and `qualityTarget`. It runs deterministic authoring, polish, validation, and quality-gate checks in one tool call.
2. If the result needs refinement, follow the `recommendedActions` from `scene_analyze`.
3. For targeted official-style edits, first call `search_scene_content` to find exact IDs, then call `edit_scene_content`. Use `tempId` instead of `id` on new elements, and reference those temp IDs from `frameId`, `containerId`, `startBinding.elementId`, and `endBinding.elementId`.
4. Use `read_excalidraw_format` when an agent needs the official scene-content contract in-context; use `get_scene_content` when a downstream tool expects the official-style `elements` / `appState` / `files` shape.
5. To persist into Excalidraw+ rather than only local workspace storage, first call `plus_api_status`; if configured, use `plus_scene_create` followed by `plus_scene_content_patch` for incremental remote writes. Reserve `plus_scene_content_replace` for explicit whole-scene publish/restore because omitted elements are deleted remotely.

### 4) Convert Mermaid to `.excalidraw`

1. Load `references/excalidraw-mermaid-conversion.md`.
2. Call `diagram_from_mermaid` with the Mermaid source.
3. Call `scene_validate` on the result.
4. If layout is unreadable (tall single-column collapse), simplify labels / split into multiple diagrams, re-convert, and expect a manual arrangement pass in Excalidraw.

### 5) Merge and Normalize Libraries

1. Load `references/excalidraw-utils-restore-export.md`.
2. Use `library_import_json` to ingest each `.excalidrawlib` payload.
3. Call `library_update` with `merge: true` if combining libraries on a scene.
4. Read back with `library_get` to confirm normalization.

### 6) Build Collaboration Glue

1. Load `references/excalidraw-collaboration-pattern.md`.
2. Keep transport and persistence in the host app; keep the editor as a client state surface.
3. Apply remote updates with non-undo capture behavior (`captureUpdate: NEVER`).
4. Verify collaborator map rendering and local-vs-remote conflict handling.

### 7) Troubleshoot Runtime Failures

1. Load `references/excalidraw-troubleshooting.md`.
2. Diagnose by category: SSR/build, CSS/layout, browser quirks, asset path, env flags.
3. If the failure is in MCP server tooling, call `health_ping` to inspect engine state.
4. Validate the fixed state with a minimal reproducible integration.

### 8) Link Generated Content to an Excalidraw Account

1. Load `references/excalidraw-account-linking.md`.
2. Call `account_login_session` (mode: `headed`) and complete login / MFA in the launched browser.
3. Call `account_import_scene` (or `account_import_library`) for the active scene.
4. Inspect `account_link_status` for proof-of-import artifact paths and `reasonCode` values (`READY`, `AUTH_NOT_READY`, `IMPORTED`, `IMPORT_STRATEGY_FAILED`, `POST_IMPORT_VERIFICATION_FAILED`).

### 9) Configure Skill for a Specific Agent Client

1. Load `references/excalidraw-client-compatibility.md`.
2. Place or symlink this skill directory into the client's skill root (Claude Code: `~/.claude/skills/`, Codex: `~/.codex/skills/`, Cursor: `~/.cursor/skills/`, Zed: `~/.config/zed/skills/`).
3. Wire the excalidraw-mcp server into the same client's MCP config so the tool calls in this skill resolve.
4. Confirm the client can load `SKILL.md` and that `health_ping` returns OK.

## Deterministic Execution Notes

- All MCP tools return structured output with `ok: boolean`, optional `data`, and structured `error`. Branch on `ok` rather than parsing text.
- Mutation tools run through a normalization pipeline that repairs Excalidraw invariants (connector bindings, missing container backlinks, geometry).
- Account linking uses an authenticated UI flow via Playwright, not a private Excalidraw API token. Human-in-the-loop login is required for the first session.
- This skill no longer ships its own bash scripts. The earlier scripts (`mermaid_to_scene.mjs`, `scene_lint.mjs`, `library_merge.mjs`, `import_to_excalidraw.sh`, `check_env.sh`, `self_test.sh`) are fully superseded by the MCP tools listed above. Their behavior is preserved server-side.

## Multi-Agent Compatibility

- Core Agent Skills contract: `SKILL.md` + optional `references/`, `assets/`, and `agents/` (Codex-only metadata).
- This skill is portable: all operational instructions are rooted in `SKILL.md`, and reference paths are skill-root relative.
- Runtime work is portable too because it goes through the excalidraw-mcp MCP server, which speaks the standard MCP protocol (stdio or Streamable HTTP).

## Validation Checklist

- `health_ping` returns OK.
- `SKILL.md` frontmatter validates (`npx --yes skills-ref validate skills/excalidraw-agent`).
- Converted scenes parse and validate (`scene_validate` returns `ok: true`).
- For high-quality outputs, `scene_quality_gate` passes the configured threshold.
- Merged libraries are readable by Excalidraw tooling (`library_get` round-trips cleanly).
- Recommendations reference the correct framework constraints (React / Next.js / Preact).
- Cross-client setup guidance is present and does not assume a single agent runtime.

## Skill Maintenance

- Keep `SKILL.md` concise and procedural; under 500 lines per spec.
- Keep deep details in `references/`.
- Keep references one hop from `SKILL.md`.
- Re-run validation after edits:
  - `npx --yes skills-ref validate skills/excalidraw-agent`
