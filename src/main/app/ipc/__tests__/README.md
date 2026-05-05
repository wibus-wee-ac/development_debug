<!-- Once this directory changes, update this README.md -->

# Main/App/IPC/__tests__

这些测试验证 IPC adapters 的参数整形、路由与轻量协作契约。
测试不会启动完整 Electron 应用，而是聚焦 app-level transport surface。
当 IPC surface 改名、改路由或改 owner 时，应优先在这里补回归。

## Files

- **agent-runtime.test.ts**: 覆盖 profile CRUD、provider probe 与凭证脱敏行为
- **issue-agent.test.ts**: 覆盖 issue-agent IPC adapter 的委派路由与 runner 协作
- **preferences.test.ts**: 覆盖全局聊天偏好的读取与更新
- **session.test.ts**: 覆盖会话元数据写入与读取契约
- **skills.test.ts**: 覆盖 skills IPC 从 workspace/agent 上下文到 filesystem layer 的路由
