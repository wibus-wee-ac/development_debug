# Cradle Multi-Agent Collaboration Spec

## 目标

这份 SPEC 定义 Cradle 面向多 Agent 协作的长期架构，不受当前历史债务约束，但必须尊重 Cradle 的 owner / namespace 原则。目标不是把多个模型放进同一个聊天室，而是让 Cradle 能够承载大量可组合的协作模式，并且每一种模式都有清晰的控制权、上下文边界、写入边界、恢复边界、审计边界和协议插点。

本 SPEC 由三部分组成：

- [Multi-Agent Pattern Matrix](multi-agent-pattern-matrix.md)：覆盖 `multi-agent.wiki` 当前所有 pattern，并映射到 Cradle 的采用策略。
- [Multi-Agent Runtime Architecture](multi-agent-runtime-architecture.md)：定义 runtime、orchestrator、task registry、blackboard、event log、guardrail、workspace isolation 和协议网关。
- [Multi-Agent Continuation Prompt](multi-agent-continuation-prompt.md)：记录后续会话可以直接复用的研究恢复 prompt。

## 调研依据

外部证据：

- `https://multi-agent.wiki/`，源码仓库为 `https://github.com/fuergaosi233/multiagent-explorer`，本次调研使用 `main` 分支 `80f7176f93e4d089f5d688eef402866eb5b7ae00`。
- `multi-agent.wiki` 的 taxonomy 将多 Agent 分为控制结构、信息流、决策方式、执行环境、workflow orchestration 和协议互联六类。
- `multi-agent.wiki` 的 decision matrix 给出关键选择：固定流用 pipeline / workflow，独立子任务用 parallel fan-out，长任务用 graph workflow + task registry，质量审查用 generator-critic / refinement loop，高风险操作用 HITL + guardrails，大规模代码任务用 dynamic workflow + verifier + worktree isolation。
- MCP 官方规格将 MCP 定义为 agent 与 tool / resource / prompt 的边界。
- A2A 官方规格将 A2A 定义为跨 agent 通信、任务、消息和 artifact 的互操作协议。
- Agent Client Protocol 将 ACP 定义为 editor / IDE 与 coding agent 的协议，复用 MCP JSON 表示并补充 coding UX 类型。
- OpenAI Agents SDK、LangChain 和 Google ADK 都把 agents-as-tools、handoff、sequential、parallel、loop、human-in-the-loop 等作为主流生产模式。

Cradle 当前证据：

- `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` 已把 provider 边界收敛到 `UIMessageChunk` / `UIMessage`，并已有 `crew`、`toolActivity`、`mcp`、`goal`、`plan` 等 runtime UI slot。
- `apps/server/src/modules/chat-runtime/model.ts` 已支持 message snapshot 的 `parentToolCallId`、`taskId` 和 `depth`，适合表达 nested run 或 subagent output projection。
- `apps/server/src/modules/issue-agent/model.ts` 已拥有 issue delegation lifecycle、agent session、activity signal 和 `signalMetadata`。
- `apps/server/src/modules/automation/model.ts` 已拥有 durable definition、run、artifact 和 agent task recipe。
- `apps/server/src/modules/observability/model.ts` 已拥有 append-style event、incident、error pattern、trace id、parent event id 和 bundle export。
- `apps/server/src/modules/provider-contracts/types.ts` 已有 runtime kind / provider target 抽象，适合作为 agent capability routing 的基础。
- Codex app-server protocol generated types 中已有 `collabAgentToolCall`、`CollabAgentState`、`CollaborationMode`、`ThreadSource = "subagent"` 等外部 provider projection 信号。Cradle 可以读并投影，不能让它们变成 Cradle canonical semantics。

## 核心结论

Cradle 应采用 **single-writer, many-intelligence-contributors** 架构。

同一个 workspace、issue、chat session 或 canonical artifact 默认只能有一个 active writer。其他 Agent 可以并行贡献研究、审查、验证、路由建议、候选方案、上下文请求、风险评估和 isolated patch proposal，但不能直接并行改写同一 canonical state。

允许并行写入的唯一前提是写入边界被隔离：

- 独立 git worktree、branch、container、sandbox 或 artifact namespace。
- 每个 child writer 只能写自己的 isolated output。
- 合并回主线必须由 manager 或当前 active writer 串行执行。
- 合并必须有 diff、trace、rollback 和 owner 决策记录。

## 架构原则

### Owner 先于模式

多 Agent pattern 不能成为新的 ownership 灰区。每个能力必须能回答：

- 谁拥有 canonical state？
- 谁可以写？
- 谁只能读 projection？
- 谁拥有生命周期、迁移、兼容性和删除策略？
- 如果失败，哪个 owner 负责恢复？

