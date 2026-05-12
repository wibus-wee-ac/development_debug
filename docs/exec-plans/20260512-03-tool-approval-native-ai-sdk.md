# Tool Approval — Execute-Internal Await (Alma Pattern)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document must be maintained in accordance with `docs/exec-plans/README.md`.

## Purpose / Big Picture

让 openai-compatible provider 的 tool call 能触发 approval flow，使用 **Alma 模式**（在 tool execute 函数内部 `await` approval）。

**当前状态**：
- `apps/server/src/modules/approval/` 有完整的 approval 系统（SSE stream、policy keys、allow_always、`requestApproval()` Promise API）
- 但 `ai-sdk-engine.ts` 的 `streamText()` 没有集成 approval — tool call 直接执行
- Approval 系统只被 ACP provider 使用（`requestPermission` 回调）
- openai-compatible provider 的 tool call **完全没有 approval 拦截**

**目标状态**：
- Tool 的 `execute` 函数内部 `await approvalService.requestApproval()` 阻塞等待用户审批
- `streamText()` 在 tool execute 期间暂停（AsyncGenerator idle），SSE 流保持 open
- 复用现有 `approval/service.ts` 的 SSE 推送和 policy key 机制
- 智能分层放行：policy key 自动放行 → 安全 tool 白名单 → 用户弹窗

**为什么不用 AI SDK v6 原生 `needsApproval`**：
- 原生 flow 是"停-批-续"模式：`streamText()` 返回 → 外部 approve → 重新调用 `streamText()`
- 这需要 approval loop wrapper，增加复杂度
- 且与 Cradle 的 `streamTurn()` 单次 AsyncGenerator 协议不兼容
- Alma 在生产环境验证了 execute-internal await 模式，可靠运行
- AI SDK v6 的 `ToolExecuteFunction` 返回 `PromiseLike<OUTPUT>`，SDK 会 await，没有内置超时限制
- 长期可预留迁移到原生 `needsApproval` 的路径

**为什么不回退 AI SDK v5**：
- v5 的 tool execute 行为与 v6 相同（都是 async，都会 await）
- 回退成本极高（`CoreMessage→ModelMessage`, `maxSteps→stopWhen`, `parameters→inputSchema` 等大量已完成工作）
- v5 没有任何额外优势

验证方式：openai-compatible provider 的 tool call 能触发 approval 弹窗，allow_always 能跳过弹窗，rejected 的 tool call 不执行。


## Architecture Design

### Alma 模式：Execute-Internal Await

```
Client POST /response
    │
    ▼
streamText({ tools: { bash: wrappedTool({ ... }) } })
    │
    │  Model outputs tool_call(bash, { command: "rm -rf /" })
    │  AI SDK calls tool.execute()
    │
    ▼
execute() 内部:
    │  1. 检查 policy key → 已允许？→ 跳过 approval
    │  2. 检查白名单 → 安全 tool？→ 跳过 approval
    │  3. 需要审批 →
    │     a. 通知 SSE client (通过 /approvals/stream)
    │     b. await approvalService.requestApproval() ← 阻塞!
    │     c. 用户 POST /approvals/:id/respond
    │     d. Promise resolve → 继续或 throw
    │
    ▼
// SSE /response 流保持 open，无数据（idle）
// streamText generator 被 tool execute 的 await 暂停
// 用户审批后，generator 继续产出 tool-result chunk
    │
    ▼
Continue streaming (text-delta, next tool call, ...)
```

### Alma 参考实现

Alma 在 tool execute 内部的完整 flow：

