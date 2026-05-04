<!-- Once this directory changes, update this README.md -->

# src/main/lib

主进程核心库负责聊天编排、文件系统资源管理与各类系统级能力。
这些模块被 `src/main/services/` 的 IPC Service 组合，对渲染进程暴露后端能力。
这里的约定是 library 只表达领域语义，不直接承载 UI 或路由状态。

## Files

- **acp-connection.ts**: ACP 连接管理器，负责 prompt、session load/resume 与运行时连接状态缓存
- **acp-installer.ts**: ACP 安装器，负责二进制下载、解压与 Agent Profile 元数据写入
- **acp-process-manager.ts**: ACP 子进程生命周期管理与清理
- **acp-registry.ts**: 远程 ACP Registry 拉取与平台过滤
- **acp-responses-converter.ts**: 将 ACP `SessionUpdate` 转换成 OpenAI Responses 风格流事件
- **bundled-resources.ts**: 解析开发态与生产态下 `resources/` 内置资源的真实路径
- **chat-engine.ts**: 聊天主编排器，负责消息写入、响应流广播、会话恢复与 Skills 注入
- **chat-provider.ts**: Provider 抽象接口与聊天流事件载荷类型
- **ipc-devtool-store.ts**: IPC Devtool 事件缓冲与订阅分发
- **ipc-devtool.ts**: Devtool 窗口与观测能力的主进程集成
- **issue-delegation.ts**: Issue 委派领域编排（delegate/run/stop/undelegate），从 IPC service 抽离事务逻辑
- **safe-storage.ts**: Electron `safeStorage` 的安全存储封装
- **skills.ts**: Filesystem-first Skills 库，负责 built-in、legacy、global、workspace、agent 五层扫描、CRUD 与导入导出
- **thread-search.ts**: 基于分词与打分的会话搜索引擎
- **workflow-rules.ts**: 工作流规则文件管理，按 workspace 与 agent profile 分层存储 Markdown 规则
