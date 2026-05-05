<!-- Once this directory changes, update this README.md -->

# Main/Features/Chat

Chat feature 负责会话编排、timeline-driven chat projection 与 thread search。
它连接 runtime providers、skills、ACP transport 与 renderer 广播，但 chat 自身只消费 Cradle-owned timeline facts。
把聊天生命周期与搜索规则放在这里；不要把它们散落到 IPC 或窗口层。

## Files

- **chat-engine.ts**: 聊天主编排器，负责 product session 消息写入、timeline 持久化/投影广播，并通过 backend control-plane 管理 binding/run 生命周期
- **thread-search.ts**: 会话线程搜索引擎
- **__tests__/**: chat feature 的主进程回归测试
