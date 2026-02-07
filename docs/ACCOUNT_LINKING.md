# Account Linking Guide

## What this integration is
This project links MCP-generated content to Excalidraw/Excalidraw+ using an authenticated browser session, not private account APIs.

## Why this approach
Excalidraw integration docs focus on self-hosted app integration and file-level workflows. This MCP implements account persistence through UI import with persistent browser profiles.

## Core flow
1. `account.login_session`
2. `account.import_scene` or `account.import_library`
3. `account.link_status`

## Session model
- Each `session` maps to a persistent browser profile under:
  - `.excalidraw-mcp/account/profiles/<session>`
- Reuse the same `session` to avoid repeated login.

## Login checkpoints
`account.login_session` returns:
- `status: "ready"` when authenticated and canvas detected.
- `status: "checkpoint_required"` when manual sign-in is still needed.

In `checkpoint_required`:
- Run in `headed` mode.
- Complete sign-in/MFA in the launched browser profile.
- Re-run `account.login_session` with the same `session`.

## Import strategy order
`account.import_scene` and `account.import_library` attempt deterministic upload methods:
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

## Best practices
- Use `mode: headed` for first-time session setup.
- Keep `closeOnComplete: false` while manually authenticating.
- After login is stable, use `allowInteractiveLogin: false` during imports for deterministic automation.
- Use one named session per human/operator.

## Troubleshooting
- `checkpoint_required` repeatedly:
  - verify sign-in completed in same `session`
  - inspect screenshot path returned by tool
- `All import strategies failed`:
  - destination UI changed or auth is incomplete
  - retry in `headed` mode and inspect UI manually
- Browser launch errors:
  - reinstall Playwright browsers if needed:
    - `npx playwright install chromium`
