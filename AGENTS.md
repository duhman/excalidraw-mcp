# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript MCP server for programmatic Excalidraw authoring. Source lives in `src/`: `server/` registers MCP prompts, tools, and resources; `transports/` provides stdio and HTTP entry points; `domain/` holds scene logic, validation, quality checks, and storage; `engines/` contains JSON and browser export engines. Supporting code is in `account/`, `export/`, `types/`, and `utils/`. Tests live in `test/unit/` and `test/integration/`. Scripts are in `scripts/`, docs in `docs/`, and generated artifacts in `dist/` or `tmp/`.

## Build, Test, and Development Commands

- `npm install`: install dependencies and build the local Excalidraw API.
- `npm run dev`: run `src/index.ts` with the default stdio transport.
- `npm run dev:http`: run the HTTP transport locally.
- `npm run build`: rebuild the API bundle, compile TypeScript, and sync runtime assets.
- `npm test`: run the full local gate: build first, then `vitest run`.
- `npm run typecheck`: run strict TypeScript checks without emitting files.
- `npm run lint`: run ESLint over JavaScript and TypeScript files.
- `npm run smoke:dist`: smoke-test the compiled stdio server in `dist/`.

Install Chromium with `npx playwright install chromium` for browser export tests.

## Coding Style & Naming Conventions

Use ES modules and strict TypeScript targeting ES2022/NodeNext. Keep files focused by domain and prefer contracts from `src/types/contracts.ts`. Use camelCase for functions and variables, PascalCase for types/classes, and lower camelCase filenames such as `sceneService.ts`. ESLint uses `@typescript-eslint/recommended`; `any` is allowed, but prefer explicit public-boundary types. Do not edit generated `dist/` output directly.

## Testing Guidelines

Vitest discovers `test/**/*.test.ts` with 60-second timeouts. Put isolated behavior tests in `test/unit/` and MCP/browser/export flows in `test/integration/`. Name tests after the module or workflow, for example `sceneService.test.ts` or `http.transport.test.ts`. Run `npm test`, `npm run typecheck`, and `npm run lint` before opening a PR. Visual failures may write artifacts to `tmp/generated` or `tmp/visual-golden-mismatches`.

## Commit & Pull Request Guidelines

History uses short imperative commits, sometimes with Conventional Commit prefixes such as `feat:` and `chore:`. Keep commits scoped, for example `feat: add diagram quality gate` or `Fix stdio smoke test`. PRs should include a behavior summary, linked issue or rationale, test commands run, and screenshots or exported artifacts when visual output changes. Note any account-linking or browser-session requirements.

## Security & Configuration Tips

Do not commit local account credentials, browser profiles, or workspace state from `.excalidraw-mcp/`. Account smoke scripts require a real authenticated session and should remain opt-in manual checks.
