# Agent Experience Optimization Roadmap

> Status: Draft — 2026-05-07
> Owner: wibus
> Context: Cradle 目前已经具备 Codex / Claude Agent 驱动、built-in skills 注入、Cradle CLI、Chat continuity 与 Issue delegation 基础。下一阶段重点不再是“把更多行为塞进单次 chat”，而是建立更稳固的 session-level runtime，让 Agent 可以跨时间、跨外部状态持续推进工作。

---

## 路线概览

当前路线按“先打通基础运行时，再叠可见体验和高阶协同”排序：

1. **L1 — Skills 管理系统**：把 skills 变成可管理、可组合、可配置的稳定输入层。
2. **L2 — Session Await & Resume Runtime**：让 Agent 可以等待外部条件并自动续跑同一会话。
3. **L3 — Agent Session 体验增强**：把等待、计划、活动、elicitation 等结构化地投影给用户。
4. **L4 — Sandboxed Execution / VFS**：让修改文件与执行命令具备隔离与可审阅能力。
5. **L5 — Multi-Agent 协同**：在稳定 session runtime 和沙箱基础上做 delegation / supervisor / parallel execution。

核心顺序是：

> **先做 session-level primitives，再做 workflow-specialized features。**

也就是先把“会等待、会恢复、会显示状态”的底层打稳，再把 GitHub、Issue Agent、Multi-Agent 等上层能力叠上去。

---

## L1 — Skills 管理系统

**里程碑**: 2026 W19-W20

**动机**: Agent 效能的核心差异化依然来自 Skills。当前 built-in skills 与扫描能力已可用，但缺少可视化管理与 per-agent 配置能力。

**交付物**:
- [ ] Skills CRUD UI（查看、创建、编辑、删除）
- [ ] 全局 Skills vs Workspace Skills 分层管理
- [ ] Per-agent Skills 配置（按 agent profile 启用/禁用）
- [ ] Skill 编辑器（YAML frontmatter + Markdown body）
- [ ] Import/Export skills（兼容 `.agents/skills/` 目录格式）

**说明**:
- 这层是 Agent 的“知识输入控制面”。
- `Session Await & Resume` 会复用这层，通过 built-in skill 教会 Codex / Claude Agent 如何调用 Cradle CLI 注册等待。

---

## L2 — Session Await & Resume Runtime

**里程碑**: 2026 W20-W22

**动机**: 让 Agent 不必靠“用户回来再提醒我”这种人工接力工作。用户应该可以把一个目标交给 Agent，然后允许 Agent 等待 CI、PR review、部署、人工审批或其他外部条件，并在条件满足时继续推进同一会话。

这一层的 owner 不是 `kanban`，也不是 provider 本身，而是一个新的 **session-level runtime**。Kanban / Issue Agent 只能消费它，不拥有它。

**目标用户旅程**:

  1. 用户：推个 PR 吧，当 CI 搞定了之后，你就帮我合并吧
  2. Agent：推送 PR，注册等待 CI 成功的 subscription，并明确告知“我会等 CI 通过后自动合并”
  3. 当前 turn 结束，session 进入 Awaiting
  4. Cradle 在后台检查外部状态
  5. 条件满足后，Cradle 用外部状态构造 resume payload 并恢复同一 session
  6. Agent 基于完整历史继续工作：合并、修复失败、重新注册等待，直到任务完成

这个用户旅程决定了 L2 的设计边界：

- owner 必须是 session runtime，而不是单次消息流
- 恢复必须落回**同一个 session**，不能新建会话糊弄过去
- agent 必须能反复注册新的等待条件，直到任务真正闭环

### L2a — Generic Await Runtime Foundation

- [ ] `session_awaits` 数据模型与迁移
- [ ] `src/main/session-await/` owner（register / cancel / expire / trigger / query）
- [ ] Awaiting projection（而不是直接把状态塞回 `sessions` 主表）
- [ ] Manual trigger 路径（先不依赖 GitHub）
- [ ] `chatEngine.send()` resume dispatch 幂等保证

**验收目标**:
- 用户或测试可以为一个现有 session 注册 wait。
- 手动触发后，同一 session 继续执行，而不是创建新 session。

### L2b — Agent Registration Contract

- [ ] Cradle CLI 增加 `session await` 命令树
- [ ] built-in `cradle-cli` skill 更新等待命令说明
- [ ] 为 Agent 提供稳定的 current session context（`chatSessionId` / `workspaceId`）
- [ ] Codex / Claude Agent 通过 skills + CLI 注册 await，不引入新的 provider-layer tool API

**验收目标**:
- Agent 可以在当前会话里可靠注册等待，而不是靠猜 session。

### L2c — External Source Adapters

- [ ] Source checker registry
- [ ] Poller / dispatcher with backoff
- [ ] GitHub CI checker
- [ ] GitHub PR review checker
- [ ] timeout / cancel / transient error handling

**验收目标**:
- 一个外部 source 满足条件后，Cradle 自动恢复 session，并把外部状态作为新上下文注入。

### L2d — Issue-Agent / Kanban Consumption

