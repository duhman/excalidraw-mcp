# Account Linking Guide

## What this integration is
This project links MCP-generated content to Excalidraw/Excalidraw+ using an authenticated browser session, not private account APIs.

## Why this approach
Excalidraw integration docs focus on self-hosted app integration and file-level workflows. This MCP implements account persistence through UI import with persistent browser profiles.

## Core flow
1. `account_login_session`
2. `account_import_scene` or `account_import_library`
3. `account_link_status`

## Session model
- Each `session` maps to a persistent browser profile under:
  - `.excalidraw-mcp/account/profiles/<session>`
- Reuse the same `session` to avoid repeated login.

## Login checkpoints
`account_login_session` returns:
- `status: "ready"` when authenticated and canvas detected.
- `status: "checkpoint_required"` when manual sign-in is still needed.
- `reasonCode: "READY"` or `reasonCode: "AUTH_NOT_READY"`

In `checkpoint_required`:
- Run in `headed` mode.
- Complete sign-in/MFA in the launched browser profile.
- Re-run `account_login_session` with the same `session`.

## Import strategy order
`account_import_scene` and `account_import_library` attempt deterministic upload methods:
1. Existing `input[type=file]`
2. Open-file keyboard shortcut (`Cmd/Ctrl+O`) + file chooser
3. Menu-triggered Open/Import + file chooser

## Verification performed
After upload attempt, importer verifies:
- destination host matches expected (`plus.excalidraw.com` or `excalidraw.com`)
- canvas presence
- no immediate error toast patterns

Proof artifact:
- screenshot written to `.excalidraw-mcp/account/artifacts/`

Import results now include explicit `reasonCode` values:

- `IMPORTED`
- `IMPORT_STRATEGY_FAILED`
- `POST_IMPORT_VERIFICATION_FAILED`

## Best practices
- Use `mode: headed` for first-time session setup.
- Keep `closeOnComplete: false` while manually authenticating.
- After login is stable, use `allowInteractiveLogin: false` during imports for deterministic automation.
- Use one named session per human/operator.
- Finish the local scene workflow first:
  `scene_analyze -> scene_normalize/layout_polish -> scene_validate -> export`
  before importing into an account destination.

## Troubleshooting
- `checkpoint_required` repeatedly:
  - verify sign-in completed in same `session`
  - inspect screenshot path returned by tool
- `reasonCode: "IMPORT_STRATEGY_FAILED"`:
  - destination UI changed or auth is incomplete
  - retry in `headed` mode and inspect UI manually
- `reasonCode: "POST_IMPORT_VERIFICATION_FAILED"`:
  - import interaction likely happened, but destination UI did not reach a healthy ready state
  - inspect the screenshot artifact and rerun in `headed` mode
- Browser launch errors:
  - reinstall Playwright browsers if needed:
    - `npx playwright install chromium`

## Manual Smoke Scripts

The repo includes opt-in manual smoke scripts for release verification:

- `npm run smoke:account:plus`
- `npm run smoke:account:excalidraw`

These require a real authenticated browser session and are intentionally not part of default CI.
