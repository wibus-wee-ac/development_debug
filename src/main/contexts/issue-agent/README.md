<!-- Once this directory changes, update this README.md -->

# src/main/contexts/issue-agent

Issue Agent 上下文拥有 issue 委派与 agent 执行生命周期。
这里的代码围绕 agent session、delegation 和运行时收口演化。
与纯 Kanban 读写无关的 agent 执行逻辑应优先放在这个上下文内。

## Files

- **application/**: 委派相关应用服务与测试
- **infrastructure/**: Issue Agent 的运行时基础设施实现
