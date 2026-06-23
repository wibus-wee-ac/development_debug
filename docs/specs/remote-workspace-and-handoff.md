# Remote Workspace & Session Handoff — SPEC

> Status: Draft
> Date: 2026-06-23

## 1. Overview

Cradle 支持多实例协作：两台机器各自运行完整的 Cradle（Electron + Server），通过 Relay 互相连接。用户可以把正在运行的 Session 从一台机器 Handoff 到另一台，继续在远程环境执行。

**核心原则：**
- **Workspace 不移动** — 有状态容器属于一台机器，权威源只有一个
- **Session 可移动** — 执行单元可以在实例之间流转
- **不做双向同步** — 远程访问通过 RPC 路由回 origin

## 2. Architecture

```
Machine A: Cradle (Electron + Server + Built-in Relay)
    ↕ relay (Cradle 内置 / 用户自部署)
Machine B: Cradle (Electron + Server + Built-in Relay)
```

每个 Cradle 实例包含：
- **Server** — 核心服务，已内置 Agent Runtime
- **Workspace** — 本地项目的 source of truth
- **Relay Connector** — 连接其他 Cradle 实例

没有 agentd。不需要独立 daemon。

## 3. Workspace Model

### 3.1 归属

每个 Workspace 属于创建它的 Cradle 实例。该实例是该 Workspace 的**唯一权威源**。

```
Machine A owns: Workspace X, Workspace Y
Machine B owns: Workspace Z
```

### 3.2 远程访问

当远程 Agent 需要 Workspace 状态时（比如读 settings、更新 issue），通过 Relay 调用 origin 的 Server API：

```
Machine B agent → relay → Machine A Server → 返回结果
```

- **读操作**：按需查询，不缓存
- **写操作**：路由回 origin，由 origin 处理
- **不需要新协议**：复用 Server 已有 API

### 3.3 Remote Workspace Link

当用户在 Machine A 上浏览 Machine B 的文件系统并选择一个项目目录时，建立 Link：

```
remote_workspace_links (
  workspace_id    TEXT,   -- 本地 workspace id（如果选择关联已有）
  host_id         TEXT,   -- 目标 Cradle 实例 id
  remote_path     TEXT,   -- 远程项目路径
  git_remote_url  TEXT,   -- 用于 auto-match
)
```

- 一个 Workspace 可关联多个远程实例
- `git_remote_url` 用于智能匹配：同一 repo 在不同机器上自动关联

## 4. Session Handoff

### 4.1 语义

**Move + Rebind，不是 Clone/Fork。**

```
Before:
  Session S → host = Machine A, git_state = A's worktree

After:
  Session S → host = Machine B, git_state = transferred to B's worktree
```

- Session identity 不变，host binding 改变
- 不会产生两个 Session
- 可以之后 "bring back" 到原 host

### 4.2 流程

```
1. 如果 Session 正在运行 → interrupt 当前 response
2. 打包 Git state → 传输到目标机器
3. 序列化 Conversation history → 传输到目标机器
4. 在目标机器创建/复用 worktree，应用 git state
5. 恢复 conversation，resume agent
6. Session 的 host binding 更新为目标机器
```

### 4.3 移动什么

| 移动 | 不移动 |
|------|--------|
| Git state (worktree) | Workspace settings |
| Conversation history | Issues |
| Agent execution context | Exec plans |
| | 其他 Workspace 状态 |

### 4.4 源 Worktree

Handoff 后，源机器上的 worktree **不保证立即清理**。应视为 execution artifact/cache，可能留着，也可能被 GC。

### 4.5 不会出现双活

Handoff 是原子操作：interrupt → transfer → resume。不会出现"两边同时跑同一个 Session"的状态。

## 5. Relay

### 5.1 部署模式

- **Cradle 内置** — 默认选项，开箱即用
- **用户自部署** — 高级用户可以自己部署 Relay Server

### 5.2 发现与连接

两个 Cradle 实例通过 Relay 配对：
1. Machine A 生成 pairing token
2. Machine B 用 pairing code 完成配对
3. 建立持久连接

（复用现有 Relay pairing 流程）

### 5.3 通信

Relay 承载 Cradle 实例之间的双向通信：
- Workspace 状态查询（复用 Server API）
- Agent 生命周期管理
- Session handoff 传输
- 实时事件推送

## 6. Git State

### 6.1 当前状态

Git worktree 集成尚未完成，是一个独立的待办项目。

### 6.2 目标

Handoff 时的 Git state 转移依赖 worktree：
- Machine A: 打包 worktree state
- Machine B: 创建/复用 worktree，应用 state

### 6.3 冲突处理

两台机器的 repo 可能处于不同状态（不同 commit、branch、local changes）。Worktree 机制解决这个问题，具体方案在 worktree 集成 spec 中定义。

## 7. 与 Codex 的对比

| | Codex | Cradle |
|---|---|---|
| 迁移单位 | Thread (conversation + git state) | Session (conversation + agent context) |
| Project | 无状态 repo | 有状态 Workspace |
| Handoff 语义 | move + rebind | move + rebind（一致） |
| Project 状态 | 不需要迁移 | 通过 RPC 远程访问，不迁移 |
| 双活 | 不支持 | 不支持 |
| Git 冲突 | worktree | worktree（待实现） |

## 8. 实施路径

```
Phase 1: Cradle-to-Cradle Relay
  └─ 两个 Cradle 实例通过 Relay 互相发现和连接
  └─ 复用现有 Relay pairing 流程

Phase 2: Remote Workspace Link
  └─ remote_workspace_links 表
  └─ Register 流程：browse → probe → 选/创建 workspace → 建立 link

Phase 3: Remote Agent Execution
  └─ 在远程 Cradle 实例上启动 Agent
  └─ Agent 通过 Relay 访问 origin 的 Workspace 状态

Phase 4: Session Handoff
  └─ Git state 转移（依赖 worktree 集成）
  └─ Conversation history 转移
  └─ Session host rebinding
```
