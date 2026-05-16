<!-- Once this directory changes, update this README.md -->

# Cradle Architecture Review

> Historical note (2026-05-16): this review reflects an earlier Electron IPC + renderer event-bridge architecture. Chat-specific references to `useChat`, `chat:response-event`, renderer-side bridges, or timeline-driven hydration should be read as historical context; the current canonical runtime is server-owned `messages.messageJson` snapshot hydration plus sequenced SSE delta events.

评估时间：2026-04-21  
评估方式：主代理静态审查 + 4 个前端 SubAgent + 1 个后端 SubAgent 并行评估  
覆盖范围：renderer 架构、feature 分层、状态与数据流、UI 系统、Electron main process、IPC、持久化、ACP 编排

## 直接结论

这个项目的总体方向是对的：它已经形成了比较清晰的 Electron 三段式边界。

- renderer 主要负责视图、壳层状态和流式呈现；
- main process 持有业务真相、进程编排和持久化；
- `packages/ipc` 把 typed RPC 和观测抽成了共享基础设施。

真正的问题不在“技术栈选错”，而在几个边界开始变形：

1. 前端 `AppLayout` 已经从纯布局层膨胀成主窗口编排中心。
2. 前端导航语义分裂成 URL 路由和 shell 内部状态两套系统。
3. `workspace` feature 吸入了过多不属于自己的子域，尤其是新建聊天和 ACP session 控制。
4. `settings/acp-settings.tsx` 已经是一个独立业务子系统，但仍被塞在单文件 section 里。
5. renderer 的事件订阅与 ACP probe 链路开始让数据 ownership 变模糊。
6. UI 系统的层次大体健康，但 bundle boundary、lazy 边界和文档纪律都还不够收口。
7. main process 分层清楚，但 preload 边界过宽、ACP host capability 几乎无约束、`ChatEngine` 责任过重。

一句话概括：这是一个“主链路已经成型，但边界开始漂移”的架构。当前最该做的不是重写，而是把已经出现的边界泄漏及时收回。

## 整体结构

### 系统分层

- `src/renderer/src/`：React renderer，负责 route、feature、view、UI shell state。
- `src/main/`：Electron main process，负责 IPC service、chat/agent 编排、SQLite、系统能力。
- `src/preload/`：renderer 与 Electron API 之间的桥。
- `packages/ipc/`：typed IPC proxy、handler 注册、trace envelope、观测事件。
- `src/shared/`：跨 renderer/main 共享的稳定语义层，目前代表性模块是 chat preferences。

### 当前总体 Flow

```text
Renderer UI
  -> Router / Features / Query / Zustand
  -> IPC Proxy (packages/ipc client)
  -> Preload Bridge
  -> IPC Main Handler (packages/ipc base)
  -> Main Services
  -> Main Lib Orchestration
  -> SQLite / Electron Store / ACP Processes

Push Path
  Main Lib
  -> webContents.send("chat:*" / "ipc-devtool:*" / "acp-devtool:*")
  -> Renderer Event Consumers
  -> AI SDK useChat / unread state / devtool state
```

### 聊天主链路

```text
Home Route (/)
  -> NewChatHome
  -> select workspace + agent + model
  -> createAndSend()
  -> navigate("/chat/$sessionId")

Chat Route (/chat/$sessionId)
  -> route loader: session + messages
  -> ChatView
  -> useChatSession
  -> ipc.chat.send / ipc.chat.abort
  -> ChatEngine
  -> AcpConnectionManager.prompt()
  -> stream events
  -> webContents.send("chat:response-event")
  -> ipc-chat-transport
  -> AI SDK useChat
```

## 关键发现

### P0 / High

