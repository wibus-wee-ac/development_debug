# Cradle CLI — Agent 可调用的 Kanban 操作接口

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. Maintained in accordance with docs/exec-plans/README.md and the PLANS.md convention.


## Purpose / Big Picture

当前 Cradle 的 Agent 被委派到 Kanban Issue 后，只能通过底层 Provider（如 Claude Code ACP）的内置能力（文件读写、终端执行）工作。Agent 无法主动操作 Kanban 数据 — 不能更新 Issue 状态、添加评论、查看其他 Issue 或标记完成。

完成此变更后：

1. Cradle 主进程启动时监听一个 **Unix domain socket**（macOS/Linux）或 **named pipe**（Windows），提供 JSON-RPC 接口
2. 一个 **`cradle` CLI** 通过该 socket 调用主进程的 Service 方法
3. Agent 在 shell 中执行 `cradle issue list`、`cradle issue update <id> --status done` 等命令即可操作 Kanban 数据
4. CLI 自动通过 `cwd` 发现当前 workspace，也支持 `cradle workspace list` 和 `cradle workspace resolve <path>` 让 Agent 自行查找

验证方式：启动 Cradle 后，在另一个终端运行 `cradle issue list` 看到当前 Issue 列表，运行 `cradle issue comment <id> "test"` 后在 Issue 面板中看到新评论。


## Progress

- [ ] (2026-04-27) Milestone 1: 主进程 Socket Server
- [ ] Milestone 2: CLI 框架 + RPC 客户端
- [ ] Milestone 3: 命令实现
- [ ] Milestone 4: 验收


## Surprises & Discoveries

（待实施时记录）


## Decision Log

- Decision: Unix domain socket 通信（macOS/Linux）、named pipe（Windows）
  Rationale: 无端口冲突，本机限定无需鉴权，性能好。socket 路径在 Electron userData 目录。
  Date: 2026-04-27

- Decision: JSON-RPC 2.0 协议，params 用位置参数数组
  Rationale: Cradle 现有 IPC 框架通过 `ipcMain.handle(channel, (event, ...args) => handler(...args))` 调用 Service 方法，参数是位置展开的。JSON-RPC params 数组直接映射为 `handler(...params)`，零适配成本，和 Electron IPC 完全一致。
  Date: 2026-04-27

- Decision: CLI 使用 Commander.js 解析命令行参数
  Rationale: 标准 Node.js CLI 库，自动 help/错误处理/子命令。手写 process.argv 不可维护。
  Date: 2026-04-27

- Decision: Socket server 只暴露白名单 Service 方法（非全部）
  Rationale: 部分 Service 方法依赖 Electron IPC context（如 `DevService.reloadRenderer()` 需要 `getIpcContext().sender`）。Socket 调用没有 Electron event 上下文，泛暴露会崩溃。白名单可控且安全。
  Date: 2026-04-27

- Decision: Workspace 自动发现 — CLI 用 `cwd` resolve + 手动 fallback
  Rationale: Agent 在项目目录工作时不知道 workspace UUID。CLI 默认发送 `workspace.resolveByPath(cwd)` 查找 workspace ID。同时保留 `--workspace <id>` 显式指定和 `workspace list` / `workspace resolve <path>` 命令供 Agent 自行发现。
  Date: 2026-04-27

- Decision: UI 实时反映 CLI 变更通过 renderer 轮询（TanStack Query refetch），不额外实现 push 通道
  Rationale: TanStack Query 已有 `refetchOnWindowFocus`。CLI 操作频率低，用户切回窗口时触发足矣。新增 push 通道复杂度高且 ROI 低。
  Date: 2026-04-27

- Decision: 不做 Agent prompt/skill 注入 — 独立后续任务
  Date: 2026-04-27


## Outcomes & Retrospective

（待完成时记录）


## Context and Orientation

### 主进程 IPC 框架

`packages/ipc/src/base.ts` 定义了 IPC 框架核心。调用链：

    Renderer: ipcRenderer.invoke("group.method", traceEnvelope, arg1, arg2, ...)
    Main: ipcMain.handle("group.method", (event, ...args) => handler(...handlerArgs))

Service 类继承 `IpcService`，方法用 `@IpcMethod()` 装饰器标记。`createServices()` 实例化所有服务并注册 channel handler，返回 `{ [groupName]: InstanceType }` 普通对象。所有方法本质是 `async (...args) → result`，参数通过位置展开。

