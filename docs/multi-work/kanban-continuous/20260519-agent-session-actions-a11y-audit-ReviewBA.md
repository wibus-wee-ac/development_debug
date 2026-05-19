<!--
Input: Agent session action accessibility batch, focused diff, and focused Vitest result
Output: Independent ReviewBA audit report for the agent session action accessibility node
Position: Multi-work audit artifact for kanban continuous accessibility review
-->

# ReviewBA Audit: Agent Session Actions A11y

## Verdict

PASS.

本节点改动范围符合目标：Stop 和 Open Chat 的视觉图标已标记为装饰性，控件 accessible name 保持为 `Stop` / `Open Chat`，Stop mutation payload 与 Open Chat route 参数行为有回归覆盖，未发现动态 Tailwind class 或越界功能变更。

## Findings

无阻塞或非阻塞发现。

## Checks

- `agent-session-panel.tsx`
  - Stop action 内的 `SquareIcon` 增加 `aria-hidden="true"`，按钮文本仍为 `Stop`。
  - Open Chat action 内的 `ExternalLinkIcon` 增加 `aria-hidden="true"`，链接文本仍为 `Open Chat`。
  - Stop mutation 仍调用 `stopSession.mutate({ agentSessionId: activeSession.id, issueId })`。
  - Open Chat 仍使用 `to="chat"` 与 `params={{ sessionId: activeSession.chatSessionId! }}`。
  - Tailwind class 均为静态字符串；未引入动态 Tailwind class。
  - 改动仅限文件 header 与两个图标可访问性属性，未触及 session selection、polling、activity rendering、rerun、prompt input 或 chat navigation 语义。
- `agent-session-panel.test.tsx`
  - 使用 role/name 查询覆盖 `button` name `Stop` 与 `link` name `Open Chat`。
  - 断言两个 action 图标 `aria-hidden` 为 `true`。
  - 断言 Open Chat mock href 为 `/chat/chat-session-1`，覆盖 chat session 参数传递。
  - 点击 Stop 后断言 mutation payload 为 `{ agentSessionId: 'agent-session-1', issueId: 'issue-1' }`。
- `README.md`
  - 已记录 `agent-session-panel.tsx` 负责 decorative action icons 与 stop/rerun/open-chat controls。
  - 已记录 `agent-session-panel.test.tsx` 覆盖 accessible names、decorative icons 与 stop mutation wiring。
- Batch 文档
  - Scope、Changes、Verification 与 Notes 覆盖本节点目标和边界。
  - 记录 focused test 已通过，其他较大验证项仍为 pending，表述与当前审查范围一致。

## Verification

已运行 focused test：

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/issue-detail/agent-session-panel.test.tsx
```

结果：

```text
Test Files  1 passed (1)
Tests       2 passed (2)
```

未修改源码；本审查仅新增该报告文件。
