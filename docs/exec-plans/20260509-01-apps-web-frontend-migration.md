# ExecPlan: Migrate Renderer to `apps/web` — Full Frontend/Backend Separation

> Historical note (2026-05-16): this migration plan includes an older chat transport transition narrative. The current canonical chat runtime uses `GET /chat/sessions/:sessionId/messages` for snapshot hydration and sequenced SSE delta events (`message_delta`, `subagent_message_delta`, `run_*`) for live updates.

**Date**: 2026-05-09  
**Author**: Lead Agent  
**Status**: ✅ COMPLETE (2026-05-09)

---

## Completion Summary (2026-05-09)

All 6 phases implemented and verified:

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0: CORS on apps/server | ✅ Done | `hono/cors` middleware, origin `*` |
| Phase 1: apps/web scaffold | ✅ Done | Vite + React 19 + TS, port 5174 |
| Phase 2: OpenAPI client gen | ✅ Done | `@hey-api/openapi-ts` 0.97, `pnpm generate` works |
| Phase 3: Renderer code migrated | ✅ Done | 238 files, all `@renderer/` → `~/`, `pnpm typecheck` passes |
| Phase 4: SSE chat + PTY transport | ✅ Done | `sse-chat-transport.ts`, `sse-pty-connector.ts` |
| Phase 5: Electron-native replacements | ✅ Done | `directory-picker.ts` (prompt-based), `window.open` for external links |
| Phase 6: Build workflow | ✅ Done | `pnpm build` passes (79 modules, 68kB gzip), root scripts added |

Root `package.json` new scripts:
```
dev:web, dev:server, dev:fullstack (concurrently), build:web, generate:web
```

Port convention: **server = 21423**, **web = 5174**

---

## Background

`apps/server` 现在已经完整运行，所有核心 capability module 都在跑（workspace / session / chat-runtime / skills / git / acp / kanban / pty 等），OpenAPI spec 在 `/openapi.json` 暴露，SSE streaming 已经在 chat 和 PTY 上工作。

下一步：把 `src/renderer/src` 中的 React 前端迁移出 Electron，独立成 `apps/web`，直接打 `apps/server` 的 HTTP API，彻底前后端分离。Electron 先搁置，等架构稳定后再用 Electron 包裹 `apps/web`。

---

## Goals

1. 新建 `apps/web` — 独立的 Vite + React web app
2. 用 `@hey-api/openapi-ts` 从 `apps/server` 的 OpenAPI spec 生成类型安全的 API client + React Query hooks
3. 把 `src/renderer/src` 的 feature 代码搬过来，替换 `ipc.xxx()` 为生成的 API client
4. 实时事件（chat timeline、PTY output）切换为 SSE；其他事件推送若需要则加 WebSocket
5. Electron-native 功能（`selectDirectory`）改为 `<input type="file" webkitdirectory>`
6. `apps/server` 加上 CORS 配置，支持本地 web 开发

---

## Current State Analysis

### apps/server 已有的 API 端点

- `POST /chat/sessions/:sessionId/response` — 创建 chat run 并直接返回 SSE
- `GET /chat/sessions/:sessionId/messages` — 获取 message snapshot rows
- `POST /chat/sessions/:sessionId/cancel` — 中止当前 run
- `GET /pty/:sessionId/stream` — **SSE** stream（`text/event-stream`）
- `GET /openapi.json` — OpenAPI 3.1 spec
- `GET /docs` — Scalar API reference

### src/renderer 当前的 IPC 依赖

- **通信层**: `window.electron.ipcRenderer` → `createIpcProxy` → `ipc.xxx()`
- **实时事件**: chat 用 SSE delta，其他通道仍可经 Electron IPC push / `subscribe()` 订阅
- **类型推导**: `typeof window.ipc.xxx` → 后续换成从 Hono / OpenAPI 生成的类型

### 需要特殊处理的 Electron-native 功能