- `AppLayout` 直接依赖 `WorkspaceSidebar`、`SettingsSidebar`、`SettingsContent`，已经不是纯布局层，而是主窗口编排器。[src/renderer/src/components/layout/app-layout.tsx](/Users/wibus/dev/Cradle/src/renderer/src/components/layout/app-layout.tsx:1)
- 设置页不是显式 route，而是 shell 内部状态切换。这让导航语义、深链接、刷新恢复、历史记录无法统一。[src/renderer/src/store/sidebar-nav.ts](/Users/wibus/dev/Cradle/src/renderer/src/store/sidebar-nav.ts:1)
- `workspace/new-chat-home.tsx` 混合了 workspace 选择、ACP probe、chat preferences hydration、首次发送、导航跳转和 toolbar 视图，是当前最明显的边界泄漏点。[src/renderer/src/features/workspace/new-chat-home.tsx](/Users/wibus/dev/Cradle/src/renderer/src/features/workspace/new-chat-home.tsx:1)
- ACP session / agent hooks 被放在 `workspace` 下，领域命名已经失真，后续会继续扩大错误边界。[src/renderer/src/features/workspace/use-acp-agents.ts](/Users/wibus/dev/Cradle/src/renderer/src/features/workspace/use-acp-agents.ts:1)
- `settings/acp-settings.tsx` 本质是一个 ACP management feature，但被压成 settings 里的单个 section 文件，已经出现 feature-in-a-file 问题。[src/renderer/src/features/settings/acp-settings.tsx](/Users/wibus/dev/Cradle/src/renderer/src/features/settings/acp-settings.tsx:1)
- preload 直接暴露 `window.electron`，同时窗口配置仍是 `sandbox: false`；typed IPC 只是约定，不是强封装。[src/preload/index.ts](/Users/wibus/dev/Cradle/src/preload/index.ts:1) [src/main/index.ts](/Users/wibus/dev/Cradle/src/main/index.ts:1)
- ACP host capability 目前几乎没有安全边界，`requestPermission()` 默认放行第一项，文件读写直接按 agent 给出的路径执行。[src/main/lib/acp/acp-connection.ts](/Users/wibus/dev/Cradle/src/main/lib/acp/acp-connection.ts:1)
- `ChatEngine` 是明确的 God Object，横跨恢复、编排、持久化、stream 组装、广播和错误塑形。[src/main/lib/chat/chat-engine.ts](/Users/wibus/dev/Cradle/src/main/lib/chat/chat-engine.ts:1)

### P1 / Medium

- renderer 中 `chat:response-event` 被多处直接订阅，没有统一 event bridge，开始出现 `client-event-listeners` 类型的扩散风险。[src/renderer/src/components/layout/app-layout.tsx](/Users/wibus/dev/Cradle/src/renderer/src/components/layout/app-layout.tsx:1) [src/renderer/src/features/chat/use-chat-session.ts](/Users/wibus/dev/Cradle/src/renderer/src/features/chat/use-chat-session.ts:1) [src/renderer/src/features/chat/ipc-chat-transport.ts](/Users/wibus/dev/Cradle/src/renderer/src/features/chat/ipc-chat-transport.ts:1)
- `useAcpSessionState` 同时承担 query + mutation，但 mutation 不是 `mutateAsync`，导致调用侧难以保证“远端成功后再持久化偏好”。[src/renderer/src/features/workspace/use-acp-session-state.ts](/Users/wibus/dev/Cradle/src/renderer/src/features/workspace/use-acp-session-state.ts:1)
- probe session 生命周期只依赖 `agentId`，但其 `cwd` 源自 workspace，存在 stale dependency 风险。[src/renderer/src/features/workspace/new-chat-home.tsx](/Users/wibus/dev/Cradle/src/renderer/src/features/workspace/new-chat-home.tsx:1)
- `/devtool` 虽然是第二窗口，但大概率仍共用主 renderer bundle 边界，没有真正独立切开。[src/renderer/src/routeTree.gen.ts](/Users/wibus/dev/Cradle/src/renderer/src/routeTree.gen.ts:1) [src/main/lib/devtools/ipc-devtool.ts](/Users/wibus/dev/Cradle/src/main/lib/devtools/ipc-devtool.ts:1)
- `ipc-devtool` 实际上包含 IPC mode 和 ACP mode 两个并列子域，但目录名、README 与实际内容不一致。[src/renderer/src/features/ipc-devtool/README.md](/Users/wibus/dev/Cradle/src/renderer/src/features/ipc-devtool/README.md:1)
- `ThreadSearchEngine` 仍是全量扫描型实现，消息历史增长后会挤占 Electron main thread。[src/main/lib/chat/thread-search.ts](/Users/wibus/dev/Cradle/src/main/lib/chat/thread-search.ts:1)
- session 配置写入存在双写者：renderer 通过 `session.updateConfig()` 写，`ChatEngine` 在恢复/建 session 时也写，状态归属不够清晰。[src/main/services/session.ts](/Users/wibus/dev/Cradle/src/main/services/session.ts:1) [src/main/lib/chat/chat-engine.ts](/Users/wibus/dev/Cradle/src/main/lib/chat/chat-engine.ts:1)

