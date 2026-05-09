<!--
Output: Session capability spec for server migration.
Input: Legacy SessionService IPC behavior and chat/session schema.
Position: apps/server/specs/capabilities session spec.
-->

# Capability: Session

## Superpowers Used

- Leader Agent: using-superpowers, brainstorming, writing-plans, subagent-driven-development
- Architecture Explorer Sub Agent: Explore (Tsuki/Hono module constraints)
- Legacy Behavior Explorer Sub Agent: Explore (session IPC behavior + renderer usage)
- Dependency / Side Effect Explorer Sub Agent: Explore (DB schema + search/pty side effects)
- Capability SPEC Writer Sub Agent: Leader Agent (this document)

## Spawned Sub Agents

| Agent | Scope | Output | Status |
| --- | --- | --- | --- |
| Architecture Explorer | Tsuki/Hono module constraints | Module layout notes for controller/service/store | ✅ Done |
| Legacy Behavior Explorer | SessionService IPC behavior + tests | CRUD + message read + export markdown behavior | ✅ Done |
| Dependency Explorer | DB schema + search/pty dependencies | Side effect map + dependency list | ✅ Done |

## User / System Goal

- 系统维护聊天会话元数据（workspace、title、agentProfileId、pinned 等），支持列表、读取、创建、更新、删除。
- UI 需要读取会话消息列表用于历史展示，并支持导出为 Markdown。

## Current Behavior Evidence

- IPC `SessionService` 支持 `list/get/create/delete/updateTitle/getMessages/togglePin/exportAsMarkdown`。
- `delete` 会停止当前会话的 PTY，并移除该会话的搜索索引（FTS）。
- `exportAsMarkdown` 读取 session + messages + backend session binding，并使用 timeline events 还原 assistant 文本。

## Inputs / Outputs

### CRUD

- `list(workspaceId)` → `Session[]`（按 `updatedAt` 倒序）
- `get(id)` → `Session | null`
- `create({ workspaceId, title, agentProfileId, id? })` → `Session`
- `update({ id, title?, pinned? })` → `Session | null`（更新 `updatedAt`）
- `delete(id)` → `{ ok: true }`

### Message Read

- `getMessages(sessionId)` → `Message[]`（按 `createdAt` 升序）

### Export

- `exportAsMarkdown(sessionId)` → `string`
  - Header: `# {title}`
  - Meta: `> Model: {requestedModelId|unknown} | Created: {local time}`
  - 每条消息按 `## User/Assistant` 分段
  - Assistant 文本优先从 timeline events 提取

## Side Effects

- 删除会话时尝试触发 PTY 停止与搜索索引清理（若相关 capability 已迁移）。
- 当前阶段可通过 SessionCleanup 适配器实现，默认 no-op，后续由 pty/search capability 接入。

## Dependencies

- `@cradle/db`：`sessions` / `messages` / `backend_session_bindings` / `backend_runs` / `backend_timeline_events`。
- `DbAccessor`（服务器 DB 访问）。
- 搜索索引（thread search）与 PTY 能力（若已迁移，作为可选依赖）。

## Domain Model

```ts
type Session = {
  id: string
  workspaceId: string
  title: string
  agentProfileId: string
  agentId: string | null
  linkedIssueId: string | null
  pinned: number
  createdAt: number
  updatedAt: number
}

type Message = {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  content: string
  errorText: string | null
  createdAt: number
  updatedAt: number
}
```

## Target API

HTTP endpoints (Tsuki/Hono controller):

- `GET /sessions?workspaceId=` → `Session[]`
- `GET /sessions/:id` → `Session | null`
- `POST /sessions` `{ workspaceId, title, agentProfileId, id? }` → `Session`
- `PATCH /sessions/:id` `{ title?, pinned? }` → `Session`
- `DELETE /sessions/:id` → `{ ok: true }`
- `GET /sessions/:id/messages` → `Message[]`
- `GET /sessions/:id/export/markdown` → `{ markdown: string }`

错误约定：

- 输入缺失/非法 → `AppError` (HTTP 400)
- 不存在 → 返回 `null` 或空列表

## Target Module Design

- `SessionModule`
  - `SessionController`: HTTP endpoints
  - `SessionService`: 业务语义 + side effects
  - `SessionStore`: DB 访问
  - `SessionExport`: Markdown 导出与 timeline 文本提取

## Events

- 本能力不引入事件发布/订阅（后续 search/pty capability 可接入）。

## Compatibility Requirements

- 保持旧 IPC 语义：排序、返回 `null`/空列表、Markdown 结构。
- 删除会话时尝试清理 PTY 与搜索索引（若 capability 已可用）。

## Test Plan

- CRUD：创建/更新/删除/列表/读取。
- `PATCH /sessions/:id`：支持 title / pinned 的资源字段更新。
- `getMessages`：按时间升序返回。
- `exportAsMarkdown`：包含标题、模型信息与消息内容，assistant 文本来自 timeline events。
- 删除时调用 PTY/搜索清理（可用时）。

## Cutover Plan

- 新 server capability 通过 HTTP 暴露 session 能力后，客户端逐步迁移到新 API。
- 旧 IPC 入口保留到新 API 完成切换后再移除。
