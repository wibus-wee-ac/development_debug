<!-- Once this directory changes, update this README.md -->

# Main/Application

应用层负责跨领域编排，把 IPC adapter 与底层基础设施解耦。
该层实现用例级 command/query 流程，并控制事务与事件发布边界。
新增复杂业务流程时，应优先放在这里而不是 service 或 lib 里。

## Files

- **kanban-query-application.ts**: Kanban 读侧应用服务，封装排序、过滤、搜索与会话关联投影等查询用例
- **kanban-write-application.ts**: Kanban 写侧应用服务，封装状态、看板、里程碑、Issue、评论、关联、上下文引用与会话链接等命令用例
- **issue-delegation-application.ts**: Issue 委派相关应用服务，封装 delegate/run/stop/undelegate 用例
