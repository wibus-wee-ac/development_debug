<!--
Input: Alma thread archiver evidence and Cradle session/workspace audit.
Output: Spec for thread archiving and session retention.
Position: docs/specs/alma-inspired/thread-archiver.md
-->

# Thread 归档

## 目标

Cradle 需要在引入 backup、cleanup、cloud sync 之前，先定义 session 和 workspace-linked conversation artifacts 的归档与保留语义。归档必须是可恢复的生命周期状态，不应被伪装成删除。

## Alma 证据

Alma 有 thread archiver，能在 workspace path 下写入 archive state，并迁移或记录 existing threads。这说明 Alma 对 thread retention 有独立于普通 chat list 的处理。

## Cradle 当前状态

Cradle 有 session CRUD、Markdown export、workspace-linked sessions 和 DB-backed messages。当前没有 dedicated session archive lifecycle；active list、search、export 和 workspace deletion 的归档语义尚未统一。

## Owner / Namespace

`session` 拥有 session archive state、retention policy 和 message lifecycle。`workspace` 可以暴露 workspace-scoped session views，但不拥有 message retention 或 archive mutation。

## 目标行为

- 用户可以 archive 和 unarchive sessions。
- Archived sessions 默认不出现在 active lists，但可以按显式 filter 搜索和导出。
- Workspace 删除时必须说明 linked archived sessions 是 retained、detached 还是 deleted。
- Archive 操作默认可逆；destructive delete 需要单独 API 和 UI confirmation。

## API 草案

- `POST /sessions/:id/archive`
- `POST /sessions/:id/unarchive`
- `GET /sessions?archived=true`
- `POST /sessions/archive/bulk`

## 数据模型

在 session-owned records 上增加 archive timestamp、actor、reason、retention policy、workspace detach policy 和 optional legal hold marker。Message records 不因 archive 自动变更。

## 验收

- Archive session 不会删除 messages、artifacts 或 usage records。
- Archived session 可以导出为 Markdown。
- Search 可以显式 include 或 exclude archived sessions。
- Workspace deletion 对 archived sessions 的处理有确定结果并写入 audit event。
