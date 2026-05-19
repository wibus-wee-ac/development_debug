# ReviewE Chat Dirty Audit

## Scope

- Area: `apps/web/src/features/chat`
- Role: ReviewE for multi-work continuous improvement
- Constraint: source code was not edited; this handoff only records a low-risk follow-up candidate.

## Files Inspected

- `apps/web/src/features/chat/chat-minimap.tsx`
- `apps/web/src/features/chat/chat-view.tsx`
- `apps/web/src/features/chat/tool-call-block.tsx`
- `apps/web/src/features/chat/README.md`
- `apps/web/src/features/chat/composer.test.tsx`
- `apps/web/src/features/chat/use-chat-session.test.ts`
- `apps/web/src/features/chat/tool-ui-classifier.test.ts`
- `apps/web/src/features/chat/chat-render-plan.test.ts`
- `apps/web/src/features/chat/chat-streaming-handler.test.ts`
- `apps/web/src/features/chat/use-chat-session-binding.test.tsx`
- `apps/web/src/features/chat/blocks/tool-call-block.test.tsx`
- `package.json`
- `apps/web/package.json`

## Current Dirty Diff Summary

- `chat-minimap.tsx` migrates from `forwardRef` to a React 19-style `ref` prop, keeps the imperative `ChatMinimapHandle`, and moves the hover peek `top` transition from inline style to a static Tailwind class.
- `chat-view.tsx` replaces numeric skeleton keys with stable named keys.
- `tool-call-block.tsx` replaces an object label map with ordered regex label patterns.
- Chat README and chat tests are currently clean.

## Finding

Low-risk test gap: `ChatMinimap` now relies on React 19 `ref` as a normal prop while still exposing `setScrollProgress` to `chat-view.tsx`. There is no current chat test that renders `ChatMinimap` with a ref and verifies the imperative handle still drives bar progress after the migration.

This is worth closing because the runtime behavior is easy to regress silently: the component renders fine without the ref, but `chat-view.tsx` depends on `minimapRef.current?.setScrollProgress(scrollRatio)` to update minimap progress during virtual scrolling.

## Risks

- Functional risk is low if the current diff is kept: repo dependencies use React 19, so the `ref` prop shape is expected to type-check.
- Coverage risk remains moderate without a focused test: a later refactor could remove or break the handle without failing existing tests.
- Avoid broad UI changes here. The minimap is an overlay tied to scroll virtualization, pointer events, and layout metrics; visual tweaks should be verified separately.

## Recommended Next Action

Add a small jsdom test for `ChatMinimap` in a new focused test file, for example `apps/web/src/features/chat/chat-minimap.test.tsx`.

Suggested coverage:

- Render `ChatMinimap` with two or three `UIMessage` entries and a `React.createRef<ChatMinimapHandle>()`.
- Assert `ref.current?.setScrollProgress` is defined after render.
- Call `setScrollProgress(0.5)` inside `act`.
- Assert at least one progress fill node has a `style.transform` value updated from `scaleX(0)`.

Keep the test local to the imperative handle contract. Do not test full drag behavior in this pass unless a later worker owns pointer-event coverage.

Suggested command:

```bash
pnpm --filter @cradle/web test -- src/features/chat/chat-minimap.test.tsx
```

