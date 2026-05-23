<!--
Input: Walden Yan multi-agent production lessons, Cradle agent runtime audit, and existing owner/namespace rules.
Output: Cradle multi-agent collaboration architecture spec.
Position: docs/specs/multi-agent-collaboration.md
-->

# Multi-Agent Collaboration

## 目标

Cradle 的多 Agent 方向不应该是无结构 swarm，而应该是一个主写入者围绕多个智能输入源工作的协作系统。
本文记录从 Walden Yan 关于生产多 Agent 实践的文章中得到的架构启发，并把它映射到 Cradle 当前代码结构、owner 边界和后续实现路线。

核心判断：

- 写入保持单线程。
- 额外 Agent 优先贡献判断、审查、检索、计划和综合，而不是直接并行改同一份状态。
- 多 Agent 能力必须落到明确 owner、可观察生命周期、结构化通信和可验证指标上。

## 背景观察

文章最有价值的结论不是“多开几个 Agent 会更强”，而是多 Agent 真正工作的形态更窄：

- Clean-context reviewer 可以发现原 writer 因长上下文、路径依赖或用户误导而漏掉的问题。
- Smart friend 更适合作为咨询能力或 capability router，而不是另一个拥有写权限的并行 actor。
- Manager delegation 应该是 map-reduce-and-manage：manager 拆分、child 执行或研究、manager 综合。
- 无结构 agent network 会放大通信损耗、隐式决策冲突和责任不清。

这与 Cradle 当前原则一致：谁拥有语义、配置、生命周期、兼容性和迁移，谁拥有 namespace。其他模块可以读 projection，但不能写别人的 canonical state。

## Cradle 当前状态

Cradle 已经有适合该方向的基础：

- `chat-runtime` 拥有实际 turn execution、`messages.messageJson`、streaming delta、backend run、usage 和 cancellation 语义。
- `issue-agent` 拥有 issue delegation lifecycle、agent session 和 activity projection，但实际执行仍调用 `chat-runtime`。
- `automation` 拥有 durable definition、outer run、schedule 和 artifacts，但 agent task 仍创建普通 chat session/backend run。
- `chat-runtime` 已支持 subagent message projection，通过 `parentToolCallId` 和 `taskId` 把 child output 放入同一 session timeline。
- `agent-identity` 拥有 agent records，`profiles` 拥有 runtime/profile config，`skills` 拥有 Cradle skills projection。
- `docs/specs/alma-inspired/agent-crew-delegation.md` 已经把 crew overview 定义为 read model，而不是新的 canonical crew tables。

这意味着 Cradle 不需要先推翻架构来支持多 Agent。更合理的路径是补齐 reviewer、smart friend、manager synthesis 和 communication protocol。

## 设计原则

### 1. Single Writer, Multiple Intelligence Contributors

同一 workspace、同一 chat session、同一 issue lifecycle 下，默认只能有一个 writer。
其他 Agent 可以提供：

- review findings
- risk assessment
- context search
- implementation options
- test suggestions
- handoff summaries
- blocked-state diagnosis

这些输出必须先进入结构化 record，再由主 writer 或 owner service 决定是否应用。

例外只允许在边界清楚时存在：

- child Agent 在独立 worktree、branch、sandbox 或 isolated artifact namespace 中写入。
- 合并回主线时仍由 manager 或主 writer 单线程完成。
- 外部 provider runtime 自带 subagent 工具时，Cradle 只接收其 event projection，不把 child 变成 Cradle-owned writer。

### 2. Context Separation Is A Capability

Clean context 不是信息缺失，而是一种能力。
Review Agent 不应继承 writer 的完整上下文，因为长上下文会携带路径依赖、错误假设和 attention cost。

Cradle 后续应支持 turn-level context policy：

```ts
type ContextPolicy = 'normal' | 'clean-review' | 'consultation' | 'manager-synthesis'
```

不同 policy 的预期：

- `normal`: 当前 chat 行为，包含 system workflow、selected skills、Chronicle memory 和 session history。
- `clean-review`: 只包含 user goal summary、diff、touched files、test output、relevant constraints 和 explicit decisions。
- `consultation`: 包含主 Agent 当前问题、必要上下文、已验证事实和可请求补查的边界。
- `manager-synthesis`: 包含 child handoff、shared plan、owner constraints 和 merge criteria。

### 3. Tools Stay Primitive, Skills Carry Usage Knowledge

新多 Agent 能力不应该通过“智能化工具接口”把使用策略塞进 tool schema。

- Tool 暴露原始能力，例如读取 run、创建 review、写 activity、查询 observability。
- Skill 描述何时调用 reviewer、如何包装 context、如何过滤 reviewer findings、何时升级 smart friend。
- Workflow 适合固定顺序，例如 writer -> reviewer -> writer fix -> reviewer recheck。
- Agent loop 适合路径依赖强、结果不可预先枚举的任务。

