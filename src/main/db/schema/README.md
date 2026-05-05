<!-- Once this directory changes, update this README.md -->

# src/main/db/schema

数据库 schema 按上下文拆分在这里，避免所有表长期堆在一个文件里。
`index.ts` 是唯一 canonical export surface，外部仍通过 `src/main/db/schema` 导入。
新增表时先判断 owner context，再落到对应模块，而不是回到单体 schema。

## Files

- **index.ts**: Schema barrel，聚合导出所有 context-specific schema 模块
- **shared.ts**: 共享列片段与 `workspaces` 表
- **identity.ts**: Agent identity / credential 相关表
- **chat.ts**: Session、message、usage log 相关表
- **runtime.ts**: Runtime session 与 runtime audit 相关表
- **acp.ts**: ACP agent 与 ACP audit 相关表
- **kanban.ts**: Kanban 状态、看板、里程碑、Issue、评论、关联相关表
- **issue-agent.ts**: Issue Agent session / activity 相关表