部分 Service 方法使用 `getIpcContext()` 获取 Electron IPC 上下文（`sender: WebContents`），仅 `DevService` 使用。如果 socket 调用触发这类方法，会抛出 "IPC context is not available" 异常。因此 socket server 必须用白名单限制可调用方法。

### Kanban Service 真实方法签名

`src/main/services/kanban.ts` 中 CLI 需暴露的方法（精确签名）：

单位置参数：

    listStatuses(workspaceId: string): KanbanStatus[]
    listBoards(workspaceId?: string): KanbanBoard[]
    getIssue(id: string): KanbanIssue | undefined
    listComments(issueId: string): KanbanIssueComment[]
    deleteIssue(id: string): void
    deleteComment(id: string): void

多位置参数：

    updateIssue(id: string, patch: Partial<{...}>): KanbanIssue
    moveIssue(id: string, statusId: string | null): KanbanIssue
    delegateIssue(issueId: string, agentProfileId: string): AgentSession
    undelegateIssue(issueId: string): void

单对象参数：

    listIssues(params: { workspaceId: string, milestoneId?: string, ... }): KanbanIssue[]
    addComment(input: { issueId: string, content: string, authorKind?: string }): KanbanIssueComment
    createIssue(input: { workspaceId: string, title: string, ... }): KanbanIssue

所有模式在 JSON-RPC params 数组中都能直接表达。例如：
- `listStatuses("ws-1")` → `"params": ["ws-1"]`
- `updateIssue("issue-1", { "title": "new" })` → `"params": ["issue-1", {"title":"new"}]`
- `listIssues({ workspaceId: "ws-1" })` → `"params": [{"workspaceId":"ws-1"}]`

### Socket 文件路径

Electron `app.getPath('userData')` 返回：
- macOS: `~/Library/Application Support/Cradle`
- Linux: `~/.config/Cradle`
- Windows: `%APPDATA%/Cradle`

Socket 路径：`{userData}/cradle.sock`（macOS/Linux），`\\.\pipe\cradle-rpc`（Windows）。

CLI 作为独立 Node.js 进程无法调用 `app.getPath()`，需按 `process.platform` 硬编码路径逻辑。

### CLI 构建

`electron.vite.config.ts` 配置 main/preload/renderer 三个 target。CLI 是独立进程，不打入 Electron bundle。开发阶段用 `npx tsx src/cli/index.ts` 直接运行 TypeScript 源码，无需额外构建配置。


## Plan of Work

### Milestone 1: 主进程 Socket Server

完成后，Cradle 启动时在 userData 目录创建 `cradle.sock`，监听外部 JSON-RPC 请求并路由到 Service 方法。可用 `socat` 手动测试连通性。

新建 `src/main/lib/socket-server.ts`，导出两个函数：

`startSocketServer(services)` 做以下事情：获取 socket 路径 → 清理残留 socket 文件 → `net.createServer()` 监听 → 每个连接用 readline 按换行分隔读取 → 解析 JSON-RPC `method` 为 `groupName.methodName` → 查白名单 → 从 services 对象调用 `services[groupName][methodName](...params)` → 返回 JSON-RPC 响应。

`stopSocketServer()` 关闭 server，删除 socket 文件。

在 `src/main/index.ts` 的 `app.whenReady()` 中调用 `startSocketServer(services)`，`app.on('before-quit')` 中调用 `stopSocketServer()`。

同时检查 `src/main/services/workspace.ts` 是否有 `resolveByPath` 方法，没有则新增。

### Milestone 2: CLI 框架 + RPC 客户端

完成后，`npx tsx src/cli/index.ts workspace list` 输出 workspace 表格。

新建 `src/cli/rpc-client.ts`（socket 连接 + JSON-RPC 通信）和 `src/cli/index.ts`（Commander.js CLI 入口）。安装 `commander` 作为 devDependency。

### Milestone 3: 命令实现

在 CLI 中实现 issue/board/status 子命令。每个需要 workspace 的命令自动用 `cwd` resolve，fallback 到 `--workspace`。`cradle issue comment` 默认 `authorKind: 'agent'`。

### Milestone 4: 验收

完整命令序列测试。确认 CLI 写入的评论在 Cradle UI 中可见（切回窗口后 refetch）。


## Concrete Steps

### Milestone 1