| 功能 | 当前 IPC 方法 | Web 替代方案 |
|------|-------------|------------|
| 文件夹选择 | `ipc.workspace.selectDirectory()` | `<input type="file" webkitdirectory>` + File System Access API |
| 文件读写 | `ipc.workspace.readTextFile/writeTextFile` | `GET/PUT /workspaces/:id/files/:path` — server 端实现 |
| 外部链接 | `shell.openExternal()` | `window.open(url, '_blank')` |

---

## Architecture Decision

### 实时事件传输方式

| 事件类型 | 当前机制 | 迁移后机制 |
|---------|--------|----------|
| Chat runtime | Electron IPC push | **SSE** — `POST /chat/sessions/:sessionId/response` 直接返回 stream |
| PTY output | Electron IPC push | **SSE** — `GET /pty/:sessionId/stream`（已有） |
| Agent context events | Electron IPC push | 加 polling 或 SSE 端点（Phase 4 决定） |
| Observability events | Electron IPC push | 加 polling（低频，可接受） |
| ACP 安装进度 | Electron IPC push | 加 SSE 端点（Phase 4 决定） |

> **注意**: 用户提到 WebSocket，但 chat/PTY 已经是 SSE 且单向即可。只有需要双向通信的场景才需要 WebSocket。先用 SSE，如果后续发现需要 WebSocket 再切换。

### API Client 生成方案

使用 `@hey-api/openapi-ts`，配置如下：

```ts
// apps/web/openapi-ts.config.ts
import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: 'http://localhost:3000/openapi.json',  // 运行时从 server 拉
  output: {
    path: './src/api-gen',
    clean: true,
    preferExportAll: true,
  },
  plugins: [
    {
      name: '@hey-api/client-ofetch',
      runtimeConfigPath: '@/lib/client.config',
      exportFromIndex: true,
    },
    { name: '@tanstack/react-query' },
    { name: 'zod', responses: false },
    { name: '@hey-api/sdk', validator: true },
  ],
})
```

- HTTP 层用 **`ofetch`**（而不是原生 fetch）
- React Query plugin → 自动生成 `useQuery` / `useMutation` hooks
- zod plugin → 请求参数验证
- 生成产物放到 `apps/web/src/api-gen/` 下（gitignore，每次 `pnpm generate` 重新 gen）
- 需要 server 在运行时才能 gen（`pnpm dev` server 先，再 gen）

### Chat Transport 重写

现有的 `ipc-chat-transport.ts` 订阅 Electron IPC `chat:timeline-event` push。迁移后：

```
旧: POST → ipc.chat.send() → 等待 IPC push 事件
新: POST /chat/sessions/:id/response → 直接消费 SSE
  → 解析 `message_delta` / `subagent_message_delta` / `run_*` → enqueue deltas
```

`projectTimelineEventToChunks` 函数可以直接复用，它是纯函数。

---

## Migration Phases

### Phase 0: apps/server 补全（前置条件）

**Owner**: Implementation Sub Agent  
**估计**: 小改动，半天内

- [ ] `apps/server` 加 CORS 中间件，允许 `localhost:5173`（Vite dev server）
- [ ] 确认 `POST /chat/sessions/:sessionId/runs` 返回 `{ runId }` — (当前确认返回什么？)
- [ ] `workspace.selectDirectory` 在 web 下不需要 server 支持，但 `readTextFile/writeTextFile` 需要 server 端文件读写端点 (WorkspaceModule 检查)
- [ ] 可选：给 agent-context events / observability events 加简单的 SSE 或 polling 端点

### Phase 1: 创建 `apps/web` scaffold

**Owner**: Bootstrap Sub Agent  
**估计**: 半天

- [ ] 在 `apps/web/` 创建 Vite + React + TypeScript 项目
- [ ] 配置 `package.json`（与 monorepo 集成，pnpm workspace）
- [ ] 配置 TailwindCSS（复用 root 的 Tailwind 配置）
- [ ] 配置 TanStack Router（与 renderer 相同的模式）
- [ ] 配置 `@tanstack/react-query`
- [ ] 配置路径别名（`~/ → apps/web/src/`）
- [ ] 配置 `tsconfig.json`
- [ ] 在 `pnpm-workspace.yaml` 中添加 `apps/web`
- [ ] 验证：`pnpm dev` 能在 `apps/web` 里跑通

