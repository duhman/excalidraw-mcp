# Hybrid Excalidraw MCP: local compiler + official Excalidraw+ compatibility

Date: 2026-05-13
Linear project: https://linear.app/adrian-marten/project/hybrid-excalidraw-mcp-local-official-4b8efc87354d

## Target

Build one agent-grade Excalidraw system that lets agents create pixel-perfect Excalidraw content programmatically while preserving both:

1. **Local deterministic compiler strengths** from this repo: semantic authoring tools, layout normalization, quality gates, render/export, and repeatable tests.
2. **Official Excalidraw strengths** from Excalidraw+ MCP/API and the official OSS MCP app: canonical scene-content semantics, workspace persistence/collaboration, tempId-based edits, search-before-edit ergonomics, and interactive preview/checkpoint UX.

## Research synthesis

### Official Excalidraw+ MCP/API

Docs:
- https://plus.excalidraw.com/docs/mcp
- https://plus.excalidraw.com/docs/mcp/tools
- https://plus.excalidraw.com/docs/api/scene-content-schema
- https://plus.excalidraw.com/docs/mcp/auth-and-permissions

Strengths:
- Canonical Excalidraw+ backend and workspace semantics.
- Scene-content API model that matches how official clients expect scenes to be exchanged.
- Agent-friendly edit surface: `search_scene_content`, `edit_scene_content`, `get_scene_content`, `read_excalidraw_format`.
- Safer mutation model: add/update/delete split; deletes happen before updates before adds.
- `tempId` references let agents add multiple related elements without inventing persisted IDs.
- Official auth/permissions and remote collaboration story.

Weaknesses for pixel-perfect generation:
- It is primarily a persistence/edit API, not a full diagram compiler.
- It does not replace semantic layout, score-based quality gates, or rendered artifact verification.
- Agent has to know design/layout rules unless the local layer supplies them.
- Network/auth dependency; local/offline reproducibility is weaker.

### Official open-source Excalidraw MCP app

Repo researched in `/tmp/excalidraw-official-research` from `excalidraw/excalidraw-mcp`.

Strengths:
- Excellent MCP-app UX direction: interactive view creation, visual preview, checkpoint/restore patterns, and model feedback loop potential.
- Small focused surface that teaches agents to inspect and patch scene content incrementally.
- Good reference for MCP app ergonomics and fullscreen human-edit handoff.

Weaknesses for this target:
- Not a complete replacement for our local compiler/validator/export system.
- Less focused on deterministic high-level authoring primitives and release gates.
- Does not provide our existing semantic diagram families, visual golden checks, and quality scoring.

### Local `excalidraw-mcp`

Strengths:
- Rich semantic authoring surface (`nodes_compose`, connectors, swimlanes, timelines, tables, mindmaps, layout polish, normalize/analyze/quality gate/export/import).
- Deterministic local JSON engine and regression tests.
- Existing skill/runbook for agent usage.
- Stronger path to pixel-perfect output because quality can be measured locally before anything is published.

Weaknesses:
- Did not expose official-compatible scene-content verbs, so agents had to learn repo-specific tools first.
- Lacked official `tempId` semantics and search/edit ergonomics.
- Official Plus persistence/collab adapter is not yet implemented.
- Lint hygiene currently trips on generated/vendor/runtime files; release gates need cleanup.

## Architecture decision

Do **not** replace local MCP with official MCP. Hybridize:

```text
Agent
  |
  |-- high-level local compiler tools: nodes_compose/layout_*/scene_analyze/quality_gate/export
  |-- official-compatible local tools: read_excalidraw_format/search_scene_content/edit_scene_content/get_scene_content
  |
Local Excalidraw MCP service
  |
  |-- Local workspace provider: deterministic tests, JSON store, artifacts
  |-- Future Excalidraw+ provider: official API/MCP adapter for remote workspace persistence
  |
Excalidraw renderer/export/interactive preview
```

The local server is the compiler and QA engine. The official API is the canonical workspace/persistence/collaboration backend once credentials are available.

## Implemented in this pass

### Official-compatible local tools

Added local equivalents of the official MCP ergonomics:

- `read_excalidraw_format`
  - Returns local official-compatibility format guidance, references, and edit semantics.
- `get_scene_content`
  - Returns `elements`, `appState`, `files`, `metadata`, `sourceProvider: "local"`.
- `search_scene_content`
  - Searches element content before edits.
  - Supports `contains` and `glob`.
  - `contains` is case-insensitive and separator-insensitive (`Auth Flow` matches `auth_flow`).
- `edit_scene_content`
  - Applies operations in official order: `delete`, then `update`, then `add`.
  - Accepts `add` as JSON string or array.
  - Rejects persisted `id` on adds; agents should use `tempId`.
  - Resolves `tempId` references through `frameId`, `containerId`, `startBinding.elementId`, and `endBinding.elementId`.
  - Expands `label: { text }` into bound text, including update-time label creation.

### Test coverage

Added unit tests proving:
- official separator-insensitive search semantics;
- official tempId reference mapping;
- operation order delete→update→add;
- label expansion to bound text;
- binding restoration for newly-added arrows referencing existing and tempId elements.

Updated dist stdio smoke to exercise the new official-compatible tools over MCP.

## Linear execution plan

Project: Hybrid Excalidraw MCP: Local + Official

