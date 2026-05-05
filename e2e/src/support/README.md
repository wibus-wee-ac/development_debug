<!-- Once this directory changes, update this README.md -->

# E2E/Support

这里存放端到端测试共享的 world、hooks 与辅助服务，用来隔离环境并稳定启动 Electron 应用。
Support 层负责测试生命周期与共享状态，不承载具体业务断言。
当应用启动成本、测试状态隔离或全局前后置逻辑变化时，应同步更新这里。

## Files

- **hooks.ts**: 全局 hooks，负责 scenario 级启动、trace/screenshot 落盘、失败附件与清理
- **mock-llm-server.ts**: 本地 OpenAI-compatible mock server，支持成功/失败模式与请求日志
- **world.ts**: 自定义 Cucumber world，维护隔离的 `userData`、`HOME`、scenario 状态与 mock provider 生命周期
- **world-utils.ts**: scenario slug、artifact 路径与隐藏窗口 E2E 启动环境的纯工具函数
