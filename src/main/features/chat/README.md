<!-- Once this directory changes, update this README.md -->

# Main/Features/Chat

Chat feature 负责会话编排、timeline-driven chat projection 与 thread search。
它连接 runtime providers、ACP transport 与 renderer 广播，但 chat 自身只消费 Cradle-owned timeline facts。
把聊天生命周期与搜索规则放在这里；不要把它们散落到 IPC 或窗口层。

## Files

- **chat-engine.ts**: 聊天主编排器，负责 product session 消息写入、事务化 timeline→assistant snapshot 投影、会话级 timeline 广播，以及 backend control-plane binding/run 生命周期
- **chat-turn-context.ts**: 单回合上下文解析器，只组装 agent-owned system prompt 与历史消息，不再把 bundled workflow / skills catalog 塞进模型上下文
- **chat-turn-persistence.ts**: 事务化持久化助手，把 timeline event、assistant message snapshot、session updatedAt 与 terminal run 状态一起提交
- **chat-turn-projector.ts**: 单回合 assistant message 投影器，把 Cradle timeline facts 映射为持久化 UIMessage 快照与 renderer 复用的 chat chunks
- **thread-search.ts**: 会话线程搜索引擎
- **__tests__/**: chat feature 的主进程回归测试
