<!-- Once this directory changes, update this README.md -->

# src/main/db/schema

数据库 schema 按上下文拆分在这里，避免所有表长期堆在一个文件里。
`index.ts` 是唯一 canonical export surface，外部仍通过 `src/main/db/schema` 导入。
新增表时先判断 owner context，再落到对应模块，而不是回到单体 schema。

## Files

- **backend-control-plane.ts**: backend binding、run 与 session-start capability snapshot 相关表；binding 只保留 Cradle-owned backend snapshot + requested model，不再复制 ACP config snapshot，也不再承载 chat chunk timeline durable storage
- **automation.ts**: Agent-authored automation definition、run、artifact 与 event 相关表；只写 automation namespace，通过 ID 引用 normal chat session/backend run
- **index.ts**: Schema barrel，聚合导出所有 context-specific schema 模块
- **shared.ts**: 共享列片段与 `workspaces` 表；workspace records own project pin state for app sidebar ordering
- **identity.ts**: Agent identity / credential 相关表
- **chat.ts**: Product session、message、usage log、Chat Session continuation queue 相关表；`messages.message_json` 是 chat hydration 真相源，`messages.content` 是派生纯文本 cache，`chat_session_queue_items` 由 Chat Runtime 拥有，用于持久化 `queue` / `steer` follow-up
- **chronicle.ts**: Chronicle 本地活动记忆相关表，包含 screen snapshot、accessibility evidence/event history、activity session/segment/pipeline run、knowledge card/version/source、dream run/candidate、raw audio segment、audio transcript、speaker profile、memory、memory chunk/keyword/embedding index、model resource status 与 event
- **external-sources.ts**: Plugin-provided external provider source、source record 与 external runtime target 表；Cradle 只写自己的 external-source namespace，不写外部产品 namespace，也不再把外部记录投影进 manual profile 表
- **handoff.ts**: Agent-to-Agent handoff proposal lifecycle 表；只拥有交接 proposal/status/result，通过 ID 引用 chat session 和 agent identity
- **runtime.ts**: Runtime audit 相关表
- **acp.ts**: ACP agent 与 ACP audit 相关表
- **issue.ts**: Workspace-scoped Issue、状态、里程碑、评论、关联相关表；当前 SQLite 物理表名仍沿用 `kanban_*`
- **kanban.ts**: Kanban board/view configuration 相关表
- **model-registry.ts**: 全局 model registry mappings 表，保存 Cradle-owned provider model ID 到 models.dev/manual registry entry 的映射，供所有 provider target 与 custom model enrichment 共享
- **issue-agent.ts**: Issue Agent session / activity 相关表
- **observability.ts**: local observability append-only events 与 dedupe incident 相关表
- **plugin.ts**: Cradle plugin host 拥有的 plugin-scoped persistent storage 表；按 plugin package identity 和 key 隔离，不写入其他产品 namespace
