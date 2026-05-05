<!-- Once this directory changes, update this README.md -->

# src/main/contexts/issue-agent/infrastructure

Issue Agent 基础设施层负责把委派执行接到 Chat runtime 与事件总线上。
这里放运行时执行器和进程/事件桥接实现，而不是通用业务规则。
如果后续拆分 runner，这个目录会继续向更细的 runtime 组件演化。

## Files

- **issue-agent-runner.ts**: 委派执行 runner，负责 prompt 组装、chat bridge、activity/comment 投影与完成态收口
