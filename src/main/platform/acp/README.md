<!-- Once this directory changes, update this README.md -->

# Main/Platform/ACP

ACP platform bucket 负责 registry、安装、进程生命周期与协议 transport。
这些模块被 `AcpService` 与 ACP runtime providers 复用，提供统一的 ACP 基础设施。
把 ACP 专属 plumbing 放在这里；更高层的聊天或 issue workflow 不应落到本目录。

## Files

- **acp-connection.ts**: ACP 连接管理器，负责 prompt、session load/resume 与运行时状态缓存
- **acp-installer.ts**: ACP 安装器，负责二进制下载、解压与安装元数据持久化
- **acp-process-manager.ts**: ACP 子进程生命周期管理与清理
- **acp-registry.ts**: 远程 ACP registry 拉取与平台过滤
- **acp-responses-converter.ts**: 将 ACP `SessionUpdate` 转换成 OpenAI Responses 风格流事件
- **__tests__/**: ACP platform 回归测试
