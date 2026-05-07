<!-- Once this directory changes, update this README.md -->

# Main

主进程由 `app/` 装配、`features/` 承载业务、`platform/` 承载系统适配，`db/` 与 `events/` 提供持久化和域事件。
新增能力时先判断 owner，再决定它属于 app glue、feature 语义还是 platform 能力。
不要把业务规则重新塞回水平技术桶；旧 `contexts/` 与 `lib/` 已被收敛删除。

## Files

- **index.ts**: Electron 主进程薄入口，只转入 `app/main`
- **ipc-types.ts**: 主进程与 preload/renderer 共享的 IPC 类型导出层
- **app/**: 主进程装配层，包含 bootstrap、IPC adapters 与 app-wide store
- **features/**: 业务能力目录，如 `chat`、`kanban`、`issue-agent`、`skills`、`agent-runtime`
- **platform/**: 系统/运行时适配目录，如 `acp`、`window`、`pty`、`storage`、`socket`、`resources`
- **devtools/**: 主进程调试后端与观测缓冲
- **db/**: SQLite 初始化、schema 与持久化入口
- **events/**: 进程内领域事件与桥接器
- **observability/**: 本地观测事件、incident 规则、批量持久化与调试导出
- **__tests__/**: 跨 feature/platform 的根级主进程回归测试
