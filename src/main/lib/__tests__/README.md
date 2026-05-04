<!-- Once this directory changes, update this README.md -->

# src/main/lib/__tests__

这里放主进程 library 的单元测试，重点验证纯领域逻辑与文件系统边界。
测试会 mock ACP、Electron 或外部服务，但保留 library 的真实契约。
当库层抽象、优先级规则或持久化路径变化时，应先在这里补回归。

## Files

- **acp-connection.test.ts**: 覆盖 ACP 连接生命周期、prompt 流与 session restore 语义
- **acp-installer.test.ts**: 覆盖 ACP 安装器的安全校验与安装卸载持久化行为
- **acp-process-manager.test.ts**: 覆盖 ACP 子进程生命周期指标与清理逻辑
- **acp-registry.test.ts**: 覆盖远程 ACP registry 的拉取与分发过滤
- **acp-responses-converter.test.ts**: 覆盖 ACP 事件到 OpenAI Responses 事件的转换
- **e2e-world-utils.test.ts**: 覆盖 E2E 启动环境、artifact 路径与 scenario slug 生成规则
- **ipc-devtool-backend.test.ts**: 覆盖 IPC Devtool 缓冲区与订阅分发
- **mock-llm-server.test.ts**: 覆盖 E2E Mock LLM server 的成功流、失败流与重启后状态隔离
- **session-preferences.test.ts**: 覆盖会话偏好捕获与重新应用逻辑
- **skills.test.ts**: 覆盖五层 Skills 扫描优先级、inventory 标记、只读约束、CRUD 与导入导出
- **window-activation.test.ts**: 覆盖测试模式下窗口显示/聚焦不会抢占前台的行为
- **window-display-policy.test.ts**: 覆盖窗口激活抑制策略在 test/e2e/interactive 三种模式下的判定
