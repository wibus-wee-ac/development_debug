<!-- Once this directory changes, update this README.md -->

# Main/App/IPC

这些 app-owned IPC adapters 暴露主进程能力给 renderer 与 CLI，同时保持 transport 层尽量薄。
它们负责输入输出整形与路由，不负责 feature 业务语义本身。
若某段逻辑开始像 use case 或 orchestrator，就应下沉到 `features/` 或 `platform/`。

## Files

- **acp.ts**: ACP feature application service 的薄 IPC adapter，转发 registry、安装状态、runtime session 与审计查询
- **agent.ts**: Agent identity 的 CRUD IPC adapter
- **agent-runtime.ts**: agent-runtime feature 的薄 IPC adapter，转发 profile、probe、models 与凭证命令
- **chat.ts**: ChatEngine 的会话创建、发送、终止、消息读取，以及 renderer 会话级 timeline watch / unwatch 接口
- **dev.ts**: 仅开发模式可用的辅助 IPC，如打开目录与强制重载
- **git.ts**: Git 状态、分支与提交图相关 IPC adapter
- **ipc-devtool.ts**: devtool 窗口、事件快照与清理接口
- **issue-agent.ts**: issue delegation 与 agent session/activity 查询的 IPC adapter，并负责默认 store/runner 装配
- **kanban.ts**: Kanban 查询与写侧命令的 IPC adapter
- **preferences.ts**: 全局聊天偏好持久化接口
- **pty.ts**: PTY 会话创建、写入、调整尺寸与进程控制接口
- **search.ts**: 会话线程搜索接口
- **session.ts**: 会话元数据与消息读取接口；backend handle/model 由 control-plane feature 持久化
- **skills.ts**: skills inventory、创建、导入与来源抓取接口
- **usage.ts**: token usage 聚合统计接口
- **window.ts**: tear-off 窗口管理接口
- **workflow-rules.ts**: workflow rules 的读取、保存、删除与列表接口
- **workspace.ts**: workspace feature application service 的薄 IPC adapter，仅保留目录选择与 shell 打开等 transport helper
