# Multi-Agent Pattern Matrix

## 目标

这份矩阵覆盖 `multi-agent.wiki` 当前全部 pattern，并给出 Cradle 的采用策略、owner 边界、技术插点和验收标准。它不是功能排期表，而是后续设计和 ExecPlan 的 pattern lookup table。

本矩阵使用以下状态：

| 状态 | 含义 |
|---|---|
| Adopt | 应作为 Cradle 核心能力实现 |
| Support | 应支持，但通常作为某个更大模式的组成部分 |
| Constrain | 可支持，但必须强约束默认行为 |
| Defer | 暂不作为近期产品能力 |
| Reject-by-default | 不作为默认产品路径，只允许研究或显式隔离 |

## 全局分类

`multi-agent.wiki` 的 taxonomy 提醒我们不要按框架名分类，而要按工程维度分类：

| 维度 | Cradle 对应设计问题 |
|---|---|
| Control structure | 谁持有当前控制权，是否允许 handoff，是否有 manager |
| Information flow | output 是线性、并行、共享状态、事件流还是内嵌会话 |
| Decision making | manager、critic、vote、judge、market、human 谁做最终判断 |
| Execution environment | 是否角色驱动、隔离 workspace、human-coupled、environment-mediated |
| Workflow orchestration | plan 在 context、graph 还是 script artifact 中 |
| Protocol interconnect | MCP、A2A、ACP、Agent Client Protocol 分别连接哪一层 |

Cradle 的默认组合应是：

`Supervisor + Parallel Fan-out + Clean Review + Blackboard Projection + Event Log + Human Approval + Workspace Isolation`

## Pattern 覆盖矩阵

