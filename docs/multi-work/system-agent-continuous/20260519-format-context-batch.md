# System Agent Format Context QA Batch

## Scope

This batch continued the Cradle DX/QA improvement stream in `apps/web/src/features/system-agent`.

The target was the Jarvis context formatter:

- add regression coverage for the `<cradle_context>` prompt prefix;
- make user-controlled context values safe for the block boundary;
- fix notable layout and duplicated tab label edge cases.

## Changes

- Updated `apps/web/src/features/system-agent/format-context.ts`.
  - Normalizes user-controlled context values to a single line.
  - Neutralizes `<cradle_context>` and `</cradle_context>` tags inside user-controlled values.
  - Escapes other angle brackets in user-controlled values.
  - Includes `bottom panel open` in the layout summary when `bottomPanelOpen` is true.
  - Avoids filtering all duplicated tab labels by skipping only one active-tab match.
- Added `apps/web/src/features/system-agent/format-context.test.ts`.
  - Covers active view, params, chat summary, layout, unread count, and profile formatting.
  - Covers no-active-tab fallback.
  - Covers newline and context-tag injection safety.
  - Covers duplicated tab labels.
- Updated `apps/web/src/features/system-agent/README.md`.
  - Added the new test file to the feature inventory.

## Review Loop

- ReviewN failed the first version because it only tested happy paths and missed high-risk context block boundaries.
- The follow-up implementation made formatter output safer and added explicit tests for:
  - user-controlled newline and context-tag values;
  - `bottomPanelOpen`;
  - duplicated tab labels.
- ReviewO passed and confirmed all three ReviewN failures were addressed.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/system-agent/format-context.test.ts
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest . --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- System-agent targeted test after fix: 1 file / 4 tests passed.
- Web typecheck: passed.
- React Doctor diff scan: 100/100, no issues.
- Web full test suite after fix: 28 files / 104 tests passed.

## Notes

- This batch intentionally does not change Jarvis session creation or preference persistence.
- The formatter remains intentionally concise; it only emits notable layout state.
