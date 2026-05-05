<!-- Once this directory changes, update this README.md -->

# Main/Features/Chat

Chat feature 负责会话编排、provider 抽象与 thread search。
它连接 runtime providers、skills、ACP transport 与 renderer 广播，但仍由 chat 语义统一拥有。
把聊天生命周期与搜索规则放在这里；不要把它们散落到 IPC 或窗口层。

## Files

- **chat-engine.ts**: 聊天主编排器，负责消息写入、响应流广播、会话恢复与 Skills 注入
- **chat-provider.ts**: provider 抽象接口与聊天流事件载荷类型
- **thread-search.ts**: 会话线程搜索引擎
- **__tests__/**: chat feature 的主进程回归测试