### Phase 2: OpenAPI Client Generation 基础设施

**Owner**: Infrastructure Sub Agent  
**估计**: 半天

- [ ] 在 `apps/web` 安装 `@hey-api/openapi-ts`
- [ ] 配置 `openapi-ts.config.ts`（指向 server OpenAPI spec，配置 React Query plugin）
- [ ] 在 `package.json` 加 `"generate": "openapi-ts"` script
- [ ] 确保 `apps/server` 运行时，`pnpm generate` 能生成 `apps/web/src/api/` 下的 client
- [ ] 把 `apps/web/src/api/` 加入 `.gitignore`
- [ ] 验证生成的 client 包含所有核心接口（workspace, session, chat, skills 等）

### Phase 3: Move Renderer Code + Replace IPC

**Owner**: Migration Sub Agent（最大工作量）  
**估计**: 2 天

**3a. 代码搬运**
- [ ] 把 `src/renderer/src/components/` → `apps/web/src/components/`
- [ ] 把 `src/renderer/src/features/` → `apps/web/src/features/`
- [ ] 把 `src/renderer/src/hooks/` → `apps/web/src/hooks/`
- [ ] 把 `src/renderer/src/lib/` → `apps/web/src/lib/`（排除 `ipc.ts`）
- [ ] 把 `src/renderer/src/modules/` → `apps/web/src/modules/`
- [ ] 把 `src/renderer/src/store/` → `apps/web/src/store/`
- [ ] 把 `src/renderer/src/styles.css` → `apps/web/src/styles.css`
- [ ] 把 `src/renderer/src/tabs/` → `apps/web/src/tabs/`
- [ ] 把路由配置搬过来（`app.tsx` / `main.tsx`）

**3b. IPC 替换策略**

用生成的 API client 替换 `ipc.xxx()` 调用。策略：

```
// 旧: ipc.workspace.list() → useQuery 包装
// 新: 用生成的 useWorkspaceListQuery() 直接替换
```

需要逐 feature 替换：
- [ ] workspace feature
- [ ] session feature
- [ ] skills feature
- [ ] agent-management feature（`ipc.agentRuntime.*` + `ipc.acp.*`）
- [ ] git feature
- [ ] kanban feature
- [ ] search feature
- [ ] usage feature

**3c. 删除 IPC 层**
- [ ] 删除 `apps/web/src/lib/ipc.ts`（不再需要）
- [ ] 删除所有 `window.electron` / `window.ipc` 引用
- [ ] 把 `typeof window.ipc.xxx` 类型引用替换为 OpenAPI 生成的类型

### Phase 4: 实时事件重写

**Owner**: Transport Sub Agent  
**估计**: 1 天

**4a. Chat transport 重写**
- [ ] 新建 `apps/web/src/features/chat/sse-chat-transport.ts`
  - `sendMessages` → POST `/chat/sessions/:id/runs` → 得到 `{ runId }`
  - 打开 SSE 连接 `GET /chat/runs/:runId/stream`
  - 用 `EventSource` 或 `fetch` + `ReadableStream` 读 SSE 事件
  - 复用 `projectTimelineEventToChunks` 纯函数（从 `@shared` 导入）
  - `hasActiveTurn` → GET `/chat/sessions/:id/timeline` 检查 status
- [ ] 删除 `ipc-chat-transport.ts`，替换所有引用

**4b. PTY streaming**
- [ ] PTY output 换成消费 `GET /pty/:sessionId/stream` SSE
- [ ] PTY input → `POST /pty/:sessionId/input`（确认 server 有此端点）

**4c. 其他事件**
- [ ] Agent context events：先改为 polling（低优先级）
- [ ] Observability events：先改为 polling（低优先级）
- [ ] ACP 安装进度：先改为 polling（低优先级）

### Phase 5: Electron-native 功能替换

**Owner**: UI Sub Agent  
**估计**: 半天

