# Excalidraw MCP Expansion Plan

> For Hermes: use strict TDD and keep Linear project `Excalidraw MCP` as the system of record.

Goal: turn `excalidraw-mcp` into a high-leverage MCP backend for Hermes that can ingest, author, refine, export, and eventually publish Excalidraw scenes with as much practical capability coverage as possible.

Architecture
- Keep the current layered model: MCP server -> SceneService -> JsonEngine / BrowserEngine -> workspace storage.
- Prefer deterministic scene transforms over fuzzy browser automation whenever possible.
- Expand capabilities in slices that are testable and useful to AI agents immediately.

Completed in this iteration
- Added `scene.import_json`
- Added `library.import_json`
- Added `elements.arrange`
- Added `connectors.create`
- Added unit + integration coverage for the new authoring flows

Next slices
1. Export hardening
   - remove runtime CDN dependency from browser export path if practical
   - add browser-engine retry/recycle behavior tests
   - verify/implement `scale` support or remove it from the public contract if Excalidraw export APIs do not support it cleanly

2. Revision-aware mutations
   - add `expectedRevisionHash` support to mutating tools
   - reject stale writes with `CONFLICT`
   - add regression tests for stale-agent protection

3. Richer scene analysis for agents
   - add `scene.analyze` or `excalidraw://scene/{sceneId}/analysis`
   - expose node/edge graph summaries, labels, frames, bounds, and warnings

4. Deeper validation
   - orphaned bindings
   - missing frame targets
   - missing file references for image elements
   - non-finite geometry

5. Higher-level authoring helpers
   - frame creation / assign-to-frame
   - shape/text convenience constructors
   - selection-scoped transforms

Verification baseline
- `npm test`
- `npm run typecheck`
- `npm run build`
- end-to-end MCP smoke via integration tests before every push

Linear mapping
- ADR-34 audit/roadmap
- ADR-35 scene operations + import/export fidelity
- ADR-36 authoring/layout/validation primitives
- ADR-37 tests and smoke coverage
- ADR-38 docs and Hermes integration
