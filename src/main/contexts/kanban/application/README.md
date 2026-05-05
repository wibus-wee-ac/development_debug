<!-- Once this directory changes, update this README.md -->

# src/main/contexts/kanban/application

Kanban 应用层负责把 IPC adapter 与持久化细节隔开。
该层拥有 Kanban 的 query / command 语义，不把业务规则留在 service 里。
当 Kanban 规则继续增长时，应先扩展这里，再考虑更细的 domain/infrastructure 拆分。

## Files

- **kanban-query-application.ts**: Kanban 读侧应用服务，封装排序、过滤、搜索与 linked-issue 投影查询
- **kanban-write-application.ts**: Kanban 写侧应用服务，封装状态、看板、里程碑、Issue、评论、关联、上下文引用与会话链接命令
- **__tests__/**: Kanban 应用层行为测试
