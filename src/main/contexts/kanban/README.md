<!-- Once this directory changes, update this README.md -->

# src/main/contexts/kanban

Kanban 上下文拥有看板读写用例与相关业务编排。
这里表达的是 Kanban 的业务边界，而不是纯技术层的归类。
与委派执行相关的 agent 运行时逻辑不放在这里，而是由 `issue-agent/` 上下文拥有。

## Files

- **application/**: Kanban 的 command/query 应用服务与对应测试
