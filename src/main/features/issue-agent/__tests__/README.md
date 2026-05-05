<!-- Once this directory changes, update this README.md -->

# Main/Features/Issue Agent/__tests__

这些测试验证 issue delegation 与 agent session/activity 查询的 feature 语义。
它们优先证明 delegated workflow 的边界条件与状态推进。
新增委派规则时，应先在这里写失败测试。

## Files

- **issue-agent-query-application.test.ts**: 验证 agent session/activity 查询的排序与过滤行为
- **issue-delegation-application.test.ts**: 验证 delegate/run/stop/undelegate 的写侧规则