### 4. Manager Coordinates Structure, Not Micro-Decisions

Manager Agent 应负责：

- 拆分 scope。
- 分配 child 任务。
- 汇总 handoff。
- 判断哪些 discovery 改变全局计划。
- 向用户报告状态和风险。

Manager Agent 不应负责：

- 每一步都批准 child 的普通动作。
- 替 child 做局部代码判断。
- 作为所有信息必须经过的知识汇点。
- 创建新的 canonical agent state。

### 5. Communication Must Be Structured

自然语言 transcript 不足以支撑跨 Agent 协作。Cradle 需要结构化信号，让 child discovery 可以改变 siblings 或 manager 的计划。

建议逐步收敛到以下 signal taxonomy：

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
```

首期可以复用 `agentActivities.signal` 和 `signalMetadata`，不急于新增 canonical tables。
当 read model 查询、过滤、跨 session projection 需求变强时，再引入专门 projection。

## 推荐能力

### Code Review Loop

这是最优先的能力，因为它收益明确、写入风险低、实现边界清楚。

目标行为：

- writer 完成一轮实现后，Cradle 创建 clean-context review run。
- reviewer 只产出 findings，不直接改代码。
- writer 根据用户目标、历史决策和 reviewer findings 做 synthesis。
- 被接受的 finding 进入修复；被拒绝的 finding 记录 reject reason。
- 循环次数有上限，避免 review churn。

Owner 建议：

- `chat-runtime` 拥有 review run execution 和 message snapshots。
- `observability` 拥有 review loop metrics 和 incidents。
- `issue-agent` 或未来 `agent-review` surface 拥有 review activity projection。
- 不新增 reviewer-owned workspace writes。

需要记录的指标：

- findings count
- accepted findings count
- rejected findings count
- severe findings count
- review loop count
- review token cost
- time to first finding
- tests added or changed

验收方式：

- 单元测试覆盖 clean-review context 不包含完整 session history。
- 集成测试覆盖 reviewer finding 被 writer 接受后进入后续 run prompt。
- 集成测试覆盖 reviewer finding 被拒绝时保留 reject reason。
- Observability 可以按 session/run 查询 review loop 成本和结果。

### Smart Friend

Smart friend 应该是咨询和能力路由，不是并行 writer。

目标行为：

- 主 Agent 遇到复杂判断时调用更强或更适合的 runtime。
- smart friend 可以回答问题、指出 missing context、建议补查文件、给出风险排序。
- smart friend 不能直接写 workspace，也不能直接提交 patch。
- 主 Agent 负责把建议综合到当前任务中。

适合触发 smart friend 的场景：

- merge conflict
- public API 或持久化格式变化
- security-sensitive change
- flaky test diagnosis
- large refactor planning
- cross-runtime capability mismatch
- visual reasoning or UI QA

Owner 建议：

- `chat-runtime` 提供 consultation run primitive。
- `profiles` 和 provider registry 提供 capability metadata。
- Skill 定义 escalation rules。
- `observability` 记录 escalation reason、model/runtime、cost 和 outcome。

关键风险：

- 弱主模型不知道何时升级。
- 主模型给 smart friend 的 context 不完整。
- smart friend 对缺失上下文进行猜测。

缓解方式：

- 允许配置 mandatory consult rules。
- smart friend prompt 必须允许回答 `need_more_context`。
- smart friend 可以返回具体 context request，由主 Agent 补查后再次咨询。

### Manager Delegation

Manager delegation 应该基于 issue/sub-issue、agent session 和 read projection，而不是自由聊天网络。

目标行为：

- manager 把大任务拆成 issues 或 child runs。
- child runs 输出 handoff、finding、artifact 或 isolated patch proposal。
- manager 汇总 child outputs，决定下一步。
- 同一 workspace 的 canonical write 仍由 manager 或当前 active writer 串行完成。

Owner 建议：

- `issue-agent` 拥有 issue delegation session lifecycle。
- `chat-runtime` 拥有 child run execution event projection。
- `agent-crew/overview` 只读 agent、profile、issue-agent、chat-runtime projection。
- `preferences` 或 feature-owned view state 可以保存 crew layout，不保存 agent semantics。

首期不做：

- 任意 Agent 互相协商的 swarm。
- 多个 child 同时写同一 worktree。
- crew-owned agent shadow tables。
- manager 微管理 child 每个 action。

## API 草案

这些接口是能力草案，不代表立即实现。

```ts
interface ReviewRunRequest {
  sessionId: string
  sourceRunId: string
  contextPolicy: 'clean-review'
  maxFindings?: number
  severityFloor?: 'low' | 'medium' | 'high'
}