```typescript
// Bash tool 的 execute 函数（简化自 Alma 源码）
async function bashExecute(command, ctx) {
  // Step 1: AI 风险分析（generateText, 10s 超时）
  const analysis = await analyzeBashCommand(command)

  if (analysis.needsPermission) {
    // Step 2: 通知 UI "approval-requested"
    ctx.onPartUpdate(toolCallId, -1, { state: 'approval-requested' })

    // Step 3: 阻塞等待用户审批 ← 关键！
    const approval = await ih({
      source: 'bash',
      title: 'Allow Bash Command?',
      message: `${command}\nRisk: ${analysis.riskLevel}`,
      type: analysis.riskLevel === 'high' ? 'danger' : 'warning',
      threadId: ctx.threadId,
    })

    // Step 4: denied → throw error（终止 tool）
    if (!approval.approved) {
      throw new PermissionDeniedError(reason)
    }
  }

  // Step 5: 实际执行命令
  return child_process.spawnSync(command, ...)
}
```

### 关键设计决策

#### D1: Tool Execute 内部 Await 的安全性

AI SDK v6 `ToolExecuteFunction` 返回 `PromiseLike<OUTPUT>`。SDK 在 tool 执行时 `await` 这个 Promise：
- 没有内置超时（`timeout` 配置只影响 LLM HTTP 调用）
- 唯一取消方式是 `abortSignal`
- execute 可以 await 任意长时间

**SSE idle 风险**：approval 等待可能几十秒甚至几分钟，SSE 连接可能被中间件（Nginx/CDN/LB）断开。

**缓解**：在 SSE transport 层加 heartbeat。每 15 秒发送 SSE comment（`: heartbeat`），不是 UIMessageChunk 的一部分，但能保持连接 alive。

#### D2: Tool Wrapping 方式

在 `ai-sdk-engine.ts` 注册 tool 时，用 wrapper 包装 execute 函数：

```typescript
function wrapToolWithApproval(
  name: string,
  originalTool: Tool,
  ctx: { chatSessionId: string, approvalService: ApprovalService },
): Tool {
  return {
    ...originalTool,
    execute: async (input, options) => {
      const policyKeys = generatePolicyKeys({
        providerKind: 'openai-compatible',
        chatSessionId: ctx.chatSessionId,
        toolName: name,
      })

      // 1. Policy key 自动放行
      if (ctx.approvalService.isPreviouslyAllowed(ctx.chatSessionId, policyKeys)) {
        return originalTool.execute(input, options)
      }

      // 2. 安全 tool 白名单
      if (SAFE_TOOLS.has(name)) {
        return originalTool.execute(input, options)
      }

      // 3. 请求审批（阻塞直到用户响应）
      const approval = await ctx.approvalService.requestApproval({
        chatSessionId: ctx.chatSessionId,
        agentId: 'openai-compatible',
        prompt: `Allow tool "${name}"?\nInput: ${JSON.stringify(input)}`,
        options: [
          { optionId: 'allow_once', label: 'Allow Once' },
          { optionId: 'allow_always', label: 'Allow Always' },
          { optionId: 'deny', label: 'Deny' },
        ],
      })

      if (approval.decision === 'rejected') {
        throw new Error(`Tool "${name}" was denied by user`)
      }

      // 4. 如果选了 allow_always，记录 policy key
      if (approval.selectedOptionId === 'allow_always') {
        ctx.approvalService.markAllowed(ctx.chatSessionId, policyKeys)
      }

      return originalTool.execute(input, options)
    },
  }
}
```

#### D3: 安全 Tool 白名单

```typescript
const SAFE_TOOLS = new Set([
  'attempt_completion',  // 终止信号，不执行任何操作
  // 其他只读 tool 可以后续添加
])
```

初始只有 `attempt_completion` 自动放行。其他 tool 全部需要 approval。用户可以通过 `allow_always` 逐步建立信任。


## Phases

### Phase 1: Execute-Internal Approval (ai-sdk-engine.ts)

**目标**：openai-compatible provider 的 tool call 能触发 approval flow。

**文件变更**：
- `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts` — 用 `wrapToolWithApproval()` 包装所有 user tool（AttemptCompletion 除外）
- `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts` — 新文件：approval wrapper 逻辑
- `apps/server/src/modules/chat-runtime/service.ts` — 将 `ApprovalService` 注入到 engine input
- SSE transport 层 — 添加 heartbeat（`: heartbeat` comment every 15s）防止 idle 断连

