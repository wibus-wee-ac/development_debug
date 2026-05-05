<!-- Once this directory changes, update this README.md -->

# Backend Architecture Overhaul Audit (2026-05-04)

## 1. Direct Conclusion

当前后端是可运行但高耦合的单体 Main-Process Backend：

- 优点：`IPC -> Service -> Lib -> DB/Process` 主路径存在，功能完整，local-first 一致。
- 问题：核心编排对象过大（`ChatEngine`），领域边界混杂（chat / kanban / agent-runtime），以及历史演进导致的会话模型重叠（`sessions` / `runtime_sessions` / `agent_sessions`）。
- 可行策略：允许破坏性重构时，应该直接转向“领域内聚 + 应用编排显式化 + 事件化生命周期 + 表模型收敛”。

## 2. Current Top-Down Runtime Flow

### 2.1 Bootstrap Flow

1. `src/main/index.ts`
2. `initDb()` + migration
3. provider catalog bootstrap (`acp`, `cli-tui`, `openai-compatible`)
4. `ChatEngine.initialize()`
5. `createServices([...])` 注册 IPC service
6. socket server (`src/main/lib/socket-server.ts`) 启动 CLI 入口
7. `BrowserWindow` 创建 + chat/pty/devtool 订阅

### 2.2 Invocation Flow

1. Renderer / CLI 发起调用
2. `@cradle/ipc` handler (`packages/ipc/src/base.ts`)
3. `src/main/services/*`（IPC facade）
4. `src/main/lib/*`（领域或基础设施编排）
5. `src/main/db/*`（SQLite/Drizzle）或外部进程/网络

### 2.3 Push/Event Flow

1. `ChatEngine` / `PtyManager` / devtool store 产出事件
2. `webContents.send('chat:*'|'pty:*'|'ipc-devtool:*'...)`
3. Renderer listeners 更新 UI

## 3. Data Flow Inventory (entry -> transform -> store/emit)

### 3.1 Chat

- `chat.createAndSend` -> `ChatEngine.prepareTurn/runStream` -> `sessions/messages/usage_logs` + emit `chat:response-event`
- `chat.send` -> provider resume + stream -> update `messages.status/content` + update `sessions.updatedAt`
- `chat.abort` -> provider cancel -> finalize message as `aborted` + emit completion event

### 3.2 Issue-Agent Delegation

- `issueAgent.delegateIssue` -> `issue-delegation-application.delegateIssue` -> write `agent_sessions`, update `kanban_issues.delegateAgentId`, append `kanban_issue_comments`
- `issueAgent.runDelegatedIssue` -> `IssueAgentRunner.run` -> create chat session + append `agent_activities`
- `ChatEngine onTurnFinished` -> `IssueAgentRunner.onTurnFinished` -> update `agent_sessions.status` + append response/error activity
- `issueAgent.undelegateIssue` -> `issue-delegation-application.undelegateIssue` -> stop active session + clear delegate + append system comment

### 3.3 Agent Runtime

- `agentRuntime.upsertProfile` -> repository upsert -> `agent_profiles`
- `agentRuntime.removeProfile` -> explicit cleanup transaction -> `agents/agent_sessions/runtime_sessions/sessions/usage/runtime_audit` then `agent_profiles`
- `agentRuntime.probeProfile/listModels` -> provider calls -> `runtime_audit_log`

### 3.4 Skills

- `skills.*` IPC -> `lib/skills.ts` scan/CRUD/import/export -> filesystem roots (`builtin/legacy/global/workspace/agent`)

### 3.5 CLI Socket

- `src/cli/index.ts` -> `rpc-client.ts` -> unix socket -> `socket-server.ts` -> shared services

## 4. DDD Compliance Assessment

### 4.1 Bounded Contexts (Current)

- Workspace: mostly clear
- Chat Runtime: clear but over-centralized in one class
- Kanban: entity model clear, orchestration leaked into service (partially fixed)
- Agent Runtime: capabilities clear, deletion semantics historically unsafe (fixed first step)
- Skills: context clear, filesystem ownership explicit

### 4.2 Major Boundary Violations

1. `ChatEngine` 同时承担应用服务 + 领域规则 + 基础设施细节
2. `IssueAgentRunner` 仍同时承担委派状态机、chat bridge、activity/comment 投影与运行时收口
3. 会话模型并存导致语义不清（chat session vs runtime session vs issue agent session）
4. 多个 singleton 跨上下文直连，导致生命周期和可替换性弱

### 4.3 Anti-patterns

- God Object: `src/main/lib/chat/chat-engine.ts`
- Temporal Coupling: 多处 “先写 DB、再异步启动/恢复 provider” 的顺序耦合
- Hidden Side Effects: service 方法内隐式写入多个表与评论投影
- Weak Aggregate Boundary: issue delegation 的状态机未完全抽象为聚合行为

## 5. Code Quality & Architecture Elegance Findings

### Top Risk Files

