<!-- Input: ExecPlan, chat rendering review, apps/web chat rendering files -->
<!-- Output: Chat rendering implementation handoff -->
<!-- Position: Multi-work frontend architecture fixes artifact for WorkerC -->

# Chat Rendering WorkerC Handoff

## Scope

原 chat rendering worker 因 429 失败，没有产出 handoff。主 agent 接管 Milestone 3 的低风险部分，写入范围保持在允许的 chat feature 文件内。

本次没有重写 chat 协议或 tool schema，只把已经存在的 tool classifier/rendering 进一步收口到可测试的 render-plan 边界，并补齐明显的 collapsible button accessibility 缺口。

## Changed Files

- `apps/web/src/features/chat/chat-render-plan.ts`
  - 新增纯 render-plan helper。
  - `groupMessageParts()` 负责把 `UIMessage.parts` 投影为 `ChatRenderItem[]`，保留 unknown/generic tool call 的 raw input/output/error 和 subagent children。
  - `splitExecutionPhase()` 负责从最后一个 tool 后 final text 处切分 execution details 和 final reply。
  - `hasFinalReply()` 改为复用纯 split 逻辑。

- `apps/web/src/features/chat/chat-render-plan.test.ts`
  - 覆盖 unknown tool 仍可渲染且保留 subagent children。
  - 覆盖 `tool -> final text` 的 fold 行为。
  - 覆盖 `text -> tool -> text -> tool -> final text` 时 preamble/intermediate text 仍归入 execution phase。
  - 覆盖没有 tool 后 final text 时不折叠。

- `apps/web/src/features/chat/message-bubble.tsx`
  - 删除本地 grouping/folding helper，改为使用 `chat-render-plan.ts`。
  - 保留现有 UI 行为，只把不可测试的 render-stage inference 移到纯模块。

- `apps/web/src/features/chat/blocks/reasoning-block.tsx`
  - toggle button 增加 `type="button"`、`aria-expanded`、`aria-controls`。
  - content region 增加 stable id。

- `apps/web/src/features/chat/blocks/read-files-block.tsx`
  - path buttons 和 expand/collapse buttons 增加 `type="button"`。
  - expand/collapse buttons 增加 `aria-expanded`。

- `apps/web/src/features/chat/blocks/tool-call-block.tsx`
  - tool toggle button 增加 `aria-expanded`、`aria-controls`。
  - expanded content 增加 matching id 和 stable `data-testid`。

## Behavior Fixed

- `MessageBubble` 的 render-plan 现在可单元测试，不再只能通过组件 render 间接覆盖。
- Unknown/custom tool calls 继续走 generic fallback，并且测试锁定了 output 与 subagent children 不会被丢弃。
- Execution details fold 的切分语义被明确为“最后一个 tool 后的最终 text 及其后续内容留在外部；之前内容归入 execution phase”。
- Chat reasoning/tool/read-files 折叠控件现在有基础 accessible expanded state，并避免默认 submit button 行为。

## Tests And Validation

已运行：

```bash
pnpm --filter @cradle/web exec vitest run src/features/chat/chat-render-plan.test.ts src/features/chat/tool-ui-classifier.test.ts
```

结果：

- 2 test files passed。
- 26 tests passed。

## Risks

- 本次没有处理更大的 protocol/schema ownership 问题。前端仍基于 tool name 与 input/output shape 做分类，后续若后端能提供 stable display metadata，应迁移到 schema-owned分类。
- `ReadFilesBlock` 当前不在 `MessageBubble` 主路径中使用，但仍补了基础 button semantics，未做视觉重构。
- `ToolCallBlock` 的 running shimmer 仍未加入 reduced-motion 分支；这是 UX polish 项，不阻塞本次 correctness fix。

## Escalation

没有需要阻塞 Milestone 3 的 Architecture Escalation Report。

建议后续单独决策：tool display metadata 是否应该由 server/tool schema 提供，前端 classifier 是否只作为 legacy fallback。
