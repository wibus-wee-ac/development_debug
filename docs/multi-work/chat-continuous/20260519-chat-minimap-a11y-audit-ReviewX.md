# ReviewX Chat Minimap Accessibility Audit

## Scope

- Area: `apps/web/src/features/chat/chat-minimap.tsx`
- Tests: `apps/web/src/features/chat/chat-minimap.test.tsx`
- Documentation: `apps/web/src/features/chat/README.md`
- Role: independent multi-work review agent
- Constraint: source code was not edited; this file records review findings only.

## Verdict

Fail.

The minimap has been migrated away from the `aria-hidden` pseudo-button pattern and now exposes the track as a native button. The implementation preserves the React 19 ref prop handle, pointer-based click-to-message, drag-to-scroll, and sibling hover preview structure. However, keyboard activation has an observable regression: the custom `onKeyDown` handler prevents the native button activation path for `Enter` and `Space`, but only calls `onScrollToIndex` when a hover index already exists. A keyboard user who tabs to the minimap and presses `Enter` or `Space` gets no action.

## Findings

### Blocking: keyboard activation can be swallowed with no scroll target

- File: `apps/web/src/features/chat/chat-minimap.tsx:251`
- File: `apps/web/src/features/chat/chat-minimap.tsx:274`

`scrollToHoveredMessage` only invokes `onScrollToIndex` when `uiState.hoverIdx !== null`. The native button then installs `onKeyDown`, intercepts `Enter` and `Space`, calls `e.preventDefault()`, and delegates to `scrollToHoveredMessage`.

For pointer users, `hoverIdx` is populated by pointer movement/down events. For keyboard-only users, focusing the button does not establish a hover index. Because the handler prevents default native button activation, React's `onClick` path is not allowed to provide a fallback either. This means the track is accessible by role/name, but keyboard activation has no effect in the common focus-then-press flow.

Recommended fix direction:

- Either remove the custom `onKeyDown` and let the native button activate `onClick`, while making `onClick` resilient to keyboard-generated clicks that have no useful `clientY`; or
- Keep custom keyboard handling but choose a deterministic keyboard target, such as the current hovered index when present and a stable fallback otherwise, and add a test for focus + `Enter`/`Space`.

### Pass: `aria-hidden` pseudo-button pattern is removed

- File: `apps/web/src/features/chat/chat-minimap.tsx:270`

Scoped grep found no `aria-hidden="true"`, `role="button"`, or `tabIndex={0}` in `chat-minimap.tsx`. The track is rendered as `<button type="button" aria-label="Chat minimap">`.

### Pass: hover preview is no longer nested inside the button

- File: `apps/web/src/features/chat/chat-minimap.tsx:317`
- File: `apps/web/src/features/chat/chat-minimap.tsx:320`

The button closes before the hover preview popover is rendered. The preview is a sibling under the overlay container, avoiding invalid interactive/content structure inside the button.

### Pass: pointer capture uses the event current target

- File: `apps/web/src/features/chat/chat-minimap.tsx:189`
- File: `apps/web/src/features/chat/chat-minimap.tsx:229`

`setPointerCapture` and `releasePointerCapture` are both called on `e.currentTarget`, so clicks that originate from an internal bar span do not capture on the wrong descendant.

### Pass: React 19 ref prop imperative handle is preserved

- File: `apps/web/src/features/chat/chat-minimap.tsx:19`
- File: `apps/web/src/features/chat/chat-minimap.tsx:163`
- File: `apps/web/src/features/chat/chat-minimap.test.tsx:23`

The component still accepts `ref?: Ref<ChatMinimapHandle>` as a prop and wires it through `useImperativeHandle`. The focused test renders with `createRef`, verifies the handle function exists, and confirms `setScrollProgress(0.5)` updates progress fill transforms.

### Pass: pointer click-to-message and drag-to-scroll boundaries look intact

- File: `apps/web/src/features/chat/chat-minimap.tsx:186`
- File: `apps/web/src/features/chat/chat-minimap.tsx:205`
- File: `apps/web/src/features/chat/chat-minimap.tsx:238`
- File: `apps/web/src/features/chat/chat-minimap.test.tsx:50`

Pointer down stores drag and hover state. Pointer move updates hover state and calls `onScrollTo` while dragging. Pointer click maps the event Y coordinate to a message index through the button rect. The new accessible-button test verifies a click at 75% height maps to index `1` for two messages.

### Pass: README documents the accessible minimap responsibility

- File: `apps/web/src/features/chat/README.md:19`
- File: `apps/web/src/features/chat/README.md:20`

The README now describes `chat-minimap.tsx` as an accessible right-edge chat minimap and lists regression coverage for the React 19 ref prop handle plus native button behavior.

### Pass: Tailwind classes remain static

- File: `apps/web/src/features/chat/chat-minimap.tsx:285`
- File: `apps/web/src/features/chat/chat-minimap.tsx:291`
- File: `apps/web/src/features/chat/chat-minimap.tsx:304`
- File: `apps/web/src/features/chat/chat-minimap.tsx:322`
- File: `apps/web/src/features/chat/chat-minimap.tsx:329`

Conditional styling uses static class strings through `cn()`. I did not find dynamic Tailwind class construction. Inline `style` is used only for measured width, transform, and popover top positioning.

## Verification Reviewed

- Reviewed the scoped implementation and tests directly.
- Confirmed scoped grep for `aria-hidden="true"`, `role="button"`, and `tabIndex={0}` has no matches in `chat-minimap.tsx`.
- Did not rerun the full provided command set in this review pass; the supplied context states the focused Vitest file, TypeScript, React Doctor, and web test suite passed.

