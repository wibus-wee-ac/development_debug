# Approval SSE State Audit - ReviewR

## Verdict

PASS

本次只读审查范围：

- `apps/web/src/features/approval/use-approval.ts`
- `apps/web/src/features/approval/approval-state.ts`
- `apps/web/src/features/approval/approval-state.test.ts`
- `apps/web/src/features/approval/README.md`

辅助读取：

- `apps/server/src/modules/approval/index.ts`
- `apps/web/src/lib/contracts/approval-events.ts`

## Findings

### Blocking

无阻塞问题。

### Non-blocking

1. `apps/web/src/features/approval/use-approval.ts:46`

   `EventSource` `open` 时清空 pending 并 notify 的行为与当前 server SSE 语义匹配。server 在每次 `/approvals/stream` 连接 `start` 阶段都会先发送现有 pending approval 的 initial burst，然后再订阅 requested/resolved 事件（`apps/server/src/modules/approval/index.ts:38`）。因此 reconnect 时先清空本地 stale state，再用 initial burst 重建，可以修复断线期间已 resolved 的 approval 继续残留在 UI 的问题。

   代价是 reconnect 时如果本地非空，会触发一次短暂空列表渲染，然后 initial burst 再补回仍然 pending 的项。按当前协议没有 batch/end-of-snapshot 事件，清空是合理的保守选择。该行为不是 blocker，但建议后续如果要消除闪烁，应在 SSE 协议层增加 snapshot boundary，而不是在客户端猜测 burst 完成时机。

2. `apps/web/src/features/approval/approval-state.test.ts:24`

   现有测试覆盖了 helper 的关键 identity 语义：merge duplicate/no incoming 返回原数组，remove missing 返回原数组，clear empty 返回原数组。这足以保护 `useSyncExternalStore` 的 snapshot identity 基础约束。

   仍缺少 hook/SSE 层的直接回归测试：模拟 `EventSource` `open` 时，已有 pending 被清空且 listener 被通知；空 pending 时不通知；initial burst 的 duplicate requested 不产生额外通知。当前 helper 测试能间接覆盖大部分风险，但不能锁住 `setPendingApprovals` 与 `EventSource` callback 的组合行为。

## Identity And React Review

- `apps/web/src/features/approval/approval-state.ts:7` 的 `mergePendingApprovals` 在没有新增 id 时返回 `current`，有新增 id 时返回新数组，符合 `useSyncExternalStore` 需要的 stable snapshot identity。
- `apps/web/src/features/approval/approval-state.ts:30` 的 `removePendingApproval` 在目标 id 不存在时返回 `current`，避免 resolved duplicate 或 optimistic remove 后的 SSE resolved 再次触发无意义 render。
- `apps/web/src/features/approval/approval-state.ts:38` 的 `clearPendingApprovals` 在空数组时返回 `current`，避免 reconnect/open 在本地空状态下多余 notify。
- `apps/web/src/features/approval/use-approval.ts:30` 的 `setPendingApprovals` 使用引用比较控制 notify，和上述 helper identity 语义一致。
- `apps/web/src/features/approval/use-approval.ts:109` 每次 store 更新时会为 session filter 生成新数组。当前 pending approval 数量预期很小，且只在 approval stream 更新时运行，没有明显 render/perf 风险。

## AGENTS Compliance

- 新增 `approval-state.ts` 与 `approval-state.test.ts` 均包含文件头注释。
- `apps/web/src/features/approval/README.md` 已列出新增文件，符合目录 README 更新要求。
- 本次审查范围内未发现动态 Tailwind class 构造。
- 代码、注释、标识符为 English；README 正文为 English，未发现中文混入代码文件。
- 未发现跨 namespace 写入或 ownership 违规：web 端只维护 approval feature 自有 renderer-side SSE state。

## Verification

已验证目标单测：

```text
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/approval/approval-state.test.ts
```

结果：1 个 test file 通过，3 个测试通过。

## Recommendation

当前改动可以合入。建议后续补一个 hook/SSE integration-style 单测来固定 `open -> clear -> notify` 与 duplicate requested/resolved no-op notification 的行为；如果未来要避免 reconnect 闪烁，应先扩展 SSE 协议提供 snapshot boundary。
