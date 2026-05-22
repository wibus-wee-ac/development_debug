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
- **0021_violet_stephen_strange.sql**: 增量 migration，为 Kanban issue/comment provenance 和 issue-agent session agent identity 增加字段与索引
- **0023_outstanding_diamondback.sql**: Drizzle Kit 生成的 Chronicle 增量 migration，新增 snapshot、memory、model resource 与 event 表
- **0024_wooden_nightcrawler.sql**: Drizzle Kit 生成的 Chronicle Slack 增量 migration，新增 message source 与 message 表
- **0030_dazzling_blackheart.sql**: Drizzle Kit 生成的 Chronicle activity pipeline migration，新增 activity session、activity segment 与 pipeline run 表
- **0031_shallow_captain_midlands.sql**: Drizzle Kit 生成的 Chronicle knowledge/dream foundation migration，新增 knowledge card/version/file 与 dream run 表
- **0032_powerful_talos.sql**: Drizzle Kit 生成的 Chronicle normalized source/candidate migration，新增 knowledge source link 与 dream candidate 表
- **0033_next_vector.sql**: Drizzle Kit 生成的 Chronicle stable knowledge key migration，新增 `stable_key` 与索引
- **0034_aberrant_jack_flag.sql**: Drizzle Kit 生成的 Chronicle speaker profile migration，新增 speaker profile/alias/embedding runtime data 表
- **0035_lethal_greymalkin.sql**: Drizzle Kit 生成的 external provider source migration，新增 plugin-provided provider source、record 与 profile link projection 表
- **0036_thankful_psylocke.sql**: Drizzle Kit 生成的 Chronicle accessibility event migration，新增 accessibility event history 表与查询索引
- **0037_sweet_paibok.sql**: Drizzle Kit 生成的 plugin storage migration，新增 `plugin_storage_entries` 表与 plugin/key 隔离索引
- **0038_overconfident_molecule_man.sql**: Drizzle Kit 生成的 Handoff migration，新增 `handoff_proposals` 表与 status/session/agent 查询索引
- **meta/**: Drizzle journal 与 schema snapshot，用于 tooling 和 migration 顺序管理；该目录必须保持 JSON-only，否则 `drizzle-kit generate` 会解析失败
