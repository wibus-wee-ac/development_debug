⏺ Cradle — Product Spec (v2)

更新日期：2026-04-22

## 一句话定位

给独立开发者用的「Agent Runtime Studio」：在一个本地桌面应用里，启动、对话、运行并观测你的 AI 工具（ACP Chat 与 CLI TUI），并让每一次执行都可回放、可追溯、可收口。

## 产品重新定义（相对 v1 的变化）

v1 把 Cradle 主要定义为“指挥台”：你分派任务给不同 agent，通过 Chat UI 接收执行结果。

现在的 Cradle 已经更像一个“运行时 + 控制面 + 观测面”的统一体：

- 运行时：同一个系统里同时承载两种交互范式
  - **ACP**：结构化的流式对话（text / reasoning / tool calls / usage / plan）
  - **CLI TUI**：原生终端交互（PTY + xterm.js），不强行塞进 message model
- 控制面：workspace、agent、session 的生命周期与持久化由 Cradle 统一管理
- 观测面：内建 IPC / ACP / PTY 的事件流与快照能力，支持在 devtool window 中回放与定位问题

因此，Cradle 的核心不再只是“聊天框里跑 agent”，而是“把 agent 当作一等公民的运行环境”。

## 目标用户

- 独立开发者 / 小团队里的 Tech Lead：需要把“写代码”升级为“编排与收口”
- 使用多个 AI 工具链的人：既包含 ACP 兼容 agent，也包含 Claude Code / Codex CLI 这种终端工具
- 需要可追溯与可回放的人：想知道每一步做了什么、为什么、花了多久、失败在哪里

## 核心承诺

1. **Local-first**：所有 workspace、session、消息与运行记录都在本机，支持断电/崩溃后的恢复与续跑。
2. **Provider-driven UI**：UI 不是“只有一种聊天形态”，而是由 agent 的 provider kind 决定渲染模式。
3. **Context is first-class**：repo 文件、路径、分支信息与选择的 agent/model 是对话的显式上下文，而不是隐式约定。
4. **Observability by default**：默认就能看到 IPC 调用链、耗时、错误与 ACP/PTY 事件，不靠临时加 log。
5. **Boundary discipline**：main process 拥有业务真相与系统能力；renderer 专注呈现与交互；typed IPC 是契约而不是“最好如此”。

## 核心概念（对象模型）

- **Workspace**：一个本地 repo（路径 + 元信息）作为工作单元与能力边界。
- **Agent**：可运行的执行体定义（ACP agent 或 CLI TUI 工具），包括启动方式、provider kind、默认参数等。
- **Provider Kind**：
  - `acp`：以 ACP 协议对话与流式输出
  - `cli-tui`：以 PTY 启动终端程序并原样渲染
- **Session**：围绕一个 workspace + agent 的连续交互上下文，具备持久化与恢复语义。
- **Message / Part**（ACP）：消息以 parts 表达，支持 text、reasoning、tool invocation、sources、files 等结构化片段。
- **Tool Call**（ACP）：可观测的工具调用生命周期（start/update/done），与 UI 的状态卡片对应。
- **Runtime Event**：用于观测的事件流（IPC traces、ACP session updates、PTY data/title changes），支持快照与订阅。
- **Audit Log**：对敏感能力的调用记录（为后续 capability broker 与 allowlist 做铺垫）。

## 关键用户路径（主链路）

### 1) 从零到第一次可用（Onboarding）

- 添加 workspace（选择本地 repo）
- 安装/注册 agent（ACP 或 CLI TUI）
- 在 Home 发起新 session（选择 workspace + agent + model/params）
- 进入 session 页面开始交互

### 2) ACP Chat Session（结构化对话）

- 用户发送 prompt
- main process 负责会话编排、持久化与流式广播
- renderer 以结构化 parts 渲染：
  - 流式文本（Markdown/code）
  - reasoning（可折叠）
  - tool call cards（状态与详情）
- 输入侧支持工作区文件引用（例如 @ 提及文件作为上下文）

### 3) CLI TUI Session（终端原生体验）

- 用户选择 `cli-tui` agent
- main process 创建 PTY 并启动进程
- renderer 用 xterm.js 渲染 ANSI TUI
- 用户直接键入终端，title 与状态由终端自身驱动