| Pattern | Cradle 状态 | Cradle 语义 | 主要 owner | 技术插点 | 验收标准 |
|---|---|---|---|---|---|
| Agents-as-tools | Adopt | host agent 保持对话控制，specialist 作为 typed advisory call | `chat-runtime`, `profiles` | consultation run、runtime routing、structured output | specialist 不能写 workspace；每次调用有 run id、trace id、timeout |
| Supervisor / Manager | Adopt | primary writer 规划、分配、综合，child 贡献结果 | future `agent-orchestration`, `issue-agent`, `chat-runtime` | task registry、child run、manager synthesis | manager 能引用 child outputs；active writer 唯一 |
| Coordinator / Dispatcher | Adopt | runtime 级 scheduler，不是“会写 prompt 的 agent” | future `agent-orchestration` | queue、policy routing、retry、timeout、budget | routing decision 有结构化 reason 和 allowed set |
| Handoff / Router / Transfer | Support | 当前 active agent 可将用户-facing control 转给 specialist | `chat-runtime`, `profiles` | handoff request、handoff accepted/rejected、receiver context policy | 记录 handoff reason；检测 loop；用户可见当前 front agent |
| Hierarchical Decomposition | Support | manager-worker 多层任务树，深度有上限 | future `agent-orchestration`, `issue-agent` | parent task id、child task id、depth limit | worker failure 不被 summary 吞掉；depth limit 可观测 |
| Parallel Fan-out / Gather | Adopt | 独立子任务并行，aggregator 等全部结果再合成 | future `agent-orchestration`, `chat-runtime` | branch run、barrier、gather synthesis | contradictory conclusions 不被静默合并；每个 branch 独立 trace |
| Sequential Pipeline | Support | 固定步骤输出喂给下一步 | future `agent-orchestration`, `automation` | graph nodes、per-step checkpoint | 每步 input/output schema 固定；失败可定位到 step |
| Graph / State Machine / Workflow | Adopt | 设计时固定 graph，适合可审计长任务 | future `agent-orchestration` | node、edge、checkpoint、resume | long run 可 resume / cancel / retry；state 字段集中 |
| Dynamic Workflow / Code-Orchestrated Subagents | Adopt later | model 写 workflow script，runtime 执行 fan-out、loop、checkpoint | future `agent-orchestration`, `workspace`, `observability` | script artifact、workflow approval、parallel/pipeline primitives | script 先审后跑；workflow 有 budget、checkpoint、trace tree |
| Generator-Critic / Verifier | Adopt | writer 生成，clean reviewer 或 verifier 挑错 | future `agent-review`, `chat-runtime` | clean-review context、finding lifecycle | critic 不共享 writer 全历史；findings 可 accepted/rejected/fixed |
| Refinement Loop / Evaluator-Optimizer | Support | generate -> evaluate -> revise，有退出条件 | future `agent-review`, `chat-runtime` | loop round、score、exit condition | 不允许无限循环；每轮必须证明质量变化 |
| Debate / Judge / Voting | Constrain | 多候选方案互相挑战，judge 输出决策 | future `agent-orchestration` | candidate runs、judge rubric、verdict | judge 必须引用 evidence；只用于高价值决策 |
| Voting / Ensemble | Constrain | 多个独立候选，经 ranker / verifier 选择 | future `agent-orchestration` | candidate output schema、ranker、tie handling | candidates 必须上下文独立；ranker 不能只看 prose fluency |
| Mixture-of-Agents / Layered Ensemble | Defer | 多层模型输出逐层聚合 | future `agent-orchestration` | layer run、aggregator、correlation control | 只有证明质量收益大于成本后启用 |
| Blackboard / Shared Memory / Workspace | Adopt as projection | shared facts / artifacts / decisions，不等于真实 agent state | `observability`, future `agent-orchestration` | append-only facts、artifact refs、TTL、provenance | 每条 item 有 owner、freshness、source；禁止无来源事实 |
| Event Bus / Pub-Sub | Adopt | agent 间异步 signal 和 workflow trace | `observability`, future `agent-orchestration` | event schema、topic、dead-letter、replay | event 有 schemaVersion；重复消费不会重复 side effect |
| Nested Chat / Inner Team | Support | outer agent 调内部 sub-conversation 后再回答 | `chat-runtime` | parent tool part、subagent output snapshot、depth | inner chat 可审计；输出必须回到 parent tool result |
| Group Chat / Meeting | Reject-by-default | 多 agent 共用一个 thread | `chat-runtime` only if explicit | speaker selection、summary、termination | 默认不用于 coding workflow；必须有 moderator 和 artifact |
| Peer-to-peer / Swarm | Reject-by-default | 无固定中心，自组织通信 | future research only | peer message、consensus trace | 只允许 isolated research sandbox；不接 workspace write |
| Coalition / Federation / Holonic Organization | Defer | 临时 team / federation 围绕任务形成 | future `agent-orchestration` | team registry projection、membership TTL、policy | team lifecycle 可清理；member permissions 明确 |
| Market / Auction / Contract Net | Defer | agents bidding / pricing / allocation | future scheduler research | bid schema、score function、award event | score function 不可被轻易 gaming；成本收益可证明 |
| Role-playing / SOP / Virtual Company | Constrain | roles 和 SOP 产出结构化 artifact | `skills`, `workflow-rules`, future `agent-orchestration` | role prompt package、SOP step、artifact schema | role 输出必须是 artifact，不是角色扮演 prose |
| Human-in-the-loop | Adopt | human 是 approval、correction、routing、final decision agent | `chat-runtime`, `observability`, future `agent-orchestration` | approval card、risk tier、timeout、decision record | approval card 包含 action、scope、risk、diff、rollback |
| Clarification-at-edge / Ask-before-act | Adopt | handoff 或高不确定动作前的边缘澄清 | `chat-runtime`, future `agent-orchestration` | context request、clarification answer、skip reason | 不过度打断；answer 写回对应 task / run state |
| Workspace / Sandbox Isolation | Adopt | 每个 writer 在独立 worktree / branch / container 写入 | `workspace`, `git`, future `agent-orchestration` | worktree creation、diff artifact、cleanup | 并行写入不得发生在同一目录；输出必须带 diff |
| Stigmergy / Environment-mediated Collaboration | Constrain | 通过环境 traces 间接协作 | `workspace`, `observability` | environment trace、consume marker、freshness | trace 不能隐式；必须可观察、可过期、可清理 |
| Social Simulation / Agent Society | Defer | population / organization simulation | future research only | world state、tick、memory scope | 不把 simulation 当真实预测；memory scope 隔离 |
| MARL / CTDE | Defer | centralized training, decentralized execution | future research only | training environment、reward、policy | 不与普通 LLM orchestration 混淆 |
| Protocol-mediated Agent Network | Adopt | MCP / A2A / ACP / Agent Client Protocol 分层接入 | `acp`, provider runtime, future protocol gateway | protocol adapters、identity、auth、audit | 不混淆协议职责；外部 agent 权限最小化 |
| Composite Pattern | Adopt as reality | 生产系统组合多个 pattern | future `agent-orchestration` | pattern enter/exit events、shared trace id | 能定位是哪个 pattern / phase 造成失败 |