interface ReviewFinding {
  id: string
  reviewRunId: string
  severity: 'low' | 'medium' | 'high'
  category: 'logic' | 'edge_case' | 'security' | 'test_gap' | 'architecture' | 'maintainability'
  filePath?: string
  line?: number
  summary: string
  evidence: string
  recommendation: string
  status: 'open' | 'accepted' | 'rejected' | 'fixed'
  decisionReason?: string
}

interface ConsultationRequest {
  sessionId: string
  reason: string
  question: string
  contextPolicy: 'consultation'
  capabilityHint?: 'debugging' | 'security' | 'ui_review' | 'test_design' | 'architecture'
}

interface ConsultationResponse {
  status: 'answered' | 'need_more_context'
  answer?: string
  contextRequests?: Array<{
    kind: 'file' | 'command' | 'test' | 'log'
    target: string
    reason: string
  }>
  risks: Array<{
    severity: 'low' | 'medium' | 'high'
    summary: string
  }>
}
```

## UI 形态

Chat 和 issue detail 可以先显示最小 projection：

- reviewer findings fold
- accepted/rejected/fixed state
- smart friend consultation block
- manager child run summary
- current active writer marker
- cost and loop count

UI 不应把每个 Agent 都渲染成同等权重的 actor。
视觉层级应该区分：

- writer
- reviewer
- consultant
- child worker
- manager

## 数据边界

首期优先复用现有表和 projection：

- `messages`: 保存 review/consultation/child output snapshots。
- `backend_runs`: 保存 execution lifecycle。
- `agent_sessions`: 保存 issue-agent session lifecycle。
- `agent_activities`: 保存 delegation activity 和 structured signals。
- `observability_events`: 保存 loop metrics、cost、failure 和 incident projection。

只有当 review findings 需要独立查询、筛选、状态迁移和长期历史时，才新增 `agent_review` owner。
如果新增，它只拥有 review lifecycle 和 finding decisions，不拥有 workspace writes。

## 风险与反模式

### Parallel Writer Swarm

多个 Agent 同时改同一 workspace 会产生隐式决策冲突：命名风格、边界条件、测试策略和错误处理可能相互打架。
Cradle 应默认禁止这种模式。

### Context-Sharing Overreach

把 writer 的完整上下文交给 reviewer 会降低 reviewer 的独立性。
Clean-review context 应该短、结构化、可审计。

### Crew Shadow Ownership

`agent-crew` 如果创建自己的 agent/session canonical tables，会破坏现有 owner 边界。
Crew 应是 overview/read model，除非保存纯 UI layout。

### Smart Friend As Hidden Writer

如果 smart friend 返回 patch 并让系统自动应用，它就变成了第二 writer。
Smart friend 输出只能作为 advisory input。

### Manager As Bottleneck

如果 child 每一步都要问 manager，就不是 agent collaboration，而是昂贵 RPC。
Manager 应处理结构性协调，而不是微观执行决策。

## 推荐路线

### Phase 1: Review Loop

交付：

- clean-review context builder
- review run API or internal service primitive
- reviewer finding projection
- writer synthesis prompt shape
- review loop observability

验证：

- context policy tests
- review finding lifecycle tests
- observability query tests
- one focused end-to-end issue-agent review flow

### Phase 2: Smart Friend

交付：

- consultation run primitive
- capability routing metadata
- mandatory consult rules
- `need_more_context` response handling
- cost/outcome projection

验证：

- routing rule tests
- missing-context response tests
- smart friend output never writes workspace
- cost accounting tests

### Phase 3: Manager Delegation

交付：

- child handoff signal schema
- manager synthesis view
- agent crew overview read model
- active writer marker
- isolated child artifact or worktree policy

验证：

- child discovery reaches manager projection
- sibling-impacting signal is visible
- manager synthesis references child outputs
- no crew-owned canonical agent shadow state

## 验收口径

这条路线成功的标准不是 Agent 数量，而是以下指标变好：

- human review 前发现更多高价值 bug。
- accepted finding rate 高于 rejected finding rate。
- review loop 不无限循环。
- consultation 对高风险任务有可观察收益。
- manager delegation 的 child output 可追溯、可合并、可拒绝。
- workspace 写入路径仍能回答“谁是 owner，谁做了决定，谁可以回滚”。

## 与现有文档的关系

- `docs/specs/alma-inspired/agent-crew-delegation.md` 定义 crew 产品面和 read model 边界。
- `docs/specs/multi-agent-collaboration.md` 定义多 Agent 协作的执行约束和能力路线。
- 后续实现应从本 spec 拆出 ExecPlan，而不是直接引入无结构多 Agent runtime。
