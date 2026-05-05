<!-- Once this directory changes, update this README.md -->

# src/main/contexts/issue-agent/application

Issue Agent 应用层负责 delegate/run/stop/undelegate 等用例编排。
该层协调 DB 与 runner，但不直接承载 Electron 窗口或 UI 细节。
运行时执行器与 chat bridge 细节则放在同上下文的 `infrastructure/`。

## Files

- **issue-delegation-application.ts**: Issue 委派应用服务，封装 delegate/run/stop/undelegate 用例
- **__tests__/**: Issue 委派应用层测试