### P2 / Low-Medium

- `router.tsx` 与 `main.tsx` 同时定义 router，已经形成 single source of truth 漂移。[src/renderer/src/router.tsx](/Users/wibus/dev/Cradle/src/renderer/src/router.tsx:1)
- UI 层存在 barrel/deep import 混用，public surface 设计还不稳定。[src/renderer/src/features/chat/index.ts](/Users/wibus/dev/Cradle/src/renderer/src/features/chat/index.ts:1)
- `styles.css` 把 `streamdown/styles.css` 全局引入，会让 chat-only markdown/code 样式泄漏到整个 renderer。[src/renderer/src/styles.css](/Users/wibus/dev/Cradle/src/renderer/src/styles.css:1)
- `styles.css` 中 `html` 同时应用 `font-sans` 和 `font-mono`，全局字体策略大概率不正确。[src/renderer/src/styles.css](/Users/wibus/dev/Cradle/src/renderer/src/styles.css:1)
- 多处目录 README 与实际实现不一致，关键入口文件也缺少仓库要求的 header comment，文档纪律已经出现漂移。

## 前端评估

### 1. 路由、页面流与壳层

当前 renderer 的 URL 路由非常简单：`/`、`/chat/$sessionId`、`/devtool` 三个入口。优点是心智负担低，聊天页 loader 也做了 `Promise.all(session, messages)` 这一类正确的 anti-waterfall 处理。

问题在于，真正的导航语义并不全在 router 里，而是分裂成两层：

- URL 层：首页、聊天页、devtool 页；
- Shell 状态层：`main/settings` 视图切换、settings section drill-in、搜索弹窗开关。

这会导致：

- settings 没有深链接；
- 刷新和历史记录无法恢复 settings section；
- route-level pending/error/preload 体系无法覆盖 settings flow；
- `AppLayout` 被迫承接业务编排而非纯布局。

结论：当前问题的核心不是“route 太少”，而是“route 与 shell state 各自承担了一半导航职责”。

### 2. 状态与数据流

当前 renderer 的大方向是健康的：

- domain truth 仍在 main process；
- React Query 负责快照型数据；
- AI SDK `useChat` 独立承担流式消息状态机；
- Zustand 主要只存 UI shell state。

这是正确的分层。真正开始变形的是控制面链路：

- ACP probe session 生命周期在 `NewChatHome` 中以组件 effect 形式编排；
- `useAcpSessionState` 的 query/mutation ergonomic 不足；
- `chat:response-event` 被三处直接监听；
- `workspaceName` 仍在 route 内用 effect 单独取。

这些都说明 renderer 里的“数据获取边界”大体正确，但“控制面编排边界”已经开始扩散。

### 3. Feature 模块结构

当前五个 feature 的成熟度差异很大：

- `search` 是最接近理想形状的 feature：查询、normalize、group、view、test 全在边界内闭合。
- `chat` 次之，已经形成 `transport + hook + view` 的成熟结构。
- `workspace` 已经超出 workspace 管理，开始吸纳新建聊天、ACP probe、全局搜索入口和 app shell 顶层导航。
- `settings` 外壳稳定，但 `acp-settings.tsx` 本质上是独立 feature。
- `ipc-devtool` 实际是两个子域，却被错误地描述成一个 feature。

