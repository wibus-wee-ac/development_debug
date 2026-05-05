<!-- Once this directory changes, update this README.md -->

# Main/Application/Tests

应用层测试验证跨模块编排行为和事务边界约束。
测试关注 use case 输入输出，不依赖 Electron 运行时。
当新增应用服务时，先在这里定义失败测试再实现。

## Files

- **kanban-query-application.test.ts**: Kanban 读侧应用服务的 fake-store 行为测试，覆盖排序、过滤、搜索与会话链接投影查询
- **kanban-write-application.test.ts**: Kanban 写侧应用服务的 fake-store 行为测试，覆盖状态、看板、里程碑、Issue、评论、关联、上下文引用与会话链接命令
- **issue-delegation-application.test.ts**: Issue 委派应用服务的状态流转与 runner 协调测试