## Pattern 组合标准

### 代码审查循环

推荐组合：

`Generator-Critic + Clean Context + Refinement Loop + Event Log`

禁止组合：

`Writer full context + Self-review only + Auto-apply reviewer patch`

技术标准：

- Reviewer 输入只包含 goal summary、diff、touched files、test output、constraints、explicit decisions。
- Reviewer 输出 `ReviewFinding[]`，不能输出 patch 让系统自动应用。
- Writer 必须对每个 finding 做 accepted / rejected / fixed 决策。
- Loop 有最大轮数和 budget guard。

### 大规模代码迁移

推荐组合：

`Dynamic Workflow + Parallel Fan-out + Workspace Isolation + Verifier + Human Approval`

禁止组合：

`Group Chat + Shared Worktree + No Checkpoint`

技术标准：

- Discovery phase 必须先产生 file/task scope。
- Write phase 默认在 isolated worktree 或 branch。
- Verifier 和 worker 不共享上下文。
- Workflow script 是一等 artifact，运行前必须可审。
- 每个 branch 有 timeout、retry 和 artifact output。

### Cross-checked research

推荐组合：

`Parallel Fan-out + Adversarial Verifier + Blackboard Projection + Manager Synthesis`

技术标准：

- Worker 只提交 claim + evidence + source pointer。
- Verifier 目标是寻找反证，不是复述。
- Blackboard 中每条 fact 有 TTL、source、confidence、provenance。
- Final synthesis 只采纳 verified claims，未验证内容必须标注。

### Expert takeover

推荐组合：

`Handoff + Clarification-at-edge + Human-visible active agent`

技术标准：

- Handoff request 记录 reason、target、minimal context、return condition。
- Receiver 不继承完整历史，只继承 handoff context。
- 用户能看到当前是谁在 front。
- Handoff loop 必须被检测并中止。

### Protocol interoperability

推荐组合：

`Protocol-mediated Network + Guardrails + Event Log`

技术标准：

- MCP 只表达 tool / resource / prompt，不表达 Cradle agent lifecycle。
- A2A 表达外部 agent-to-agent task / message / artifact。
- Agent Client Protocol 表达 editor/client-to-coding-agent UX。
- ACP provider integration 仍要适配到 Cradle `chat-runtime` / `UIMessageChunk` 边界。

## 近期落地顺序

| 顺序 | 能力 | 选择理由 |
|---|---|---|
| 1 | Clean Review Loop | 风险低、收益明确、符合 single writer |
| 2 | Smart Friend / Agents-as-tools | 与 provider runtime / profiles 兼容，能提升复杂判断 |
| 3 | Manager Delegation | 可复用 `issue-agent`，补齐 child handoff 和 synthesis |
| 4 | Workspace Isolation | 支撑并行 writer 的唯一安全前提 |
| 5 | Graph Workflow | 长任务 resume / cancel / trace 的基础 |
| 6 | Dynamic Workflow | 需要前五项作为安全底座 |
| 7 | A2A Gateway | 先稳定内部语义，再接跨 vendor agent network |

## 不应近期投入的模式

这些不是“没价值”，而是 Cradle 当前还没有必要先做：

- Peer swarm：责任和收敛性弱，会破坏 owner 原则。
- Market / auction：需要可信 cost model 和 scoring function，当前收益不确定。
- MARL / CTDE：属于训练和仿真系统，不是 Cradle coding-agent runtime 的核心。
- Social simulation：产品价值与 coding workflow 距离较远。
- MoA：成本高，先用 verifier / debate 覆盖高价值决策。
