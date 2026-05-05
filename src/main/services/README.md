<!-- Once this directory changes, update this README.md -->

# Main/Services

主进程 IPC Services 把数据库、文件系统与运行时能力组织成稳定的调用边界。
每个 service 负责一个清晰领域，通过 `@cradle/ipc` 暴露给渲染进程。
新增 service 时应保持参数语义简单，并把复杂流程优先下沉到 `src/main/contexts/*/application/`。

## Files

- **acp.ts**: ACP 相关 IPC service，目前仍由主进程注册用于兼容与调试路径
- **agent-runtime.ts**: 统一 Agent Profile 与 Provider 能力的 IPC service
- **chat.ts**: 聊天 IPC service，转发创建、发送、终止与消息读取到 `ChatEngine`
- **cli.ts**: 已废弃的 CLI 兼容模块，当前不再注册
- **dev.ts**: 仅开发模式可用的辅助 IPC，例如打开 `userData` 或强制重载
- **ipc-devtool.ts**: IPC Devtool 事件快照、清理与窗口打开接口
- **preferences.ts**: 应用级聊天偏好持久化接口
- **search.ts**: 线程搜索 IPC service，返回分词后的命中结果与高亮范围
- **session.ts**: 会话数据读取与 provider handle 元数据写入接口
- **skills.ts**: Skills IPC service，负责 global、workspace、agent 三个可写层与 legacy/built-in 只读层的路由
- **usage.ts**: token usage 聚合统计接口
- **workflow-rules.ts**: 工作流规则的读取、保存、删除与列表接口
- **kanban.ts**: Kanban IPC facade，读侧查询与写侧命令分别委托给 `src/main/contexts/kanban/application/`，委派流程由 `src/main/contexts/issue-agent/application/` 编排
