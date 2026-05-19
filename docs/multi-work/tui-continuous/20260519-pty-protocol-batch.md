# TUI PTY Protocol QA Batch

## Scope

This batch continued the Cradle DX/QA improvement stream in `apps/web/src/features/tui`.

The target was renderer-side PTY WebSocket protocol parsing:

- add regression coverage for `parsePtyServerEvent`;
- keep renderer parsing aligned with the server protocol types;
- reject malformed payloads before `createPtyChannel` treats them as valid terminal lifecycle events.

## Changes

- Updated `apps/web/src/features/tui/pty-protocol.ts`.
  - `exitCode` is now accepted only when it is `number | null`.
  - `signal` is now accepted only when it is `string | null`.
  - malformed `exit` messages are rejected instead of normalized to nullable fields.
- Added `apps/web/src/features/tui/pty-protocol.test.ts`.
  - Covers snapshot, output, pong, error, and exit happy paths.
  - Covers explicit nullable exit fields.
  - Covers invalid JSON, unknown event types, missing required fields, and invalid field types.
- Updated `apps/web/src/features/tui/README.md`.
  - Added the new protocol parser test to the feature inventory.

## Review Loop

- ReviewP failed the first version because malformed `exitCode` / `signal` values were expected to parse as valid nullable exits.
- The fix tightened parser validation and added explicit tests for valid nulls and invalid required fields.
- ReviewQ passed and confirmed the renderer parser now matches the server/web protocol contract.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/tui/pty-protocol.test.ts
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest . --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- TUI targeted test after fix: 1 file / 3 tests passed.
- Web typecheck: passed.
- React Doctor diff scan: 100/100, no issues.
- Web full test suite after fix: 29 files / 107 tests passed.

## Notes

- This batch intentionally does not change PTY channel reconnect behavior.
- Invalid parsed messages still surface through the existing `INVALID_MESSAGE` error path in `pty-channel.ts`.
