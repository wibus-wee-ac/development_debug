<!-- Once this directory changes, update this README.md -->

# Main/Platform/ACP/__tests__

这些测试验证 ACP transport、安装、registry 与进程管理契约。
它们是 ACP platform 层的第一道回归防线。
修改 ACP 协议桥接或安装策略时，应先更新这里。

## Files

- **acp-connection.test.ts**: 验证 ACP connection manager 的连接与 session 行为
- **acp-installer.test.ts**: 验证 ACP 安装/卸载辅助逻辑
- **acp-process-manager.test.ts**: 验证 ACP 子进程生命周期与 devtool 记录
- **acp-registry.test.ts**: 验证 registry 拉取与平台过滤逻辑
- **acp-timeline-converter.test.ts**: 验证 ACP session update 到 typed timeline 事件的转换
