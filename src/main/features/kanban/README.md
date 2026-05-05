<!-- Once this directory changes, update this README.md -->

# Main/Features/Kanban

Kanban feature 负责 issue/board/milestone 的查询语义与写侧命令。
它拥有 linked session projection 与写入一致性，而不是让 IPC adapter 胀成 God object。
把 Kanban 的业务规则集中在这里。

## Files

- **kanban-query.ts**: Kanban 读侧查询、筛选、排序与 linked-session 投影
- **kanban-write.ts**: Kanban 写侧命令、层级清理与关联更新
- **__tests__/**: Kanban feature 回归测试
