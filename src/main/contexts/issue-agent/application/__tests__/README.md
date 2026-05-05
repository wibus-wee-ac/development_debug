<!-- Once this directory changes, update this README.md -->

# src/main/contexts/issue-agent/application/__tests__

Issue Agent 应用层测试验证委派状态流转与 runner 协调。
测试关注 use case 行为，而不是底层进程实现。
新增委派规则时，应先在这里补失败测试。

## Files

- **issue-delegation-application.test.ts**: 委派应用服务测试，覆盖 delegate/run/stop/undelegate 行为
