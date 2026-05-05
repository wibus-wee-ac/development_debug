<!-- Once this directory changes, update this README.md -->

# src/main/contexts/kanban/application/__tests__

Kanban 应用层测试通过 fake-store 证明 query / command 语义。
测试关注行为与边界，而不是 Electron 运行时细节。
新增 Kanban 应用服务时，应先在这里写失败测试。

## Files

- **kanban-query-application.test.ts**: Kanban 读侧应用服务测试，覆盖排序、过滤、搜索与会话链接投影
- **kanban-write-application.test.ts**: Kanban 写侧应用服务测试，覆盖状态、看板、里程碑、Issue、评论、关联、上下文引用与会话链接