- [ ] `workspace.selectDirectory()` → 用 `<input type="file" webkitdirectory>` 实现 `DirectoryPickerButton` 组件
- [ ] `shell.openExternal(url)` → `window.open(url, '_blank', 'noopener,noreferrer')`
- [ ] 检查还有没有其他 `window.electron.*` 调用，逐一处理

### Phase 6: 构建与开发工作流

**Owner**: DevOps Sub Agent  
**估计**: 半天

- [ ] `apps/web` 的 `dev` script：先手动 `pnpm --filter apps/server dev` + `pnpm --filter apps/web dev`
- [ ] 可选：在 root `package.json` 加 `dev:fullstack` script 同时启动 server + web
- [ ] `apps/web` 的 `build` script 跑通
- [ ] TypeScript typecheck 通过
- [ ] 端口约定文档化：server=3000（或现有端口），web=5173

---

## Success Criteria

- [x] `apps/web` 可以在浏览器里独立运行，不依赖 Electron
- [x] Chat 功能可用：发送消息、流式响应、查看历史（SSE transport）
- [x] Workspace 功能可用：列表、创建（HTTP API）
- [x] Skills 功能可用：列表、创建、编辑（HTTP API + directory picker）
- [x] Agent management 可用：profiles / credentials 管理（HTTP API）
- [x] PTY terminal 可用（SSE streaming via `sse-pty-connector.ts`）
- [x] `pnpm typecheck` 在 `apps/web` 通过
- [x] `pnpm build` 在 `apps/web` 通过（79 modules, 218kB / 68kB gzip）
- [x] 没有 `window.electron` / `window.ipc` 运行时残留
- [ ] `src/renderer` 不需要被修改（等 Electron 回归时再接入）

---

## What We Are NOT Doing (Scope Boundaries)

- **不删 `src/renderer`** — Electron shell 以后还会用，保留
- **不触碰 `apps/server`** 的核心 module 逻辑，只加 CORS 和可能的少量端点
- **不做 Electron 兼容层** — 等 `apps/web` 稳定后再设计
- **不做 WebSocket** — 除非 SSE 不够用，先用 SSE，后续再升级
- **不部署** — 只做本地 dev 开发流程

---

## File Layout After Migration

```
apps/
  server/          ← 已有，不动
  web/
    src/
      api/          ← hey-api 生成，gitignored
      components/
      features/
        chat/
          sse-chat-transport.ts  ← 新，替换 ipc-chat-transport
          use-chat-session.ts
          ...
        workspace/
        skills/
        ...
      hooks/
      lib/
      modules/
      store/
      tabs/
      app.tsx
      main.tsx
      styles.css
    index.html
    openapi-ts.config.ts
    package.json
    tsconfig.json
    vite.config.ts
```

---

## Spawned Sub Agents Plan

| Agent | Phase | Scope | Key Output |
|-------|-------|-------|-----------|
| Bootstrap | 1 | 创建 apps/web scaffold | 能跑的空 app |
| Infrastructure | 2 | OpenAPI gen 基础设施 | `pnpm generate` 能生成 client |
| Migration | 3 | 代码搬运 + IPC 替换 | feature 代码全部切换到 HTTP client |
| Transport | 4 | 实时事件重写 | SSE chat transport |
| UI | 5 | Native 功能替换 | 无 Electron 依赖 |
| DevOps | 6 | 构建工作流 | typecheck + build 通过 |

---

## Notes

1. **`projectTimelineEventToChunks`** 是纯函数，在 `src/shared/timeline-projection.ts`，可以直接复用。只需要确认 `apps/web` 能 import `@shared` 或直接 copy。
2. **hey-api 生成的 React Query hooks** 需要在 `QueryClientProvider` 下使用，检查 `apps/web` 的 app root 有没有配置好。
3. **CORS**: `apps/server` 现在可能没有 CORS 配置，`apps/web`（localhost:5173）打 `apps/server`（localhost:3000）会被 CORS block，Phase 0 必须先修。
4. **`@shared` 路径**: 现在 renderer 里用了很多 `@shared` 路径的类型和工具，`apps/web` 需要把这些 alias 也配置进来（指向 `src/shared/`）。