对应边界：

| Owner | 拥有内容 | 多 Agent 中的职责 |
|---|---|---|
| `chat-runtime` | run execution、message snapshots、provider stream、turn lifecycle | 执行 agent run、收敛 `UIMessageChunk`、保存 output snapshot、取消和恢复 |
| `issue-agent` | issue delegation、agent session、activity signal | issue 维度 delegation lifecycle、manager / child activity projection |
| `automation` | durable schedule、run、artifact | 定时或手动触发的 agent workflow 外层生命周期 |
| `observability` | event、incident、trace、bundle | 多 Agent trace、metrics、failure、cost、review outcome |
| `agent-identity` | agent record | agent 身份、展示名、角色，不拥有 runtime execution |
| `profiles` / provider runtime | model / runtime config | capability routing、runtime availability、provider-specific config |
| `skills` / `workflow-rules` | usage knowledge、workspace instructions | 何时使用某种协作模式，不能保存运行状态 |
| `workspace` / `git` | workspace 文件、git projection | worktree isolation、diff、merge evidence |
| future `agent-orchestration` | workflow state、task registry、policy scheduler | 只有当 graph / dynamic workflow 需要持久化时新增 |
| future `agent-review` | review finding lifecycle | 只有当 review finding 需要独立查询和状态迁移时新增 |

### Context separation 是能力

多 Agent 的价值大多来自上下文隔离，而不是 Agent 数量。Cradle 必须把 context policy 作为运行参数，而不是临时 prompt 文案。

```ts
type ContextPolicy =
  | 'normal'
  | 'clean-review'
  | 'consultation'
  | 'manager-synthesis'
  | 'isolated-worker'
  | 'adversarial-verifier'
  | 'handoff-receiver'
```

语义：

| Policy | 目标 | 上下文形状 |
|---|---|---|
| `normal` | 普通 chat turn | 当前 session history、system workflow、skills、explicit refs |
| `clean-review` | 独立审查 | user goal summary、diff、touched files、test output、constraints、decisions |
| `consultation` | smart friend | 明确问题、已验证事实、可补查边界、风险 |
| `manager-synthesis` | manager 汇总 | child handoff、shared plan、owner constraints、merge criteria |
| `isolated-worker` | child task | task slice、allowed tools、output schema、done criteria |
| `adversarial-verifier` | 反证 / 质检 | claim、evidence、source pointers、disproof instructions |
| `handoff-receiver` | 专家接管 | transfer reason、user visible state、minimal relevant history |

### Tools 保持 primitive，Skills 承载用法

不要发明 `startSmartCollaboration()` 这类把策略包进工具的接口。工具应该暴露原始系统能力，skill / workflow rule 决定何时调用。

正确边界：

- Tool：创建 run、读取 run、写 activity、创建 worktree、注册 await、查询 observability。
- Skill：何时做 clean review、何时 dispatch worker、如何筛选 findings、何时升级 smart friend。
- Workflow：固定顺序或可保存脚本的协作流程。
- Agent loop：路径依赖强、无法预先枚举的动态探索。

### Orchestrator 管结构，不管微观决策

Orchestrator 的职责：

- 任务拆分。
- agent / runtime routing。
- 并发、timeout、retry、budget、checkpoint。
- trace event emission。
- child output synthesis。
- policy enforcement。

Orchestrator 不应：

- 每一步都替 worker 决策。
- 把所有知识都吸到中央上下文。
- 让 child 每次普通动作都等待 manager。
- 创建 shadow agent tables 覆盖 `agent-identity` / `profiles` / `chat-runtime`。

### 事件优先于 transcript

自然语言 transcript 不能承载长期可维护的多 Agent 协作。每种模式都必须产生结构化事件，并且事件必须能重建控制流、因果链和成本。

首期 signal taxonomy：

```ts
type AgentSignal =
  | 'finding'
  | 'decision'
  | 'blocker'
  | 'handoff'
  | 'context_request'
  | 'scope_change'
  | 'review_result'
  | 'merge_ready'
  | 'approval_request'
  | 'checkpoint'
```

可先复用 `issue-agent` 的 `agentActivities.signal` / `signalMetadata` 和 `observability` 的 `attrs`，但一旦需要跨 session 查询、筛选、状态迁移，就应新增 feature-owned projection，而不是继续塞 JSON 字符串。

## 能力层级

Cradle 应按以下 ladder 实现，不应从 swarm 开始。