- [ ] Issue Agent 复用 await runtime，而不是重写一套等待逻辑
- [ ] Issue 详情 / 侧栏显示 linked session 的 awaiting 状态
- [ ] delegated issue 的等待状态只是 projection，不污染 Kanban 本体语义

**验收目标**:
- delegated issue 可以显示“Waiting for CI / Review”，但 Kanban 依然只是 consumer。

**跟踪文档**:
- 详细 SPEC 与实施追踪见 `docs/exec-plans/20260507-02-session-await-resume-runtime.md`

---

## L3 — Agent Session 体验增强

**里程碑**: 2026 W22-W24

**动机**: 当 session 可以跨时间持续存在后，用户必须看得懂 Agent 现在在做什么、在等什么、下一步准备做什么。

### L3a — Agent Plans

- [ ] Plan 数据模型（per-session checklist: content + status）
- [ ] Plan UI 渲染（会话顶部/侧栏显示当前计划）
- [ ] Provider / runtime 映射到 Plan steps
- [ ] Plan 实时更新（streaming 中动态添加/完成步骤）

### L3b — 结构化 Activity & Elicitation

- [ ] 消息类型扩展（thought / action / elicitation / response / error）
- [ ] Elicitation 交互 UI（Agent 提问 + 选项卡片 + 用户回复）
- [ ] Stop signal 强化（用户发送 stop → Agent 确认停止）
- [ ] Ephemeral activity 支持（临时状态消息，被下一条覆盖）

### L3c — Awaiting UX

- [ ] Session list Awaiting badge
- [ ] Chat header waiting reason / source 展示
- [ ] Trigger history / last resume summary
- [ ] 用户可取消等待或改为手动继续

---

## L4 — Sandboxed Execution / VFS

**里程碑**: 2026 W24-W27

**动机**: Agent 跨时间持续执行后，文件修改和命令执行的安全边界会比单轮 chat 更重要。用户应能 preview → accept → 落盘，而不是把真实工作区直接暴露给长生命周期自动化流程。

### L4a — Spike

- [ ] 技术路线评估：WASM MemFS vs Git worktree vs CoW tmpfs vs Container
- [ ] PoC 验证选定方案
- [ ] 确定 diff preview UI 交互模式

### L4b — 实现

- [ ] Sandbox 文件系统抽象层
- [ ] Agent session 绑定独立沙盒
- [ ] Diff preview panel（文件变更预览）
- [ ] Accept / Reject / Partial-accept 操作
- [ ] Shell 命令沙盒执行（输出捕获、副作用隔离）

---

## L5 — Multi-Agent 协同

**里程碑**: 2026 W27+

**前置依赖**: L1 + L2 + L3 稳定，L4 至少具备基础沙箱能力。

**方向**:
- [ ] Agent-to-Agent delegation（子任务委派）
- [ ] Supervisor pattern（编排 Agent）
- [ ] Parallel execution（多 Agent 并行）
- [ ] Human-in-the-loop arbitration（人工裁判）
- [ ] Agent 通信协议（消息格式、上下文传递）

这里的重点是：

> 没有 `Session Await & Resume Runtime`，多 Agent 会退化成一堆并行但短命的单轮 worker。

所以 L5 必须建立在 L2 之上。

---

## 设计原则

1. **Session 是一等公民** — 长生命周期 agent workflow 应先挂在 session runtime，而不是先绑定某个业务模块。
2. **Kanban 是 consumer，不是 orchestration owner** — board / issue / status 主要是人类任务语义；可消费 agent runtime，但不应该反过来定义它。
3. **Cradle 自己拥有产品语义** — provider 负责执行，Cradle 负责等待、恢复、审批、投影、历史与状态。
4. **技能是 contract，不是借口** — built-in skills 应该教会 agent 调用稳定的 Cradle contract（优先 CLI），而不是让系统依赖模糊的 prompt 魔法。
5. **状态必须可见** — waiting / planning / acting / blocked 都要在 UI 中可追踪。
6. **人承担最终责任** — agent 可以继续推进，但用户始终需要知道它在等什么、为什么恢复、如何停止。

---

## Open Questions

- Current session context 应通过什么形式提供给 agent？
  - 选项 A: provider env（如 `CRADLE_CHAT_SESSION_ID`）
  - 选项 B: system workflow 注入固定上下文块
  - 选项 C: A + B 双轨，env 为主，prompt 为兜底
  - **当前倾向**: C

- GitHub token 的作用域应该是什么？
  - 选项 A: 全局
  - 选项 B: workspace-scoped
  - 选项 C: source adapter 自定义
  - **当前倾向**: B 或 C，避免把 workspace 外部集成误做成完全全局状态

- Await source registry 是完全泛化，还是先做白名单 adapter？
  - **当前倾向**: 先做白名单 adapter interface，先落 GitHub，再视实际需求泛化

- 是否要把“等待人工审批”也并入同一个 runtime？
  - **当前倾向**: 先不强行合并；`approval` 与 `await-runtime` 可在 query/UI 层收敛，但不先做统一抽象