1. 新建 `src/main/lib/socket-server.ts`

       // socket-server.ts 核心结构
       import net from 'node:net'
       import readline from 'node:readline'
       import { app } from 'electron'
       import path from 'node:path'
       import fs from 'node:fs'

       const WHITELIST = new Set([
         'kanban.listStatuses', 'kanban.listBoards', 'kanban.listIssues',
         'kanban.getIssue', 'kanban.createIssue', 'kanban.updateIssue',
         'kanban.moveIssue', 'kanban.deleteIssue', 'kanban.listComments',
         'kanban.addComment', 'kanban.deleteComment', 'kanban.delegateIssue',
         'kanban.undelegateIssue',
         'workspace.list', 'workspace.get', 'workspace.resolveByPath',
         'agent.list', 'agent.get',
       ])

2. 在 `src/main/services/workspace.ts` 确认或新增 `resolveByPath`
3. 在 `src/main/index.ts` 集成
4. 测试命令：

       echo '{"jsonrpc":"2.0","id":1,"method":"workspace.list","params":[]}' | \
         socat - UNIX-CONNECT:"$HOME/Library/Application Support/Cradle/cradle.sock"

### Milestone 2

1. `pnpm add -D commander`
2. 新建 `src/cli/rpc-client.ts`
3. 新建 `src/cli/index.ts`
4. 测试：`npx tsx src/cli/index.ts workspace list`

### Milestone 3

1. 逐一增加子命令：issue list → get → create → update → move → comment → delete
2. 增加 board list, status list
3. 每个命令实现后立即测试


## Validation and Acceptance

1. `pnpm dev` 启动 Cradle
2. `ls ~/Library/Application\ Support/Cradle/cradle.sock` 确认 socket 存在
3. 在 workspace 项目目录下：

       npx tsx src/cli/index.ts workspace list
       # → 输出 workspace 表格

       npx tsx src/cli/index.ts issue list
       # → cwd 自动 resolve，输出 Issue 列表

       npx tsx src/cli/index.ts issue comment <id> "Hello from CLI"
       # → 切回 Cradle，Issue 面板显示评论

       npx tsx src/cli/index.ts issue update <id> --priority high
       # → Issue 优先级更新

4. 关闭 Cradle → socket 文件清理
5. Cradle 未运行 → CLI 输出 "Cradle is not running"
6. `pnpm test` → 现有测试通过（21/22，2 个 pre-existing 失败）


## Idempotence and Recovery

Socket server 启动前清理残留 socket 文件，可安全重启。CLI 无状态，可重复执行。Cradle 未运行时 CLI 给出友好错误。Workspace resolve 失败时提示 `--workspace`。


## Artifacts and Notes

### JSON-RPC 消息示例

单位置参数：

    → {"jsonrpc":"2.0","id":1,"method":"kanban.listStatuses","params":["ws-123"]}
    ← {"jsonrpc":"2.0","id":1,"result":[{"id":"s1","name":"Todo",...}]}

多位置参数：

    → {"jsonrpc":"2.0","id":2,"method":"kanban.updateIssue","params":["issue-1",{"title":"new"}]}
    ← {"jsonrpc":"2.0","id":2,"result":{"id":"issue-1","title":"new",...}}

单对象参数：

    → {"jsonrpc":"2.0","id":3,"method":"kanban.addComment","params":[{"issueId":"i1","content":"hello","authorKind":"agent"}]}
    ← {"jsonrpc":"2.0","id":3,"result":{"id":"c1","content":"hello",...}}

### 白名单

    kanban: listStatuses, listBoards, listIssues, getIssue, createIssue,
            updateIssue, moveIssue, deleteIssue, listComments, addComment,
            deleteComment, delegateIssue, undelegateIssue
    workspace: list, get, resolveByPath
    agent: list, get

### Socket 路径

    macOS:   ~/Library/Application Support/Cradle/cradle.sock
    Linux:   ~/.config/Cradle/cradle.sock
    Windows: \\.\pipe\cradle-rpc


## Interfaces and Dependencies

### 新增文件

    src/main/lib/socket-server.ts    — Unix domain socket JSON-RPC server
    src/cli/index.ts                 — CLI 入口（Commander.js）
    src/cli/rpc-client.ts            — Socket 连接 + JSON-RPC 客户端

### 新增依赖

    commander (devDependency)

### socket-server.ts

    export function startSocketServer(services: Record<string, object>): net.Server
    export function stopSocketServer(): void

### rpc-client.ts

    export function getSocketPath(): string
    export async function rpcCall(method: string, params: unknown[]): Promise<unknown>

### workspace.resolveByPath（可能新增）

在 `src/main/services/workspace.ts` 中：

    @IpcMethod()
    resolveByPath(path: string): Workspace | undefined
