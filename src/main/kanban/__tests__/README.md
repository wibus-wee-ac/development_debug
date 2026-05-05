<!-- Once this directory changes, update this README.md -->

# Main/Features/Kanban/__tests__

这些测试验证 Kanban query/write feature 的行为边界。
它们使用 fake store 证明用例语义，而不是依赖完整 Electron 运行时。
新增 Kanban 规则时，应优先在这里补失败测试。

## Files

- **kanban-query-application.test.ts**: 验证排序、过滤、搜索与 linked-session 投影
- **kanban-write-application.test.ts**: 验证状态、层级、评论、关联与 session 链接更新
