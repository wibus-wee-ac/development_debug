<!-- Once this directory changes, update this README.md -->

# src/main

主进程入口层负责注册 IPC、装配服务，并定义主进程与渲染进程共享的公共类型。
复杂业务逻辑优先落到 `contexts/` 的上下文目录，而不是横向技术桶。
新增主进程能力时，先确定 owner context，再决定是否通过 `services/`、`events/`、`db/` 暴露或集成。
`lib/` 仅保留仍未 context 化的共享基础设施，后续应继续收缩。

## Files

- **index.ts**: Electron 主进程入口，负责窗口生命周期、IPC 注册与服务装配
- **ipc-types.ts**: 主进程与渲染进程共享的 IPC 类型导出层
- **contexts/**: 按业务上下文组织的主进程后端代码（如 `kanban`、`issue-agent`）
- **db/**: 数据库初始化、schema 与持久化相关入口
- **events/**: 主进程域事件与桥接层
- **lib/**: 尚未进一步 context 化的共享基础设施与系统级能力
- **services/**: 暴露给渲染进程的 IPC adapter 层
