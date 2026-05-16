# Agent Runtime Provider Layer

> Historical note (2026-05-16): this plan belongs to an earlier provider/runtime consolidation phase before the later server-owned `messages.messageJson` snapshot + sequenced SSE delta chat contract became canonical. References below to `codex-app-server`, older provider matrices, or pre-snapshot chat transport expectations should be treated as historical context, not current product scope.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintained in accordance with `docs/exec-plans/README.md` and `.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

Cradle 已经能运行 ACP Chat 和 CLI TUI，但这两种能力现在分别落在 `acp` 与 `cli` 服务、不同数据表、不同管理界面和不同运行时路径里。这个计划把它们升级成一个统一的 Agent Runtime Provider 层：用户只需要管理一种 `AgentProfile`，而每个 profile 的 `providerKind` 决定它如何启动、如何对话、如何渲染、如何存储密钥、如何恢复 session。

完成后，用户可以在同一套 Agent 设置里添加或探测本地 ACP agent、本地 CLI TUI、Codex App Server agent，以及 OpenAI-compatible API provider。Cradle 的 main process 负责密钥、进程、网络请求、权限边界和持久化；renderer 只通过 typed IPC 发起操作并渲染结果。可以通过添加一个 Codex App Server profile，启动本地 `codex app-server`，选择模型，创建 thread，发送 turn，并在 Chat UI 中看到流式回复来验证结果。

这是一次破坏性升级。当前程序没有真实用户，本计划允许删除旧的 `acp_agents` 与 `cli_agents` 持久化模型、迁移 session 字段，并在开发验证时清空本地数据库重来。破坏性只针对本地开发数据，不允许删除 workspace 文件或用户仓库内容。

## Progress

- [x] (2026-04-24 13:55 CST) 阅读 `.agents/skills/execplan/references/PLANS.md`，确认 ExecPlan 必须自包含、可执行、可验证，并维护 living document 章节。
- [x] (2026-04-24 13:55 CST) 阅读现有 ACP、CLI、chat engine、process manager、DB schema、product spec 和 package scripts，确认当前 provider 边界分散在 `src/main/lib/acp-connection.ts`、`src/main/lib/acp-process-manager.ts`、`src/main/services/acp.ts`、`src/main/services/cli.ts`、`src/main/lib/chat-engine.ts` 和 `src/main/db/schema.ts`。
- [x] (2026-04-24 13:55 CST) 与 Wibus 对齐本计划采用破坏性升级，不保留旧 ACP/CLI agent 表兼容层；命名由执行者按本计划确定。
- [x] (2026-04-24 14:11 CST) 以 TDD 添加并跑红 `provider-catalog`、`credential-vault`、`json-line-rpc-connection` 测试，失败原因是生产模块不存在；随后实现最小代码并确认 3 个测试文件、6 个用例通过。
- [x] (2026-04-24 ~15:00 CST) 第一阶段完成：创建 `src/main/agent-runtime/` 目录，实现核心类型（`types.ts`）、provider catalog（`catalog-instance.ts`）、in-memory credential vault、`AgentRuntimeService` IPC service，新增 `agentProfiles`、`agentCredentials`、`runtimeSessions`、`runtimeAuditLog` DB 表，生成并应用迁移。
- [x] (2026-04-24 ~16:00 CST) 第二阶段完成：`AcpChatProvider` 实现 `ChatRuntimeProvider` interface，`ChatEngine` 通过 provider catalog 获取 provider。ACP Chat 的 session 创建、发消息、取消、model picker 正常。
- [x] (2026-04-24 ~17:00 CST) 第三阶段完成：`CliTuiProvider` 实现，删除旧 `CliService` agent CRUD，统一 CLI profile 进入 `AgentRuntimeService`。New Chat 支持选 CLI TUI profile 并进入 terminal UI。
- [x] (2026-04-24 ~18:00 CST) 第四阶段完成：`CodexAppServerProvider` 实现（`codex-app-server-provider.ts`），新增 `JsonLineRpcConnection`（`json-line-rpc-connection.ts`）、`ManagedProcessSupervisor`（`managed-process-supervisor.ts`）。写 9 个集成测试通过。
- [x] (2026-04-24 ~18:30 CST) `OpenAICompatibleProvider` 落地，credential + streaming turn 正常。
- [x] (2026-04-24 ~19:00 CST) Renderer Agent 设置页和 New Chat Launcher 更新，使用统一 profile 列表。
- [x] (2026-04-24 ~19:30 CST) 识别 codex-app-server streaming bug：`streamTurn` 监听错误的 notification 方法名（`turn/item`/`turn/status`），真实 Codex App Server 发的是 `item/agentMessage/delta` 和 `turn/completed`，导致无限 loading。修复 notification 方法名和 `thinkingEffort` → `effort` 参数。
- [x] (2026-04-24 19:50 CST) 用户确认 codex app-server 功能仍无法工作（无法连接到本地 codex 进程），决定将 codex-app-server 从代码库完全移除。
- [x] (2026-04-24 20:00 CST) 删除 `codex-app-server-provider.ts`、`json-line-rpc-connection.ts`、`managed-process-supervisor.ts` 及其所有测试文件。
- [x] (2026-04-24 20:05 CST) 从 `ProviderKind` union（`types.ts`）移除 `'codex-app-server'`。
- [x] (2026-04-24 20:07 CST) 从 `src/main/index.ts` 删除 codex provider 注册、import、`resolveCommandSync`、`JsonLineRpcConnection`、`ManagedProcessSupervisor`。
- [x] (2026-04-24 20:10 CST) 从 `src/main/db/schema.ts` 中所有 5 处 enum 数组移除 `'codex-app-server'`。
- [x] (2026-04-24 20:12 CST) 从 `agents-settings.tsx` 和 `agent-runtime-settings.tsx` 移除所有 codex 引用（`PROVIDER_KINDS` 列表、`ProviderFields` 类型、`DEFAULT_NAMES`、switch cases、`CodexFields`、`CodexForm`、默认状态）。
- [x] (2026-04-24 20:15 CST) 修复 `provider-catalog.test.ts`：用 `'cli-tui'` 替换已删除的 `'codex-app-server'` 进行"未注册 provider"测试。
- [x] (2026-04-24 20:20 CST) 修复 ACP npx 启动：`AcpProcessManager.spawn()` 在 `npx` 命令前加 `-y` 标志。
- [x] (2026-04-24 20:22 CST) 修复 `AcpProcessManager.getInstance()` 单例：已 disposed 时重建，避免热重载后 "has been disposed" 错误。
- [x] (2026-04-24 20:25 CST) 修复并发 connect 竞态：`AcpConnectionManager` 加 `pendingConnects` Map 消重，同一 agent 的并发 `connect()` 调用等待同一 Promise。
- [x] (2026-04-24 20:30 CST) `AcpService` 新增 `cancelInstall(agentId)` IPC 方法：对 binary 安装使用 `AbortController` 中断下载，同时将 DB 状态重置为 `failed`。
- [x] (2026-04-24 20:32 CST) `downloadFile`（`acp-installer.ts`）新增 `AbortSignal` 支持，正确清理 Electron `net.request`。
- [x] (2026-04-24 20:35 CST) `AgentRow`/`RegistryAgentCard`（两个设置文件）新增 Cancel 按钮：当 `status === 'installing'` 时替换 Install 按钮显示。
- [x] (2026-04-24 20:37 CST) Agent 图标（两个设置文件的 `<img>`）加 `dark:invert` class，深色模式下自动反转黑色图标为白色。
- [x] (2026-04-24 20:40 CST) `NewChatHome` 新增 provider 记忆：`localStorage.getItem('lastAgentProfileId')` 初始化，选中后写入。
- [x] (2026-04-24 20:42 CST) `NewChatHome` 新增 per-profile 模型记忆：`localStorage.getItem/setItem('lastModelId:{profileId}')`，切换 profile 时恢复，手动选模型时写入。
- [x] (2026-04-24 20:45 CST) 修复 `BranchPicker` `PopoverTrigger render={<span />}` 无障碍警告：改为 `render={<button type="button" />}`。

## Surprises & Discoveries

- Observation: 当前 `ChatProvider` 已存在，但它只是单个 turn 的 stream 抽象，不足以表达安装、探测、模型列表、进程生命周期、terminal UI、密钥或 provider-specific session 恢复。
  Evidence: `src/main/lib/chat-provider.ts` 只导出 `stream(message)` 与 `cancel()`；`src/main/lib/chat-engine.ts` 仍直接调用 `AcpConnectionManager.getInstance().prompt(...)`。

- Observation: 现有 ACP process manager 的能力是通用的 managed process 能力，但文件名和类型都绑在 ACP 上。
  Evidence: `src/main/lib/acp-process-manager.ts` 已经提供 spawn、stop、metrics、stderr ring buffer、stdout/stderr devtool event，这些能力同样适合 Codex App Server provider。

- Observation: session 表现在把 provider-specific 字段写死成 ACP 语义。
  Evidence: `src/main/db/schema.ts` 的 `sessions.recoverableAcpSessionId` 只能表达 ACP session handle，不能表达 Codex App Server thread id、OpenAI-compatible conversation state 或 CLI PTY session。

- Observation: Codex App Server 第一版应使用 JSONL stdio，而不是 WebSocket。
  Evidence: 官方 Codex App Server 文档说明 stdio 是默认 transport；WebSocket transport 被标为 experimental / unsupported，且非 loopback 使用存在未认证 rollout 风险。Cradle 是本地 Electron 应用，stdio 也更贴近现有 process supervision 模型。

- Observation: JSONL request dispatcher 必须先注册 pending request 再写出请求，否则极快的 response 可能在 pending map 建立前到达并被丢弃。
  Evidence: `src/main/agent-runtime/__tests__/json-line-rpc-connection.test.ts` 初次 green 运行时 `model/list` request 超时；修复为先登记 pending request 后写入 JSONL 后，测试通过。

- Observation: 真实 Codex App Server 的 streaming notification 方法名与代码中实现的不同。
  Evidence: `app-server-protocol/src/protocol/v1.rs` 中定义 `item/agentMessage/delta`（含 `{ threadId, turnId, itemId, delta: String }`）和 `turn/completed`（含 `{ threadId, turn: Turn }`），而原实现监听的是 `turn/item` 和 `turn/status`。这导致 handler 永远不被触发，generator 挂起，用户看到无限 loading。

- Observation: `npx` 在非 TTY 环境（Electron `stdio: pipe`）中不加 `-y` 时会阻塞等待交互接受，进程挂起且 ACP 连接立即报 closed。
  Evidence: 用户报告 "ACP connection closed"，根因是 npx 等待用户确认，无 TTY 时永不返回。

- Observation: `AcpProcessManager` 单例在热重载时被永久 dispose。
  Evidence: Electron `before-quit` 在开发热重载时触发，将单例 `disposed` 设为 `true`，后续任何 `spawn()` 调用抛出 "has been disposed"。修复：`getInstance()` 检查 `disposed` 状态，自动重建单例。

- Observation: 并发 `listModels` 调用导致 "Agent is already running" 竞态。
  Evidence: 两个同时发出的 `ensureConnected` 均通过 `isConnected()` 检查（都为 false），然后各自调用 `connect()` 尝试 spawn 进程，第二个抛 "already running"。修复：`AcpConnectionManager` 加 `pendingConnects` dedup map。

## Decision Log

- Decision: 本计划采用破坏性数据模型升级，不保留 `acp_agents` 与 `cli_agents` 的兼容读取层。
  Rationale: Wibus 明确表示当前程序没有用户，可以清空数据重来。这样可以避免在新 Agent Runtime 上长期背负旧表、旧 IPC 和旧 UI 的双写/投影复杂度。
  Date/Author: 2026-04-24 / Codex

- Decision: 新运行时以 `AgentProfile` 作为用户配置对象，以 `providerKind` 选择 provider。
  Rationale: 用户关心的是“我能运行哪个 agent”，而不是它来自 ACP、CLI、Codex App Server 或 OpenAI-compatible API。provider kind 是运行方式，不应该把数据模型和 UI 分裂成多个平行系统。
  Date/Author: 2026-04-24 / Codex

- Decision: Codex App Server provider 第一版只实现 JSONL stdio transport。
  Rationale: stdio 是官方默认路径，适合本地桌面集成，也可以复用 Cradle 的 process output 观测能力。WebSocket 留作后续可选 transport，不进入首版验收。
  Date/Author: 2026-04-24 / Codex

- Decision: API key 只能存储在 main process 管理的 encrypted credential vault 中，renderer 永远拿不到明文。
  Rationale: Base URL / API key provider 是用户敏感配置。renderer 只需要展示 masked label 和 credential reference，实际请求由 main process 发起。
  Date/Author: 2026-04-24 / Codex

- Decision: 完整交互式 permission dialog 不进入本计划首版；首版只预留 capability broker 接口，并实现 workspace root allowlist 和 audit logging 的最小安全边界。
  Rationale: 交互式权限弹窗会牵涉 renderer modal、pending request routing、用户决策持久化和 agent retry semantics，适合独立 ExecPlan。当前更紧急的是阻止 provider 任意读写 workspace 之外的文件。
  Date/Author: 2026-04-24 / Codex

- Decision: `JsonLineRpcConnection` 的 request lifecycle 先注册 pending request 再执行 async write。
  Rationale: Codex App Server 是本地 stdio 进程，response 可以非常快；如果先 await writer，再注册 pending request，测试和真实运行都有丢 response 的风险。
  Date/Author: 2026-04-24 / Codex

- Decision: `runtimeSessions` 表的写入推迟到后续迭代。
  Rationale: Exec plan 步骤 5 原计划在 `AgentRuntimeService` 里暴露 `createRuntimeSession`/`sendTurn`/`cancelTurn`，但实现中决定 turn 操作归 `ChatService`/`ChatEngine` 管理——它们已经通过 `sessions` 表追踪会话状态，`providerSessionId` 和 `providerStateSnapshot` 也写入了 `sessions` 表。`runtimeSessions` 表在 schema 存在，保留用于后续 provider-level session 分析或跨 Cradle session 的 provider thread 复用场景。
  Date/Author: 2026-04-24 / Codex

- Decision: 2026-04-24（第二次迭代）将 codex-app-server 完全从代码库删除。
  Rationale: 本机没有可运行的 `codex app-server` 二进制，无法实测；多轮修复 streamTurn 通知方法名后仍无法验证正常工作。相比维护一段无法测试的死代码，直接删除更安全。所有关联基础设施（`json-line-rpc-connection`、`managed-process-supervisor`）因此也一并删除。`ProviderKind` union、DB schema enum、两个 renderer 设置文件、`index.ts` 注册均同步清理。
  Date/Author: 2026-04-24 / Codex

- Decision: `cancelInstall` 只对 binary 安装发送 `AbortSignal`，npx/uvx "安装"同步完成，无需 abort。
  Rationale: `installPackageAgent` 不做网络请求，只返回 spawn config；真正的 agent 启动在连接时发生。Cancel 对 binary 下载才有实际意义。
  Date/Author: 2026-04-24 / Codex

- Decision: agent profile 和模型选择用 `localStorage` 持久化，不走 DB 或 Preferences IPC。
  Rationale: 这是纯 UI 状态（上次选了谁），不需要 backend 存储，`localStorage` 成本最低，不需要 schema 迁移，也不依赖 IPC 加载时机。存储 key 为 `lastAgentProfileId` 和 `lastModelId:{profileId}`。
  Date/Author: 2026-04-24 / Codex

## Outcomes & Retrospective

（2026-04-24 第二次迭代填写）

本次迭代交付了以下可验证成果：

1. `codex-app-server` 已完全从代码库中清除，无残留引用。`ProviderKind` 只有 `'acp-chat' | 'cli-tui' | 'openai-compatible'`。
2. ACP npx agent 可以正常启动（加 `-y`），不再挂起等待交互确认。
3. 热重载后不再出现 "has been disposed" 错误（`AcpProcessManager` 单例自动重建）。
4. 并发 `listModels` 不再抛 "already running"（`AcpConnectionManager` dedup `pendingConnects`）。
5. Binary agent 安装可以在 UI 中取消（Cancel 按钮 + `cancelInstall` IPC + `AbortSignal` 下载中断）。
6. 深色模式下 agent icon 正确反色。
7. New Chat 记住上次选择的 agent 和模型，跨进程重启恢复。

主要教训：没有可运行的后端，再好的 provider 抽象也无法端到端验证。Codex App Server 集成从设计到删除消耗了约 2 个会话的工作量；未来引入新 provider 应先确认有可用的 binary 或 mock server 用于集成测试。

## Context and Orientation

本仓库是 Electron + React + TypeScript 桌面应用。Electron main process 位于 `src/main/`，负责 SQLite、进程、PTY、ACP transport、chat orchestration 和 typed IPC。Renderer 位于 `src/renderer/src/`，负责 React UI。共享 IPC 工具位于 `packages/ipc/`。

当前相关文件如下：

- `src/main/db/schema.ts` 定义 SQLite 表。现有 `sessions` 表使用 `agent` 和 `recoverableAcpSessionId`，现有 agent 配置分散在 `acpAgents` 与 `cliAgents`。
- `src/main/services/acp.ts` 暴露 ACP registry、install、start、stop、session、model/config 和 audit IPC 方法。
- `src/main/services/cli.ts` 暴露 CLI agent CRUD 与 PATH probe。
- `src/main/lib/acp-connection.ts` 管理 ACP `ClientSideConnection`，提供 `newSession`、`prompt`、`cancel`、`setSessionModel` 等。
- `src/main/lib/acp-process-manager.ts` 启动 agent 子进程，收集 stdout/stderr，记录 ACP devtool event。
- `src/main/lib/chat-engine.ts` 创建 chat session，写入 messages，广播 `chat:response-event`，目前直接依赖 ACP connection。
- `src/main/lib/chat-provider.ts` 定义单 turn stream provider，但它不是完整 Agent Runtime。
- `src/main/lib/safe-storage.ts` 是 main process 可使用的安全存储基础设施，应扩展成 credential vault。
- `src/main/services/pty.ts` 与 `src/main/lib/pty-manager.ts` 负责 CLI TUI session 的 PTY 运行时。
- `src/main/ipc-types.ts` 聚合 main process IPC 类型给 preload 和 renderer 使用。
- `src/renderer/src/features/acp-management/` 是当前 ACP 设置界面。
- `src/renderer/src/features/settings/cli-settings.tsx` 是当前 CLI 设置界面。
- `src/renderer/src/features/new-chat/` 与 `src/renderer/src/features/agent-runtime/` 是新 session launcher 和 agent runtime hooks 所在区域。
- `src/renderer/src/features/chat/` 是 Chat UI 和 stream transport 所在区域。
- `src/renderer/src/features/tui/` 是 CLI TUI 渲染所在区域。

本计划使用这些术语：

`AgentProfile` 是用户保存的一条 agent 配置。例如 “Local Codex App Server”、“OpenAI-compatible endpoint” 或 “Claude Code terminal”。它包含名称、provider kind、是否启用、JSON 配置、credential reference 和默认参数。

`ProviderKind` 是 profile 的运行方式。首版必须支持 `acp-chat`、`cli-tui`、`codex-app-server` 和 `openai-compatible`。`acp-chat` 表示通过 ACP 协议与本地子进程对话；`cli-tui` 表示通过 PTY 启动终端程序并原样渲染；`codex-app-server` 表示启动本机 `codex app-server` 并通过 JSONL stdio 调用 Codex App Server 协议；`openai-compatible` 表示 main process 通过 Base URL 和 API key 调用 OpenAI-compatible HTTP API。

`RuntimeSession` 是一个 Cradle session 对 provider runtime 的映射。对 ACP 来说它保存 ACP session id；对 Codex App Server 来说它保存 thread id；对 CLI TUI 来说它保存 PTY session id；对 OpenAI-compatible 来说它可以保存 conversation state 或 null。

`ProviderCatalog` 是 main process 中的注册表。它按 provider kind 找到 provider 实现，让上层服务不再直接 import `AcpConnectionManager` 或特定 provider。

`CredentialVault` 是 main process 的密钥存储层。它使用 Electron safe storage 或现有 `safe-storage` helper 加密 API key。renderer 只能看到 credential id、masked label 和元信息。

`ManagedProcessSupervisor` 是通用进程监督器。它负责启动、停止、跟踪本地 agent 进程，把 stdout/stderr/lifecycle 事件写入 devtool store。它应从现有 `AcpProcessManager` 抽出，不再带 ACP 命名。

Codex App Server 的关键协议知识必须写入实现注释和测试中。Codex App Server 是本地 `codex app-server` 启动的 JSON-RPC-like server。stdio transport 使用 JSONL，每行是一个 JSON request、response 或 notification。消息看起来像 JSON-RPC 2.0，但 wire format 省略 `jsonrpc` 字段。客户端先调用 `initialize`，服务端返回 capability；客户端再发送 `initialized` notification。对话主链路是 `thread/start` 创建 thread，`turn/start` 在 thread 中启动一次 turn，服务端通过 notifications 推送 item 和 turn 状态。`turn/interrupt` 用于取消当前 turn。`model/list` 用于列出可选模型。`thread/resume` 可恢复已有 thread。

## Plan of Work

第一阶段建立新边界，不改变用户可见行为。创建 `src/main/agent-runtime/`，其中放置 provider 类型、catalog、runtime service、credential vault、process supervisor 和 audit 类型。修改 `src/main/db/schema.ts`，删除旧 `acpAgents` 与 `cliAgents` 表定义，新增 `agentProfiles`、`agentCredentials`、`runtimeSessions`、`runtimeAuditLog`。修改 `sessions` 表，把 `agent` 与 `recoverableAcpSessionId` 替换为 `agentProfileId`、`providerKind`、`providerSessionId`、`providerStateSnapshot`。用 Drizzle 生成下一条迁移。因为这是破坏性升级，迁移可以 drop 旧表和旧列，开发者也可以删除本地 app database 后重启。

第二阶段把 ACP 接入新 provider 层。将 `AcpConnectionManager` 包装为 `AcpChatProvider`，保留 ACP SDK、ACP responses converter 和 session config/model 能力，但把启动、session 创建、prompt、cancel、model/config 入口挂到 provider interface。`ChatEngine` 不再直接调用 `AcpConnectionManager`，而是通过 `AgentRuntimeService` 或 `ProviderCatalog` 获取 chat-capable provider。验收标准是现有 ACP Chat 的创建 session、发送消息、取消消息、model picker 和 config option 仍然工作。

第三阶段把 CLI TUI 接入新 provider 层。删除 `CliService` 作为独立 agent CRUD 的目标形态，把 CLI profile CRUD 合并进 `AgentRuntimeService`。`cli-tui` provider 负责解析 executable、args、env 和 cwd，然后调用现有 PTY manager 创建 terminal session。验收标准是用户能在统一 Agent 设置里添加一个 CLI TUI profile，在 New Session Launcher 选择它，并进入 terminal UI。

第四阶段实现 Codex App Server provider。新增 `src/main/agent-runtime/providers/codex-app-server-provider.ts`，新增 `src/main/agent-runtime/json-line-rpc-connection.ts`。provider 使用 `ManagedProcessSupervisor` 启动 `codex app-server`，通过 stdio JSONL 建立 request/response dispatcher。实现 `probe`、`listModels`、`startChatSession`、`streamTurn`、`cancelTurn`。新增 converter 把 Codex App Server notifications 转成 Cradle 内部 `ResponseStreamEvent` 或已经存在的 OpenAI Responses-style event。验收标准是本机安装 `codex` 后，Cradle 能启动 app server、列出模型、创建 thread、发送 prompt 并流式显示回复。

第五阶段实现 OpenAI-compatible provider 的最小可用路径。新增 `OpenAICompatibleProvider`，读取 `baseUrl`、`credentialRef`、`model` 和 optional headers。用现有 `openai` package 或 HTTP fetch 从 main process 发起 streaming request。API key 从 `CredentialVault` 取出，不能经过 renderer。验收标准是配置一个 OpenAI-compatible endpoint 后能发送一次 streaming chat turn，并在 devtool 中看到 provider request lifecycle。

第六阶段更新 renderer。将 ACP 设置和 CLI 设置收敛为 `src/renderer/src/features/agent-management/`。该 feature 调用 `ipc.agentRuntime.*`，提供 provider kind segmented control、profile list、probe action、credential editor、Codex App Server local probe、OpenAI-compatible Base URL/API key form。New Session Launcher 改为读取统一 profile list，根据 provider kind 决定进入 Chat UI 或 TUI view。所有 Tailwind class 必须静态定义，使用 `cn()` 合并条件 class。

第七阶段删除旧入口并更新文档。移除或重写 `src/main/services/acp.ts` 与 `src/main/services/cli.ts` 的独立 CRUD 语义。如果 ACP installer registry 仍需要保留，它应成为 `acp-chat` provider 的一个 helper，而不是顶层服务。更新 `src/main/services/README.md`、`src/main/lib/README.md`、新增目录 README、修改所有 touched `.ts` / `.tsx` 的三行 header comment。

## Concrete Steps

所有命令默认在仓库根目录 `/Users/wibus/dev/Cradle` 执行。执行者应在每个 milestone 后更新本 ExecPlan 的 `Progress`、`Surprises & Discoveries`、`Decision Log` 和 `Outcomes & Retrospective`。

1. 读取当前相关代码，确认没有用户未提交的目标文件冲突：

       git status --short
       rg -n "acpAgents|cliAgents|recoverableAcpSessionId|AcpConnectionManager|CliService|AcpService" src

   预期会看到当前旧表、旧服务和 ChatEngine 的 ACP 直接依赖。

2. 创建 agent runtime 目录和基础类型：

       mkdir -p src/main/agent-runtime/providers

   新增 `src/main/agent-runtime/types.ts`、`provider-catalog.ts`、`agent-runtime-service.ts`、`credential-vault.ts`、`managed-process-supervisor.ts`、`runtime-audit.ts`、`README.md`。不要用 ad-hoc 字符串在各处判断 provider，统一使用 `ProviderKind` union type。

3. 修改 `src/main/db/schema.ts`。删除旧 `acpAgents` 与 `cliAgents` 表定义，新增：

       agentProfiles
       agentCredentials
       runtimeSessions
       runtimeAuditLog

   修改 `sessions` 表，让它保存：

       agentProfileId
       providerKind
       providerSessionId
       providerStateSnapshot

   删除或停止使用 `recoverableAcpSessionId`。

4. 生成 Drizzle 迁移：

       pnpm exec drizzle-kit generate

   预期在 `drizzle/` 下生成下一条 migration，例如 `0007_*.sql`，并更新 `drizzle/meta/`。如果生成结果试图保留旧表兼容，手动检查并改成明确 drop / create 路径。因为本计划允许清空开发数据，迁移不需要保留旧 rows。

5. 注册新的 IPC service。新增 `src/main/services/agent-runtime.ts`，在 `src/main/index.ts` 注册它，并在 `src/main/ipc-types.ts` 导出类型。服务方法至少包括：

       listProfiles
       getProfile
       upsertProfile
       removeProfile
       probeProfile
       listModels
       createRuntimeSession
       sendTurn
       cancelTurn
       getRuntimeStatus
       saveCredential
       removeCredential

6. 实现 `AcpChatProvider`。它可以复用 `src/main/lib/acp-connection.ts` 的大部分代码，但上层调用必须经过 provider catalog。修改 `src/main/lib/chat-engine.ts`，使它根据 session 的 `agentProfileId` 获取 chat-capable provider。新增或更新 tests，覆盖 `ChatEngine` 不再直接依赖 ACP singleton。

7. 实现 `CliTuiProvider`。它负责从 `AgentProfile.configJson` 读取 executable、args 和 env，调用现有 PTY manager。删除 renderer 对 `ipc.cli.*` 的新路径依赖，改用 `ipc.agentRuntime.*`。

8. 实现 `JsonLineRpcConnection` 和 `CodexAppServerProvider`。连接层必须支持 request id、pending request map、notification subscription、timeout、process exit failure。provider 必须执行：

       initialize
       initialized
       model/list
       thread/start
       turn/start
       turn/interrupt

   如果本机没有 `codex`，`probeProfile` 应返回结构化失败，而不是抛出未分类错误。

9. 实现 `OpenAICompatibleProvider`。读取 encrypted API key，使用 configured Base URL 和 model 发起 streaming request。把 provider request lifecycle 写入 runtime audit。

10. 更新 renderer 设置界面。创建或迁移到 `src/renderer/src/features/agent-management/`，把 ACP 和 CLI 管理收敛为统一 profile UI。保留 provider-specific panel，但共享 profile list、enabled toggle、probe button、delete action 和 status badge。

11. 更新 New Session Launcher 和 session rendering。读取统一 profile list；`acp-chat`、`codex-app-server`、`openai-compatible` 进入 Chat UI；`cli-tui` 进入 TUI view。

12. 删除旧服务暴露。`ipc.acp.*` 与 `ipc.cli.*` 可以在同一 PR 中删除，因为本计划不保留兼容。同步删除 renderer 旧 imports、旧 hooks 和旧 tests，或改写为新 service tests。

13. 更新所有 touched 目录的 README，并检查 touched `.ts` / `.tsx` 文件三行 header comment。运行：

       pnpm lint
       pnpm typecheck
       pnpm test

## Validation and Acceptance

基础验证：

运行：

       pnpm typecheck

期望 node 和 web typecheck 均通过，输出不包含 TypeScript error。

运行：

       pnpm lint

期望 ESLint 退出码为 0。若 lint 报 static Tailwind 或 header comment 问题，按 AGENTS.md 修复。

运行：

       pnpm test

期望 Vitest 全部通过。新增测试至少覆盖 provider catalog、credential vault masking、JSONL RPC dispatcher、Codex App Server provider probe failure、ACP provider adapter 和 ChatEngine provider lookup。

数据库验证：

删除开发数据库或使用新 app data 目录启动 app。运行：

       pnpm dev

期望迁移自动执行，app 能启动到首页。设置页中不应再出现独立 “ACP settings” 与 “CLI settings” 两套数据来源；应出现统一 Agent 管理入口。

ACP 验证：

在 Agent 管理页创建或安装一个 `acp-chat` profile。回到首页选择 workspace 和该 profile，发送一条 prompt。期望 Chat UI 显示流式文本、reasoning 和 tool call card 行为不倒退。Devtool 中能看到 managed process lifecycle 和 provider runtime audit。

CLI TUI 验证：

创建一个 `cli-tui` profile，例如 executable 为 `codex` 或 `claude`，args 为 JSON array。选择该 profile 创建 session。期望进入 terminal UI，PTY 能接收键盘输入，terminal title/status 仍然更新。

Codex App Server 验证：

如果本机 PATH 中存在 `codex`，创建 `codex-app-server` profile，点击 probe。期望显示 app server 可启动，model list 可读取。创建 chat session 后发送：

       Say hello from Codex App Server.

期望 Chat UI 收到 streaming response，停止按钮能触发 `turn/interrupt`。如果本机没有 `codex`，probe 应展示 “codex executable not found” 这类结构化错误，不应导致 renderer crash。

OpenAI-compatible 验证：

创建 `openai-compatible` profile，填写 Base URL、model，并保存 API key。保存后 UI 只能显示 masked credential，例如 `sk-...abcd`，renderer devtool 不应出现明文 key。发送一条 prompt 后，期望 Chat UI 收到 streaming response。失败时错误应包含 provider kind、HTTP status 和 redacted endpoint，不包含 API key。

破坏性升级验收：

搜索旧 IPC 和旧表名：

       rg -n "ipc\\.acp|ipc\\.cli|acpAgents|cliAgents|recoverableAcpSessionId" src

期望只剩迁移文件、历史文档或明确的 test fixture。如果生产代码仍引用旧服务或旧字段，该 milestone 不算完成。

## Idempotence and Recovery

本计划允许破坏性升级，但只允许破坏 Cradle 自己的本地配置数据库，不允许删除用户 workspace 内容。迁移和开发验证可以通过删除 app userData 下的 SQLite 数据库恢复到空状态；不要删除 workspace path 指向的仓库。

每个代码步骤都应是可重复运行的。`pnpm exec drizzle-kit generate` 如果生成不理想，可以先恢复 `src/main/db/schema.ts` 和 `drizzle/meta/` 再重新生成。不要手写大段 migration，除非 Drizzle 生成的 drop / create 顺序明显错误。

如果 Codex App Server provider 实现过程中发现本机 `codex` CLI 缺失，继续完成 probe failure path 和 unit tests；不要阻塞 ACP/CLI/OpenAI-compatible 的 provider layer 验收。Codex happy path 可在安装 `codex` 后补做。

如果 OpenAI-compatible endpoint 不可用，保留 provider 单元测试和 redacted error behavior；manual validation 可以使用任何兼容 OpenAI streaming API 的本地或远程 endpoint。

如果 renderer 大改导致设置页不可用，优先保留 main process provider tests 和 New Session Launcher 最小路径，再拆小 UI milestone。不要把 provider runtime 的正确性绑死在完整视觉重构上。

## Artifacts and Notes

当前 package scripts：

       pnpm lint
       pnpm typecheck
       pnpm test
       pnpm dev
       pnpm exec drizzle-kit generate

当前重要依赖：

       @agentclientprotocol/sdk
       openai
       better-sqlite3
       drizzle-orm
       electron-store
       node-pty

Codex App Server 最小 JSONL RPC connection 行为示意如下。实际代码必须使用 TypeScript 类型和 timeout，不要在生产代码里使用未类型化的 `any`：

       interface JsonLineRpcRequest {
         id: string
         method: string
         params?: unknown
       }

       interface JsonLineRpcResponse {
         id: string
         result?: unknown
         error?: {
           code: number
           message: string
           data?: unknown
         }
       }

       interface JsonLineRpcNotification {
         method: string
         params?: unknown
       }

Provider config JSON examples should stay stable:

       {
         "executable": "codex",
         "args": ["app-server"],
         "transport": "stdio",
         "defaultModel": null
       }

       {
         "baseUrl": "https://api.openai.com/v1",
         "model": "gpt-5.1-codex",
         "headers": {}
       }

## Interfaces and Dependencies

在 `src/main/agent-runtime/types.ts` 中定义以下接口和类型。具体字段可以增加，但不得删除这些核心能力：

       export type ProviderKind =
         | 'acp-chat'
         | 'cli-tui'
         | 'codex-app-server'
         | 'openai-compatible'

       export interface AgentProfile {
         id: string
         name: string
         providerKind: ProviderKind
         enabled: boolean
         configJson: string
         credentialRef: string | null
         createdAt: number
         updatedAt: number
       }

       export interface ProviderProbeResult {
         ok: boolean
         label: string
         version: string | null
         details: Record<string, unknown>
         errorText: string | null
       }

       export interface ModelDescriptor {
         id: string
         label: string
         providerKind: ProviderKind
         contextWindow: number | null
       }

       export interface RuntimeSession {
         id: string
         chatSessionId: string
         agentProfileId: string
         providerKind: ProviderKind
         providerSessionId: string | null
         providerStateSnapshot: string | null
       }

       export interface AgentProvider {
         readonly providerKind: ProviderKind
         probe(profile: AgentProfile): Promise<ProviderProbeResult>
         listModels(profile: AgentProfile): Promise<ModelDescriptor[]>
       }

       export interface ChatRuntimeProvider extends AgentProvider {
         startChatSession(input: StartChatSessionInput): Promise<RuntimeSession>
         resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession>
         streamTurn(input: StreamTurnInput): AsyncGenerator<ResponseStreamEvent, void, void>
         cancelTurn(input: CancelTurnInput): Promise<void>
       }

       export interface TerminalRuntimeProvider extends AgentProvider {
         startTerminalSession(input: StartTerminalSessionInput): Promise<TerminalSessionResult>
         stopTerminalSession(input: StopTerminalSessionInput): Promise<void>
       }

在 `src/main/agent-runtime/provider-catalog.ts` 中定义 `ProviderCatalog`。它必须提供 provider registration 和 lookup。lookup 找不到 provider 时返回 typed error，不能返回 null 后让调用方崩溃。

在 `src/main/agent-runtime/credential-vault.ts` 中定义 `CredentialVault`。它必须提供保存、读取、删除、list metadata 和 masked display label。读取明文的方法只能在 main process provider 中调用，不能暴露到 IPC。

在 `src/main/agent-runtime/managed-process-supervisor.ts` 中定义 `ManagedProcessSupervisor`。它从 `src/main/lib/acp-process-manager.ts` 提取通用逻辑，负责 process lifecycle 和 devtool event。原 `AcpProcessManager` 最终应删除或变成 ACP provider 内部薄 wrapper。

在 `src/main/services/agent-runtime.ts` 中定义 `AgentRuntimeService extends IpcService`，并把它加入 `src/main/ipc-types.ts` 的 `IpcServices`。Renderer 后续只通过 `ipc.agentRuntime` 管理 profiles、credentials、probe、models 和 runtime sessions。

Revision Note 2026-04-24: Initial ExecPlan created after Wibus confirmed this can be a destructive upgrade with no legacy ACP/CLI agent table compatibility.

Revision Note 2026-04-24 14:11 CST: Updated Progress, Surprises & Discoveries, and Decision Log after completing the first TDD cycle for provider catalog, credential vault, and JSONL RPC connection.
