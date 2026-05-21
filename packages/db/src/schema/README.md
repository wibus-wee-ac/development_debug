<!-- Once this directory changes, update this README.md -->

# src/main/db/schema

数据库 schema 按上下文拆分在这里，避免所有表长期堆在一个文件里。
`index.ts` 是唯一 canonical export surface，外部仍通过 `src/main/db/schema` 导入。
新增表时先判断 owner context，再落到对应模块，而不是回到单体 schema。

## Files

- **backend-control-plane.ts**: backend binding、run 与 capability snapshot 相关表；binding 只保留 Cradle-owned backend snapshot + requested model，不再复制 ACP config snapshot，也不再承载 chat chunk timeline durable storage
- **automation.ts**: Agent-authored automation definition、run、artifact 与 event 相关表；只写 automation namespace，通过 ID 引用 normal chat session/backend run
- **index.ts**: Schema barrel，聚合导出所有 context-specific schema 模块
- **shared.ts**: 共享列片段与 `workspaces` 表
- **identity.ts**: Agent identity / credential 相关表
- **chat.ts**: Product session、message、usage log 相关表；`messages.message_json` 是 chat hydration 真相源，`messages.content` 是派生纯文本 cache
- **chronicle.ts**: Chronicle 本地活动记忆相关表，包含 screen snapshot、accessibility evidence、activity session/segment/pipeline run、knowledge card/version/source、dream run/candidate、raw audio segment、audio transcript、memory、memory chunk/keyword/embedding index、model resource status 与 event
- **runtime.ts**: Runtime audit 相关表
- **acp.ts**: ACP agent 与 ACP audit 相关表
- **issue.ts**: Workspace-scoped Issue、状态、里程碑、评论、关联相关表；当前 SQLite 物理表名仍沿用 `kanban_*`
- **kanban.ts**: Kanban board/view configuration 相关表
- **issue-agent.ts**: Issue Agent session / activity 相关表
- **observability.ts**: local observability append-only events 与 dedupe incident 相关表
