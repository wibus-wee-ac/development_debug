<!-- Once this directory changes, update this README.md -->

# Main/App

`app/` 负责装配 Electron 生命周期、注册 IPC adapter，并持久化 app-wide 状态。
这里不承载业务规则；它只组合 `features/`、`platform/`、`db/` 与 `events/`。
新增 startup/shutdown wiring、IPC glue 或 app-level store 时放在这里。

## Files

- **main.ts**: 主进程 composition root，初始化 DB、provider catalog、事件桥、窗口与 socket server
- **ipc/**: 所有主进程 IPC adapters，把 renderer/CLI 调用路由到 feature 或 platform
- **store/**: app-wide 持久化 store，如窗口状态与全局聊天偏好
