<!-- Once this directory changes, update this README.md -->

# Main/Devtools

`devtools/` 负责主进程观测缓冲、订阅分发与独立 devtool 窗口集成。
这些模块把 IPC、ACP 与 agent context 观测统一接到调试 UI，而不拥有业务语义。
把调试后端放在这里；业务事件的产生仍由各自 owner 负责。

## Files

- **acp-devtool-store.ts**: ACP devtool 事件缓冲与订阅分发
- **agent-context-devtool-store.ts**: agent context 快照缓冲与订阅分发
- **ipc-devtool-store.ts**: IPC 事件缓冲与订阅分发
- **observability-devtool-store.ts**: local observability 事件与 incident 缓冲分发
- **ipc-devtool.ts**: devtool 窗口初始化、订阅 wiring 与观测集成
- **__tests__/**: devtool stores 与 backend 集成测试
