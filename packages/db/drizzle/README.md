<!-- Once this directory changes, update this README.md -->

# Drizzle

这里存放 SQLite 的 Drizzle migration 产物，是运行时真正执行的 schema 历史。
SQL 文件负责重放数据库结构，`meta/` 负责 journal 与 snapshot，三者必须成套维护。
当前历史已重新基线化；后续新增 migration 时不要再只提交其中一部分。

## Files

- **0000_initial_baseline.sql**: 当前主进程 schema 的干净 baseline migration
- **0001_steady_phalanx.sql**: 历史增量 migration，曾新增 `backend_timeline_events` append-only timeline 表
- **0015_message_snapshot_chat_runtime.sql**: 破坏性迁移，新增 `messages.message_json` 与 message-level subagent routing 字段，并删除 `backend_timeline_events`
- **0016_hot_path_indexes.sql**: 增量 migration，为 chat、Kanban、issue-agent、usage 等热路径外键和查询列补齐索引
- **meta/**: Drizzle journal 与 schema snapshot，用于 tooling 和 migration 顺序管理；该目录必须保持 JSON-only，否则 `drizzle-kit generate` 会解析失败