Issues:
- ADR-180 — [SPEC] Hybrid Excalidraw MCP architecture and official API contract
- ADR-181 — [BUILD] Official-compatible local scene-content tools
- ADR-182 — [BUILD] Excalidraw+ API storage adapter
- ADR-183 — [BUILD] Rendered visual QA loop
- ADR-184 — [DX] MCP App preview and checkpoint UX spike
- ADR-185 — [HYGIENE] Release gates and lint/generated-file cleanup

## Next implementation slices

1. **Official Plus adapter**
   - Add storage-provider interface: local provider now, plus provider later.
   - Validate official API key flow without logging secrets.
   - Implement list/create/get/update/delete scene content against Excalidraw+ once credentials are present.
   - Round-trip locally generated scenes through official API and compare canonical payloads.

2. **Visual QA loop**
   - Export PNG/SVG and run deterministic rendered-bounds checks.
   - Add optional vision/OCR inspection for final artifact issues: clipped text, overlaps, tiny text, low contrast, unreadable legends.

3. **Preview/checkpoint UX**
   - Borrow official MCP app patterns: preview resource, checkpoint restore, fullscreen human edit, screenshot-to-model feedback.

4. **Release hygiene**
   - Fix lint/generated-file ignore behavior.
   - Ensure `npm test`, `npm run typecheck`, `npm run lint`, and `npm run smoke:dist` are all green.

## Agent operating guidance

Default path for high-quality output:

1. Create scene with high-level local authoring tools.
2. Run `scene_analyze` and deterministic layout/polish tools.
3. Use `search_scene_content` + `edit_scene_content` for official-style targeted edits.
4. Run `scene_validate` and `scene_quality_gate`.
5. Export PNG/SVG/Excalidraw.
6. Persist locally now; persist to Excalidraw+ once the provider adapter is configured.

## ADR-182 adapter foundation

The first Excalidraw+ storage-adapter slice is intentionally limited to a secret-safe API client/provider foundation in `src/official/excalidrawPlusApiClient.ts`. It is not wired to MCP mutation tools yet.

Adapter boundary:
- Owns Excalidraw+ persistence and collaboration API calls: scene listing, metadata creation, scene-content read, destructive replacement, and merge patch.
- Keeps public-beta route/schema churn isolated behind typed request/response surfaces.
- Injects credentials through constructor options or `EXCALIDRAW_PLUS_API_KEY`; optional API base override uses `EXCALIDRAW_PLUS_API_BASE_URL`.
- Redacts authorization details from `AppError` messages/details and tests.
- Does not call the live Excalidraw+ API in automated tests; tests mock `fetch`.
- Does not replace the local authoring engine, layout compiler, scene analysis, quality gates, render/export, or visual-golden workflow.

Validation for this slice:

```bash
npx vitest run test/unit/excalidrawPlusApiClient.test.ts
npm run typecheck
git diff --check
```

Controller-side verification after the `/goal` implementation:

```text
npx vitest run test/unit/excalidrawPlusApiClient.test.ts
→ 1 file passed, 11 tests passed

npm run typecheck
→ passed

git diff --check
→ passed

npm test
→ 13 files passed, 60 tests passed

npm run lint
→ passed

npm run smoke:dist
→ dist stdio smoke passed
```

Known boundary for ADR-182 after this slice:
- The Plus API adapter exists and is mock-tested, but MCP tools for remote list/create/get/replace/patch are intentionally not wired yet.
- No live Excalidraw+ API call was made; live smoke should only run after an explicit API key and target collection/scene scope are chosen.
- Follow-up Linear issue: ADR-186 — wire the Plus API client into safe MCP tools, read-only first, destructive writes gated by explicit docs/tests.

## ADR-186 MCP Plus tool wiring

Implemented the safe MCP-facing adapter layer for the official Excalidraw+ provider without changing the local authoring/QA default path.

New tools:
- `plus_api_status` — read-only configuration status; never exposes API keys and does not make a network call.
- `plus_scenes_list` — read-only remote scene metadata discovery.
- `plus_scene_content_get` — read-only official scene-content fetch.
- `plus_scene_create` — creates an empty remote scene record.
- `plus_scene_content_patch` — merge-patches official scene content; preferred for incremental persistence because omitted elements are preserved.
- `plus_scene_content_replace` — destructive full replace of official scene content; annotated as destructive and documented as whole-scene publish/restore only.

Provider wiring:
- `createExcalidrawMcpServer` now accepts an injectable `plusProvider` for tests and falls back to `createExcalidrawPlusStorageProviderFromEnv()` for runtime.
- `registerTools` receives the provider explicitly, keeping official Excalidraw+ persistence isolated from local compiler, layout, quality, and export services.
- Automated MCP tests use a fake provider; no live Excalidraw+ calls are made in CI/local verification.

ADR-186 validation:

```text
npx vitest run test/integration/excalidrawPlusTools.integration.test.ts --reporter=verbose
→ 1 file passed, 1 test passed

npm run typecheck
→ passed

npm test
→ 14 files passed, 61 tests passed

npm run lint
→ passed

npm run smoke:dist
→ dist stdio smoke passed
```

Updated boundary after ADR-186:
- The Plus MCP tool layer is wired and test-covered, but still intentionally secret-safe/offline by default.
- Live Excalidraw+ smoke remains opt-in and should only run after selecting an API key, target workspace/collection, and disposable test scene.
- The local server remains the pixel-perfect authoring engine; Plus tools are for official workspace persistence/collaboration and canonical scene-content round-trips.
