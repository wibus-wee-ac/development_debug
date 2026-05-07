<!-- Once this directory changes, update this README.md -->

# src/main/db/schema

数据库 schema 按上下文拆分在这里，避免所有表长期堆在一个文件里。
`index.ts` 是唯一 canonical export surface，外部仍通过 `src/main/db/schema` 导入。
新增表时先判断 owner context，再落到对应模块，而不是回到单体 schema。

## Files

- **backend-control-plane.ts**: backend binding、run、append-only timeline 与 capability snapshot 相关表；binding 只保留 Cradle-owned backend snapshot + requested model，不再复制 ACP config snapshot
- **index.ts**: Schema barrel，聚合导出所有 context-specific schema 模块
- **shared.ts**: 共享列片段与 `workspaces` 表
- **identity.ts**: Agent identity / credential 相关表
- **chat.ts**: Product session、message、usage log 相关表；不再承载 backend session 状态
- **runtime.ts**: Runtime audit 相关表
- **acp.ts**: ACP agent 与 ACP audit 相关表
- **kanban.ts**: Kanban 状态、看板、里程碑、Issue、评论、关联相关表
- **issue-agent.ts**: Issue Agent session / activity 相关表
- **observability.ts**: local observability append-only events 与 dedupe incident 相关表
