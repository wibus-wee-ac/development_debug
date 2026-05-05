<!-- Once this directory changes, update this README.md -->

# Main/__tests__

这里放跨 feature/platform 的根级主进程回归测试。
这些测试验证共享工具、E2E 支撑件或不明显属于单一 owner 的能力。
若一个测试明显属于某个 feature，请优先把它下沉到 owner 目录。

## Files

- **e2e-world-utils.test.ts**: 验证 E2E artifact 路径与 launch env 默认值
- **mock-llm-server.test.ts**: 验证 mock LLM server 的流式响应、错误与重启隔离
- **session-preferences.test.ts**: 验证全局 chat preferences 的提取与重放逻辑