### 4) Debug 与回放（Observability）

- 打开 devtool window
- 查看 IPC 调用的时间线、参数摘要、结果/错误、调用栈与 trace 关系
- 查看 ACP 事件与 PTY 事件流，定位卡顿、重复订阅或边界泄漏

### 5) 召回与检索（Recall）

- 全局搜索历史 thread/session
- 以“对话记录 + 工具调用 + 关键文件上下文”组合检索，而不是只搜纯文本

## 信息架构（IA）

当前的核心形态应该保持“少入口、强主链路”：

- `/`：New Session Launcher（选择 workspace / agent / model）
- `/chat/$sessionId`：Session Page（按 provider kind 渲染 Chat 或 TUI）
- `/settings/...`：设置与管理（安装 agent、偏好、权限策略等）
- `/devtool`：运行时观测面板（IPC / ACP / PTY）

## 功能范围

### 已经成立的能力（As-is）

- Workspace：本地 repo 管理与切换
- Session：创建、加载、持久化与恢复
- ACP Chat：流式对话、结构化 parts、tool call 生命周期渲染
- CLI TUI：PTY 承载 + xterm.js 终端渲染
- Devtool：IPC 可观测事件流（以及 ACP/PTY 事件订阅的基础）
- Search：跨 session/thread 的检索入口

### 近期演进（Next）

- 导航语义收口：settings 进入显式 route，并统一 router 与 shell state 的职责
- 事件桥收敛：为 `chat:*` / `pty:*` / `acp:*` 建统一的 renderer-side event bridge，避免订阅点扩散
- 安全边界：引入 capability broker（workspace root allowlist + explicit policy + audit），逐步收回 preload 面
- 收口节点：diff / test / PR 作为“关键决策点”的产品化 UI（而不是散落在输出里）
- Bundle hygiene：把 devtool 与 chat-heavy 视图做真实 lazy boundary

### 明确不做（Non-goals）

- 不替代 IDE：Cradle 不提供完整代码编辑器，编辑行为应跳转到 IDE
- 不做云同步：默认不把数据上传到云端
- 不做多人协作：不解决团队共享与权限体系（先把个人生产力链路做扎实）
- 不强行统一交互范式：CLI TUI 工具不改造成 chat message model
- 不自建模型能力：只做 agent runtime 与编排，不做模型训练/托管

## 技术与架构约束（产品级约束）

- main process 是业务真相与系统能力边界：DB、进程、ACP/PTY 编排、权限与审计都应驻留在 main
- renderer 只做呈现、交互与轻量 UI state：避免把生命周期编排写进组件 effect
- IPC 必须 typed、可观测、可演进：既是功能通路，也是产品可调试性的基础设施
- 持久化以 SQLite 为核心：消息 parts、元信息、审计与索引能力应可逐步演进

## 质量指标（如何判断我们做对了）

- 首次可用时间：从安装到第一次拿到 agent 的有效响应（ACP 或 CLI）
- 会话连续性：崩溃/重启后，session 能恢复并继续（尤其是 ACP recoverable session）
- 可追溯性：一个“为什么失败/为什么慢”的问题，能在 devtool 中被定位到具体 IPC/ACP/PTY 事件与调用点
- 收口效率：从“agent 自主执行”到“人审查决策”之间的路径清晰且低摩擦

## 主要风险与对策（产品层面）

- 安全边界不足：ACP host capability 需要显式 broker 与 allowlist，避免默认放行导致的数据风险
- 边界漂移：renderer 的 feature 与 shell 容易再次膨胀，需要持续用 route、feature ownership 与事件桥来约束
- 性能与体积：stream rendering、devtool 事件流、终端渲染都可能推高资源消耗，需要 lazy boundary 与节流策略

## 附：系统主链路示意（简化）

```text
User
  -> Renderer UI (Routes / Features)
  -> Typed IPC Proxy
  -> Preload Bridge
  -> IPC Main Handler
  -> Main Services
  -> Orchestration (ChatEngine / AcpConnectionManager / PtyManager)
  -> SQLite / PTY / ACP Process

Push Events
  Main -> webContents.send("chat:*" / "ipc-devtool:*" / "acp-devtool:*" / "pty:*")
  Renderer -> Event Bridge -> UI
```