1. `src/main/lib/chat/chat-engine.ts` (size + responsibilities)
2. `src/main/contexts/issue-agent/infrastructure/issue-agent-runner.ts` (委派状态机 + chat bridge + activity projection)
3. `src/main/services/agent-runtime.ts` (profile lifecycle + credential + provider audit)
4. `src/main/db/schema/` (领域语义现已分模块，但跨上下文引用仍值得持续审视)
5. `src/main/contexts/issue-agent/infrastructure/issue-agent-runner.ts` 之外，公开 IPC ownership 仍需持续检查是否漂移

### Highest-Risk Design Issues

1. 会话实体语义重叠 (`sessions`, `runtime_sessions`, `agent_sessions`)
2. Chat completion 之前用轮询收口（已改为事件驱动）
3. profile 删除曾依赖关闭 FK（已移除）
4. Service 层过去包含过多编排（已开始抽离）

## 6. Changes Already Implemented in This Overhaul Pass

1. `ChatEngine` 增加 `onTurnFinished` 生命周期事件。
2. `IssueAgentRunner` 从 polling 完成检测改为事件驱动收口。
3. `AgentRuntimeService.removeProfile` 删除了 `PRAGMA foreign_keys = OFF`，改为显式事务清理依赖。
4. 新增 `src/main/contexts/issue-agent/application/issue-delegation-application.ts`，并在后续切片中删除了旧的 `src/main/lib/issue-delegation.ts`。
5. 新增 `src/main/contexts/kanban/application/kanban-write-application.ts`，将 Kanban 写侧命令从 `KanbanService` 下沉。
6. 新增 `src/main/contexts/kanban/application/kanban-query-application.ts`，将 Kanban 读侧查询与 linked-issue 投影从 `KanbanService` 下沉。
7. 删除了 `KanbanService` 中无调用方的 agent session/activity 直接写入 IPC 方法，使其成为纯 facade。
8. 将活跃的 Kanban 与 issue-agent 后端代码迁移到 `src/main/contexts/`，让目录结构显式表达 ownership。
9. 新增 `src/main/contexts/issue-agent/application/issue-agent-query-application.ts` 与 `src/main/contexts/issue-agent/interfaces/issue-agent-service.ts`，把 delegation / session / activity 的公开 IPC surface 从 `kanban.*` 正式迁移到 `issueAgent.*`。
10. 将 `KanbanService` 与 `IssueAgentService` 继续迁入各自 `contexts/*/interfaces/`，让活跃业务上下文的对外 adapter 也回到 owner context，而不是继续挂在根级 `services/` 技术桶下。

## 7. Target Architecture (Rebuild-Friendly)

```text
interfaces/
  ipc-services (pure adapters, no domain workflow)

application/
  chat-app-service
  issue-delegation-app-service
  kanban-write-app-service
  agent-profile-app-service

domain/
  chat-session aggregate
  issue aggregate (with delegation state machine)
  agent-profile aggregate

infrastructure/
  drizzle repositories
  provider adapters
  process managers
  filesystem skill store

events/
  turn-finished
  issue-delegated
  issue-undelegated
  agent-session-completed
```

### Dependency Rules

1. `services` 只能调用 `application`，不直连复杂 `infrastructure`
2. `domain` 不依赖 `electron` / `ipc` / `drizzle`
3. `infrastructure` 只实现接口，不承载业务规则
4. cross-context 通信使用显式 domain/app events

## 8. Destructive Refactor Roadmap (No Data Migration Required)

### P0 (Immediate)

1. 把 chat turn orchestration 拆成：
   - `chat-turn-orchestrator`
   - `chat-message-repository`
   - `chat-event-bus`
2. 定义 issue delegation 的显式状态转换（created -> active -> completed/failed/stopped）
3. 清理 `KanbanService`：读写 facade 已完成，下一步聚焦 `IssueAgentRunner` 的拆分与职责收缩

### P1 (Model Collapse)

1. 合并/重命名会话模型，消除 `runtime_sessions` 与 `sessions` 的重叠（保留一个 canonical runtime-capable session）
2. 把 `agent_sessions` 明确为 issue context 下的 execution record（不再混用 chat 会话语义）

### P2 (Stability + Evolvability)

1. 引入 repository interfaces 和 application transaction boundary
2. 引入统一 domain event pipeline（替代隐式 side effects）
3. 去 singleton 化高耦合对象，改 composition-root 注入

## 9. Verification Evidence

### Commands Run

1. `pnpm -s tsc -p tsconfig.node.json --noEmit` (pass after changes)
2. 多次 `rg/sed/git diff` 对关键路径做静态证据扫描

### Files Touched in This Pass

1. `src/main/lib/chat/chat-engine.ts`
2. `src/main/contexts/issue-agent/infrastructure/issue-agent-runner.ts`
3. `src/main/services/agent-runtime.ts`
4. `src/main/contexts/issue-agent/application/issue-delegation-application.ts`
5. `src/main/contexts/kanban/application/kanban-write-application.ts`
6. `src/main/contexts/kanban/interfaces/kanban-service.ts`
7. `src/main/contexts/issue-agent/interfaces/issue-agent-service.ts`
8. `src/main/lib/README.md`