| Level | 能力 | 典型模式 | Cradle 状态 |
|---|---|---|---|
| L0 | Single Agent + Tools | 单 Agent | 已有 |
| L1 | Agents-as-tools / Smart Friend | specialist tool call、consultation | 可基于 `chat-runtime` 增量实现 |
| L2 | Clean Review Loop | generator-critic、refinement loop | 需要 context policy + finding lifecycle |
| L3 | Supervisor + Parallel Workers | supervisor、parallel fan-out、manager synthesis | 需要 task registry / child handoff |
| L4 | Graph Workflow | graph / state machine、checkpoint / resume | 需要 `agent-orchestration` owner |
| L5 | Dynamic Workflow | script-held plan、parallel / pipeline、checkpoint | 架构升级项 |
| L6 | Protocol Network | MCP、A2A、ACP、Agent Client Protocol | MCP/ACP 部分已有，A2A 未来接入 |
| L7 | Decentralized Organization | peer swarm、coalition、federation、MARL | 不作为近期产品默认路径 |

## 优先交付路线

### Phase 1: Clean Review Loop

目标：writer 完成实现后，Cradle 创建 clean-context review run。reviewer 只产出 findings，不写 workspace。writer 综合 findings 并决定接受、拒绝或修复。

交付：

- `clean-review` context builder。
- review run primitive。
- `ReviewFinding` projection。
- writer synthesis prompt。
- review loop observability。

验收：

- clean review 不包含完整 session history。
- finding 可以被 accepted / rejected / fixed，并记录 reason。
- reviewer 不能产生 workspace write。
- observability 可按 session / run 查询 loop cost、finding count、accepted rate。

### Phase 2: Smart Friend / Consultation

目标：主 Agent 在高风险判断时调用更强或更适配的 runtime，但 smart friend 只能 advisory，不写 workspace。

触发：

- public API / DB / protocol 变化。
- 大范围重构。
- security-sensitive change。
- flaky test / concurrency diagnosis。
- UI / visual reasoning。
- provider capability mismatch。

验收：

- consultation request 明确 reason、question、verified facts、missing context boundary。
- response 支持 `need_more_context`。
- consultation output 进入主 run synthesis，而不是自动执行。
- cost / outcome 可观测。

### Phase 3: Manager Delegation

目标：manager 把任务拆为 child runs 或 issue child tasks，child 输出 handoff / finding / artifact / isolated patch proposal，manager 串行综合。

交付：

- child handoff schema。
- manager synthesis view。
- active writer marker。
- crew overview read model。
- isolated artifact / worktree policy。

验收：

- child discovery 能进入 manager projection。
- sibling-impacting signal 可见。
- manager synthesis 引用 child outputs。
- crew 不创建 agent shadow canonical state。

### Phase 4: Graph / Dynamic Workflow Runtime

目标：当 long task 需要 resume、cancel、trace、parallel / pipeline 和 checkpoint 时，引入 `agent-orchestration` owner，计划从 prompt context 移入持久 graph 或 script artifact。

交付：

- task registry。
- graph node / edge / checkpoint。
- workflow script artifact review。
- budget / concurrency / timeout policy。
- workflow trace tree。
- worktree isolation manager。

验收：

- long workflow 可恢复到 checkpoint。
- parallel barrier 和 pipeline stream 语义清晰。
- workflow approval card 包含 phase、fan-out、budget、permissions、write paths。
- file-writing workflow 默认运行在 isolated worktree 或 branch。

## 禁止路径

- 不做多个 Agent 同时写同一 worktree 的默认能力。
- 不把 group chat 当成基础架构。
- 不把 Codex `collabAgentToolCall` 或其他 provider event 直接提升为 Cradle canonical protocol。
- 不引入与 AI SDK `UIMessageChunk` 平行的 chat stream delta。
- 不创建 `agent-crew` shadow tables 覆盖 `agent-identity`、`profiles`、`issue-agent` 或 `chat-runtime`。
- 不让 smart friend 自动应用 patch。
- 不让 reviewer 和 writer 共享完整上下文。
- 不把 workflow checkpoint 当成真实 agent cognition，只能作为恢复 projection。

## SPEC 完成标准

后续实现任何多 Agent 功能前，必须能在对应 ExecPlan 中回答：

- 采用了 pattern matrix 中哪一种或哪几种模式？
- 每种模式的 owner 是谁？
- canonical write path 是什么？
- context policy 是什么？
- trace event schema 是什么？
- failure、timeout、cancel、retry、budget 的策略是什么？
- 是否需要 human approval？
- 是否需要 worktree isolation？
- 是否新增 projection 或 table？如果新增，为什么现有 owner 不足？
- 如何证明没有绕过 AI SDK / provider runtime 边界？