**验证**：
- 发消息触发 tool call → SSE 流中出现 approval event（通过 /approvals/stream）
- POST /approvals/:id/respond → tool 执行并返回结果
- 拒绝 → tool throw error，模型收到 error 信息

### Phase 2: 智能分层放行

**目标**：policy key 自动放行，减少用户交互摩擦。

**文件变更**：
- `apps/server/src/modules/approval/service.ts` — 添加 `shouldAutoApprove(context)` 方法
- `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts` — `needsApproval` 函数中集成 policy key 检查

**放行规则**：
```
autoApprove =
  isPreviouslyAllowed(sessionId, policyKey) ||     // allow_always 过的
  isSafeTool(toolName) ||                           // 白名单 tool (如 read_file)
  isReadOnlyOperation(toolName, input)              // 只读操作
```

**验证**：
- 首次 tool call → 弹 approval
- 选择 "Allow Always" → 同 session 同 tool 再次调用 → 自动放行
- read_file 类 tool → 直接放行不弹窗

### Phase 3: E2E 验证 + Approval 审计

**目标**：验证现有前端 approval UI 与新的 engine-level approval 端到端工作；添加审计记录。

**前端已存在的组件**（无需新建）：
- `apps/web/src/features/approval/approval-card.tsx` — ApprovalCard (Allow Once / Always Allow / Deny)
- `apps/web/src/features/approval/use-approval.ts` — `useApprovalRequests()` hook
- `apps/web/src/features/approval/sse-approval-connector.ts` — `connectApprovalStream()` SSE
- `apps/web/src/features/chat/chat-view.tsx` — 已渲染 `<SessionApprovalList>`
- `apps/web/src/features/chat/tool-call-block.tsx` — ToolState 已有 `'approval-requested'`

**可能需要的改动**：
- 确认 `sse-approval-connector.ts` 能正确消费新的 approval events（应该零改动，因为 approval service 的 SSE 格式没变）
- 可选：添加 `approval_audit` DB 表记录审批历史（为未来迁移到原生 needsApproval 做准备）

**验证**：
- Web 端发消息 → tool call → approval 弹窗出现在 chat composer 上方
- 点击 Allow Once → tool 执行
- 点击 Always Allow → 后续同 tool 自动放行
- 点击 Deny → tool 被拒绝，模型收到 error


## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|------|------|------|
| SSE 流在 approval 等待期间超时 | 客户端断开 | 每 15s 发送 `: heartbeat` SSE comment |
| AI SDK 未来版本给 execute 加超时 | Alma 模式 break | 监控 AI SDK changelog；长期预留迁移到原生 needsApproval |
| approval 结果不在 ModelMessage 历史中 | 重放/审计不完整 | Phase 3 添加 approval_audit 表记录审批历史 |
| 并发 approval requests | 同一个 tool call 可能被多个客户端同时审批 | approval service 已有 promise 去重 |
| tool execute 内 throw Error 的 UX | 模型收到 error string，可能困惑 | 使用明确的 PermissionDeniedError message |


## Progress

- [x] Phase 1: Execute-Internal Approval
- [x] Phase 2: 智能分层放行
- [x] Phase 3: E2E 验证 + Approval 审计


## Surprises & Discoveries

_(empty — to be filled during implementation)_


## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-12 | 使用 Alma 模式（execute-internal await）而非 AI SDK 原生 needsApproval | 单次 streamText 调用，与 AsyncGenerator 协议兼容，代码量极小，Alma 生产验证 |
| 2026-05-12 | 不回退 AI SDK v5 | v5 的 tool execute 行为与 v6 相同，回退成本极高（大量已完成的 v6 迁移），无任何优势 |
| 2026-05-12 | 长期预留迁移到原生 needsApproval 的路径 | 原生 flow 的优势在于消息历史完整性（approval 结果写入 ModelMessage），未来审计需求时迁移 |


## Outcomes & Retrospective

_(empty — to be filled after completion)_