结论：前端边界最该收的地方不是 `chat`，而是 `workspace`、`settings/acp-settings`、`ipc-devtool`。

### 4. UI 系统、样式策略与性能

UI 系统的底子不错：

- `components/ui` 基于 `@base-ui/react` 做统一皮肤封装；
- Tailwind class 大体是静态定义；
- `cn()` 使用一致；
- `ChatView` 虚拟化、`MessageBubble` 的渲染控制、局部状态拆分都体现了正确的 rerender 意识。

但仍有四类问题：

1. `AppLayout` 壳层过重，层次边界受损。
2. chat-only 的重型渲染能力没有明确 lazy 边界，bundle hygiene 不够好。
3. `components/ui` 与 `components/layout` 的文档纪律、header comment 约束没有持续执行。
4. sidebar/session tree 等列表还没有针对大规模数据量做更进一步的渲染边界控制。

## 后端评估

### 1. 当前主进程架构

main process 已经形成了一套比较清晰的结构：

- `src/main/index.ts`：bootstrap / composition root；
- `src/main/services/`：IPC façade；
- `src/main/lib/`：应用编排、系统适配、进程管理；
- `src/main/db/`：SQLite schema；
- `src/main/store/`：`electron-store` 中的偏好与窗口状态；
- `packages/ipc/`：typed IPC 与 trace/observer。

这里最大的优点是：service 层总体保持薄，复杂性主要下沉到 lib，而 typed IPC 和观测设施被集中在共享包中。

### 2. 真正的后端核心

后端的真实核心是三块：

- `ChatEngine`：turn 生命周期、恢复、广播、事务性落库；
- `AcpConnectionManager`：ACP transport、session cache、prompt streaming；
- `AcpProcessManager`：agent 进程生命周期与 devtool 事件源。

这三块共同构成了“Electron main process 里的应用后端”。

其中最强的设计点是会话连续性：

- `recoverableAcpSessionId`
- `resume`
- `load`
- `reset`

这个多级回退链路说明系统已经开始认真处理 crash recovery 和 runtime continuity，而不是把 ACP session 当作一次性连接。

### 3. 主要问题

最值得优先处理的三个问题如下：

#### preload 边界过宽

当前 preload 暴露 `window.electron`，而不是白名单桥。这样 renderer 既能走 typed IPC，也能直接拿到底层 IPC renderer API，边界无法真正收紧。

#### ACP host capability 缺乏 broker

从架构上看，这个问题比普通“权限弹窗缺失”更严重：agent 发起的文件系统能力几乎没有被 workspace-root allowlist、显式 policy 或 audit broker 约束。

#### `ChatEngine` 责任过重

`ChatEngine` 现在同时承担：

- crash recovery
- session continuity
- provider bootstrap
- preference replay
- DB transaction
- streaming assembly
- IPC broadcast
- error shaping

这不是简单的“大文件”，而是未来演进的真实瓶颈。

## 文件结构与职责判断

### 当前最健康的区域

- `packages/ipc/`
- `src/renderer/src/features/search/`
- `src/renderer/src/features/chat/` 的核心 transport/session 部分
- `src/main/db/`
- `src/shared/chat-preferences.ts`

### 当前最需要重构或重命名的区域

- `src/renderer/src/components/layout/app-layout.tsx`
- `src/renderer/src/features/workspace/new-chat-home.tsx`
- `src/renderer/src/features/workspace/use-acp-agents.ts`
- `src/renderer/src/features/workspace/use-acp-session-state.ts`
- `src/renderer/src/features/settings/acp-settings.tsx`
- `src/renderer/src/features/ipc-devtool/`
- `src/main/lib/chat/chat-engine.ts`
- `src/preload/index.ts`

### 建议中的更诚实结构

