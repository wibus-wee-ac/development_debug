# TUI PTY Protocol QA Review

## Result

fail

## Scope

- `apps/web/src/features/tui/pty-protocol.test.ts`
- `apps/web/src/features/tui/README.md`
- Read for protocol semantics:
  - `apps/web/src/features/tui/pty-protocol.ts`
  - `apps/server/src/modules/pty/protocol.ts`
  - `apps/server/src/modules/pty/pty.socket.ts`
  - `apps/server/src/modules/pty/pty.timeline.ts`
  - `apps/server/src/modules/pty/pty.runtime.ts`

## Findings

### 1. Malformed `exit` payloads are treated as valid nullable exits

Severity: high

Location: `apps/web/src/features/tui/pty-protocol.test.ts:46`

The test named `parses exit events while normalizing optional exit fields to null` expects this payload to parse successfully:

- `type: 'exit'`
- `seq: 10`
- `exitCode: '0'`
- `signal: 15`

Expected result is currently an `exit` event with `exitCode: null` and `signal: null`.

That solidifies a weaker wire contract than the protocol types describe. Both renderer and server protocol definitions model `exitCode` as `number | null` and `signal` as `string | null`, not arbitrary values normalized to null. Server-side senders also construct exit events from typed runtime/timeline state, where `signal` is explicitly converted to `string` or `null`.

The important distinction is:

- Valid nullable fields: `exitCode: null`, `signal: null`
- Invalid malformed fields: `exitCode: '0'`, `signal: 15`

The current test makes malformed fields indistinguishable from intentional nulls. In renderer behavior this matters because `parsePtyServerEvent` feeds `createPtyChannel`; once an `exit` event is accepted, the channel sets `exitSeen = true`, stops reconnect scheduling, and calls `onExit`. A corrupted or incompatible server message could therefore terminate the client-side PTY channel instead of surfacing an invalid-message error.

Recommended fix:

- Keep coverage that explicit `null` values parse correctly for `exitCode` and `signal`.
- Change malformed `exitCode` / `signal` payloads to expect `null` parser result.
- Rename the test away from "optional exit fields"; these fields are nullable, not semantically optional.

### 2. Missing explicit coverage for valid `exit` nullability

Severity: medium

Location: `apps/web/src/features/tui/pty-protocol.test.ts:46`

The test covers a valid exit with concrete values and an invalid-type exit that is currently normalized to null, but it does not cover the valid protocol case where the server intentionally sends:

- `exitCode: null`
- `signal: null`

This leaves the intended nullable contract under-specified while over-specifying the malformed-type behavior from finding 1.

Recommended fix:

- Add an assertion for an exit event with explicit `null` fields.
- If the parser is meant to tolerate omitted fields as null, document that as a deliberate compatibility behavior and add separate tests for omitted fields. Otherwise, omitted `exitCode` / `signal` should be rejected as missing required protocol fields.

### 3. Invalid required-field coverage is uneven across event types

Severity: low

Location: `apps/web/src/features/tui/pty-protocol.test.ts:72`

The invalid payload test covers:

- invalid JSON
- non-object JSON
- unknown event type
- `snapshot` missing `running`
- `output` with invalid `seq`
- `error` missing `message`

This is useful baseline coverage, but the parser has required fields and type constraints that are not covered for `exit`, `pong`, and several fields on `snapshot` / `output` / `error`.

Important missing boundaries:

- `exit` with missing or invalid `seq`
- `exit` with explicit `null` fields
- `snapshot` with invalid `running`
- `snapshot` with invalid `buffer`
- `output` with invalid `data`
- `error` with invalid `code`

This is not a blocker by itself, but combined with finding 1 it means the most behaviorally sensitive event type has weaker negative coverage than the others.

## Checks

- Header check: `pty-protocol.test.ts` has the required file header.
- README check: `apps/web/src/features/tui/README.md` includes the new test file in the inventory.
- Code language check: test code, comments, identifiers, and README inventory entry are in English.
- Event coverage check: all current renderer/server server-event variants are represented in at least one happy-path assertion: `snapshot`, `output`, `exit`, `pong`, `error`.
- Source modification check: no source files were modified by this review.

## Verification

I did not run the test suite. This review is based on static inspection of the changed files and the renderer/server PTY protocol contracts.
