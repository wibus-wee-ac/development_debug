<!-- Once this directory changes, update this README.md -->

# Main/Features/Issue Agent

Issue Agent feature 负责 issue delegation、runner 协调与 agent session/activity 查询。
它拥有委派语义与执行状态机，而不是让 Kanban 或 app/ipc 直接编排这些流程。
把 delegated issue 的生命周期规则与 feature 内部 store 边界放在这里。

## Files

- **issue-agent-query.ts**: agent session 与 activity 的查询排序/过滤逻辑
- **issue-agent-runner.ts**: injected issue-agent runtime；只依赖一个小 chat port 执行/停止 delegated issue，并把聊天完成事件作为 composition-root subscriber 装配进来
- **issue-delegation.ts**: 委派、取消委派、启动与停止的纯写侧规则；默认 store/runner 装配留给 app owner
- **__tests__/**: issue-agent feature 回归测试