```text
src/renderer/src/features
  chat/
    transport/
    session/
    ui/
  search/
  workspace/
    data/
    navigation/
  new-chat/
    launcher/
    preferences/
    probe-session/
  agent-runtime/
    session/
    model-picker/
    config/
  acp-management/
    registry/
    install/
    audit/
  devtool/
    ipc/
    acp/

src/main/lib
  chat/
    session-coordinator/
    turn-repository/
    stream-bridge/
  acp/
    connection/
    process-manager/
    installer/
    registry/
  search/
  storage/
```

## 推荐整改顺序

### Phase 1

- 把 `AppLayout` 收回为纯 shell，新增 `MainWindowShell` 承接业务编排。
- 把 settings 提升为显式 route，至少做到 `/settings` 或 `/settings/$section`。
- 删除或统一 `router.tsx` 与 `main.tsx` 的双 router 定义。
- 给 renderer 建统一 `chatEvents` bridge，收敛 `chat:response-event` 订阅点。

### Phase 2

- 把 `NewChatHome` 从 `workspace` 拆到独立子域，例如 `new-chat/` 或 `chat-launcher/`。
- 把 `useAcpSessionState`、`useInstalledAcpAgents`、`ModelPicker` 等迁到独立 `agent-runtime/` 子域。
- 将 `settings/acp-settings.tsx` 拆成目录，必要时直接升格为 `acp-management/` feature。
- 重组 `ipc-devtool` 为 `devtool/ipc/*` 与 `devtool/acp/*`。

### Phase 3

- preload 改为显式白名单 API，逐步收回 `window.electron`。
- 为 ACP host capability 引入 broker、workspace allowlist 和 audit 约束。
- 拆分 `ChatEngine` 为 façade + coordinator + repository + stream bridge。
- 把 push channel 也纳入 shared IPC contract，避免 main/renderer 双方各自维护 payload 形状。

### Phase 4

- 处理 bundle boundary：让 `/devtool` 和 chat-heavy 渲染能力有真实 lazy 边界。
- 优化 `ThreadSearchEngine`，逐步转向索引或 SQLite FTS。
- 补齐 `README.md` 与 header comment 纪律，让目录文档重新反映实现事实。

## ASCII 架构图

### Frontend

```text
Renderer Entry
  -> QueryClientProvider
  -> RouterProvider
  -> Root Route
     -> MainWindowShell
        -> AppLayout (should become pure shell)
           -> App Sidebar
           -> Header
           -> Main Content
           -> Aside Slot
           -> Bottom Panel Slot

Routes
  "/"                 -> New Chat Launcher
  "/chat/$sessionId"  -> Chat Page
  "/settings/$section" (recommended)
  "/devtool"          -> Devtool Window

State
  Query   -> persisted snapshots
  AI SDK  -> in-flight chat stream
  Zustand -> shell-only state
```

### Backend

```text
Renderer
  -> Typed IPC Proxy
  -> Preload Bridge
  -> IPC Main Handler
  -> Services
  -> Lib
     -> ChatEngine
     -> AcpConnectionManager
     -> AcpProcessManager
     -> ThreadSearchEngine
  -> Persistence
     -> SQLite
     -> Electron Store
  -> Push Events
     -> chat:*
     -> ipc-devtool:*
     -> acp-devtool:*
```

### End-to-End Request Flow

```text
User Action
  -> Route / Feature Component
  -> Query Hook or Chat Transport
  -> IPC Invoke
  -> Main Service
  -> Lib Orchestration
  -> DB / ACP Process / Native API
  -> Result or Stream Event
  -> Renderer Reconciliation
  -> UI Update
```

## 最后的判断

如果只给一个总体判断：

- 这个项目已经有一条相当像样的聊天主链路；
- 也已经有不错的 renderer/main 分工意识；
- 但如果再继续沿着现在的方式加功能，最先失控的一定不是底层 IPC，而是前端 feature 边界和 main process 编排中心。

因此接下来最值钱的工作不是“再加一层抽象”，而是把已经明显越界的几个模块收回到诚实的职责边界里。
