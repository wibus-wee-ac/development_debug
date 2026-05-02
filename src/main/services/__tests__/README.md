<!-- Once this directory changes, update this README.md -->

# Main/Services/__tests__

这里验证 IPC service 层的参数适配、数据库查询与下层 library 调用契约。
测试不会启动完整 Electron 应用，而是聚焦 service 的输入输出边界。
当 service 新增参数、路径解析或跨层路由规则时，应在这里补回归。

## Files

- **agent-runtime.test.ts**: 覆盖 Agent Profile CRUD、provider probe 与凭证脱敏
- **preferences.test.ts**: 覆盖应用偏好默认值与更新逻辑
- **session.test.ts**: 覆盖会话元数据写入与读取契约
- **skills.test.ts**: 覆盖 skills IPC 从 `workspaceId`、`agentId` 到 filesystem context 的路由
