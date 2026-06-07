# Linear AI Intelligence Handoff

## 用途

这份文档用于未来重新启动会话时恢复上下文。新的 agent 不需要读取当前聊天历史，只需要读取本目录中的 SPEC 和当前工作树。

## 当前目标

基于 Linear 官方 AI 文档，设计 Cradle 的 Triage Intelligence、Code Intelligence 和 Agent Interaction Runtime。目标是脱离历史债务，从 owner、数据模型、权限、运行时协议、UI contract、eval 和实施顺序重新定义 feature。

## 已完成产物

- `docs/specs/linear-ai-intelligence/README.md`
- `docs/specs/linear-ai-intelligence/intelligence-runtime-architecture.md`
- `docs/specs/linear-ai-intelligence/triage-intelligence.md`
- `docs/specs/linear-ai-intelligence/code-intelligence.md`
- `docs/specs/linear-ai-intelligence/agent-interaction-runtime.md`
- `docs/specs/linear-ai-intelligence/handoff.md`

## 核心判断

Cradle 不应该把 Linear AI 类能力堆在现有 `issue-agent` 或 `search` 里。目标 owner 应拆成：

- `work-intelligence`: issue triage suggestions、property suggestions、duplicate/relationship detection、auto-apply policy、guidance。
- `code-intelligence`: repository registry、access policy、indexing、code-grounded answers、citation ledger。
- `agent-interaction-runtime`: agent sessions、activities、signals、plans、delegation lifecycle。
- `context-orchestration`: typed context/evidence/guidance projection，复用已有 `ContextItem` 方向。

## 已核实来源

官方产品文档：

```text
https://linear.app/docs/triage-intelligence
https://linear.app/docs/code-intelligence
https://linear.app/docs/linear-agent
https://linear.app/docs/agents-in-linear
https://linear.app/docs/assigning-issues
https://linear.app/docs/mcp
https://linear.app/ai
```

官方开发者文档：

```text
https://linear.app/developers/aig
https://linear.app/developers/agents
https://linear.app/developers/agent-interaction
https://linear.app/developers/agent-best-practices
https://linear.app/developers/agent-signals
https://linear.app/developers/webhooks
https://linear.app/developers/oauth-2-0-authentication
```

当前 Cradle 证据入口：

```text
packages/db/src/schema/issue.ts
packages/db/src/schema/agent-interaction.ts
apps/server/src/modules/agent-interaction-runtime/service.ts
apps/server/src/modules/issue-agent/service.ts
apps/server/src/modules/search/README.md
apps/server/src/modules/workspace/README.md
apps/web/src/features/context/context-items.ts
docs/specs/jarvis-context-engine.md
```

## Linear 事实要点

- Triage Intelligence 基于 agentic models 分析 future triage issues，并建议 issue properties 和 relationships。
- Triage properties 包括 teams、projects、assignees、labels；文档也展示 duplicate 和 related issue suggestions。
- Triage 可以配置 show、hide、auto-apply，sub-team 默认继承 parent team rules。
- Triage guidance 在多层存在时，local guidance 权重更高。
- 非 triage issue 可以通过 `Find Suggestions` 手动触发。
- Code Intelligence 通过 GitHub integration 受控访问 repository，默认 permission-aware。
- Code Intelligence 可由 admin 扩展给 all workspace members，但 guest users 不可用。
- Code answers 应 grounded 到 files、commits 或 pull requests。
- AgentSession states 包括 `pending`、`active`、`error`、`awaitingInput`、`complete`、`stale`。
- AgentActivity types 包括 `thought`、`action`、`response`、`elicitation`、`error`；user prompt 是单独输入活动。
- First response SLA 是 10 秒，webhook handler ack 是 5 秒，后续 30 分钟无 activity 可 stale。
- Signals 包括 human-to-agent `stop` 和 agent-to-human `auth`、`select`。
- Agent plan 是完整数组替换，不是单 step patch。
- Agent 不是 assignee；human remains accountable。

## 推荐恢复 Prompt

```text
Continue the Cradle Linear AI Intelligence SPEC work.

Read:
- docs/specs/linear-ai-intelligence/README.md
- docs/specs/linear-ai-intelligence/intelligence-runtime-architecture.md
- docs/specs/linear-ai-intelligence/triage-intelligence.md
- docs/specs/linear-ai-intelligence/code-intelligence.md
- docs/specs/linear-ai-intelligence/agent-interaction-runtime.md
- docs/specs/linear-ai-intelligence/handoff.md
- packages/db/src/schema/issue.ts
- packages/db/src/schema/agent-interaction.ts
- apps/server/src/modules/agent-interaction-runtime/service.ts
- apps/server/src/modules/issue-agent/service.ts
- apps/web/src/features/context/context-items.ts

Task:
Convert the selected SPEC into an ExecPlan or implementation. Treat current worktree as authoritative. Preserve owner boundaries. Prefer clean architecture over compatibility glue.

Hard constraints:
- Use TypeScript and existing Cradle server module patterns.
- Use Drizzle for database changes.
- Do not write to foreign namespaces.
- Do not collapse Triage Intelligence, Code Intelligence, and Agent Interaction Runtime into one module.
- Make suggestions explicit, auditable, permission-aware, and reversible.
- Keep agent session/activity protocol independent from ChatRuntime internals.

Expected first action:
Inspect current git status and determine whether implementation already started. If not, create an ExecPlan from the SPEC. If it has started, audit requirement by requirement before editing.

Completion audit:
Verify every owner boundary, schema, API, UI contract, permission rule, signal behavior, eval gate, and handoff artifact listed in the SPEC.
```

## 实施建议

第一阶段应先做 `agent-interaction-runtime`，因为 Triage 和 Code 都需要可解释的 agent state、activity 和 stop behavior。第二阶段做 `work-intelligence` suggestion lifecycle，不启用 auto-apply。第三阶段做 `code-intelligence` local repository indexing 和 citation ledger。第四阶段再把 Code evidence 接进 Triage 和 delegated agent prompt。

## 风险提醒

- 不要把 suggestions 存成 comments。
- 不要用 workflow rules 替代 model-backed suggestion lifecycle。
- 不要让 Code Intelligence 绕过 repository access policy。
- 不要让 agent stop signal 只更新 UI，而不取消后台 run。
- 不要在 Code Intelligence 中直接改 workspace files。
- 不要把 Linear docs 的 UI 文案复制进 Cradle；只迁移结构、协议和标准。
