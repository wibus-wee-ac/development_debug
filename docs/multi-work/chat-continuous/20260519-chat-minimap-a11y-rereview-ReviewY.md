# ReviewY Chat Minimap Accessibility Rereview

## Scope

- `apps/web/src/features/chat/chat-minimap.tsx`
- `apps/web/src/features/chat/chat-minimap.test.tsx`
- `apps/web/src/features/chat/README.md`
- `docs/multi-work/chat-continuous/20260519-chat-minimap-a11y-audit-ReviewX.md`

## Verdict

Pass.

ReviewX 的阻塞问题已修复。键盘激活现在不再依赖 pointer hover：`scrollToKeyboardMessage()` 会优先使用 `uiState.hoverIdx`，没有 hover 时 fallback 到 `activeIndexRef.current`，而 `activeIndexRef` 由 `setScrollProgress()` 按现有 visual progress active index 计算更新。

## Findings

### Pass: ReviewX 的 keyboard activation swallowed/no target 问题已修复

- `apps/web/src/features/chat/chat-minimap.tsx:118`
- `apps/web/src/features/chat/chat-minimap.tsx:137`
- `apps/web/src/features/chat/chat-minimap.tsx:142`
- `apps/web/src/features/chat/chat-minimap.tsx:253`
- `apps/web/src/features/chat/chat-minimap.tsx:274`

旧实现的 `scrollToHoveredMessage()` 只在 hover index 存在时生效。当前实现改为 `scrollToKeyboardMessage()`，在没有 hover index 时使用 `activeIndexRef.current`，因此键盘用户聚焦 minimap 后按键不会再被 `preventDefault()` 吞掉并变成无动作。

### Pass: Enter/Space 不再依赖 pointer hover

- `apps/web/src/features/chat/chat-minimap.tsx:274`

`onKeyDown` 对 `Enter` 和 `' '` 走同一个分支，都会调用 `scrollToKeyboardMessage()`。这条路径有 active index fallback，不要求先触发 pointer move/down。

### Pass: `activeIndexRef` 与现有 visual progress index 语义一致

- `apps/web/src/features/chat/chat-minimap.tsx:139`
- `apps/web/src/features/chat/chat-minimap.tsx:140`
- `apps/web/src/features/chat/chat-minimap.tsx:142`
- `apps/web/src/features/chat/chat-minimap.tsx:150`

`activeIndexRef.current` 复用同一个 `activeIndex` 计算结果：`progress * bars.length`，末尾进度 clamp 到最后一条消息，其余情况使用 `Math.floor(visualPosition)`。这与后续 fill scale 的 active bar 选择一致。

### Pass: ref imperative handle 未回归

- `apps/web/src/features/chat/chat-minimap.tsx:19`
- `apps/web/src/features/chat/chat-minimap.tsx:165`
- `apps/web/src/features/chat/chat-minimap.test.tsx:23`

React 19 ref prop 仍通过 `useImperativeHandle` 暴露 `setScrollProgress`。现有测试继续断言 handle 存在，并验证 fill transform 更新。

### Pass: pointer click、drag-to-scroll、hover preview sibling structure 未见回归

- `apps/web/src/features/chat/chat-minimap.tsx:188`
- `apps/web/src/features/chat/chat-minimap.tsx:207`
- `apps/web/src/features/chat/chat-minimap.tsx:240`
- `apps/web/src/features/chat/chat-minimap.tsx:270`
- `apps/web/src/features/chat/chat-minimap.tsx:317`
- `apps/web/src/features/chat/chat-minimap.tsx:320`

Pointer down 仍设置 drag/hover 状态并使用 `e.currentTarget.setPointerCapture()`；pointer move 在 dragging 时调用 `onScrollTo()`；click 仍按 event Y 映射到 message index。Hover preview 仍在 `</button>` 之后渲染，是 button sibling，不会形成 invalid interactive/content structure。

### Pass: 新测试覆盖 ReviewX 的失败模式

- `apps/web/src/features/chat/chat-minimap.test.tsx:50`
- `apps/web/src/features/chat/chat-minimap.test.tsx:86`
- `apps/web/src/features/chat/chat-minimap.test.tsx:90`
- `apps/web/src/features/chat/chat-minimap.test.tsx:92`

测试在没有建立 hover state 的情况下先通过 `setScrollProgress(0.75)` 设置 reading progress，然后触发 `Enter`，断言 fallback 到 active message index `1`。这覆盖了 ReviewX 指出的 keyboard activation 无 hover target 失败模式。

备注：测试只显式覆盖 `Enter`，没有单独覆盖 `Space`；实现中二者共享同一条件分支，因此本复审不将其列为阻塞。

## Verification Reviewed

- 直接复读限定范围源码、测试、README 与 ReviewX 报告。
- 确认 `chat-minimap.tsx` 中未重新引入 `aria-hidden="true"`、`role="button"`、`tabIndex={0}`。
- 采信本次上下文提供的验证结果：focused Vitest、TypeScript、React Doctor、`@cradle/web` test 均已通过。

