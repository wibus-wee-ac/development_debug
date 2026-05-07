<!-- Once this directory changes, update this README.md -->

# Main/Features/Chat

Chat feature 负责会话编排、timeline-driven persistence/query 与 thread search。
它连接 runtime providers、ACP transport 与 renderer 广播，但把 turn 执行、读模型、订阅注册、标题同步拆成显式模块，而不是塞回单个 engine。
把聊天生命周期与搜索规则放在这里；不要把它们散落到 IPC 或窗口层。

## Files

- **chat-engine.ts**: 薄 shell，只负责 chat session 生命周期、provider session continuity、control-plane binding 与 turn executor 装配
- **chat-turn-executor.ts**: in-flight turn runtime，拥有 draft/abort 状态、流式执行循环、timeline 持久化与 chat 领域事件发布
- **chat-turn-context.ts**: 单回合上下文解析器，只组装 agent-owned system prompt 与历史消息；assistant 历史文本通过统一 timeline query helper 回放
- **timeline-event-sink.ts**: 显式写侧 sink；负责把单个 timeline event 持久化并发布 `chat.timeline-event-persisted` 领域事件，避免 `executeTurn()` 内联巨大闭包
- **timeline-query.ts**: chat 读侧查询；按 `backend_runs.messageId -> backend_timeline_events.runId` 为 renderer hydration、导出和搜索重建提供精确 timeline/assistant 文本
- **session-watch-registry.ts**: chat session 订阅注册表，拥有 `WebContents × session` ref-count，而不是让 ChatEngine 管理 transport 细节
- **session-title-sync.ts**: ACP title → chat session title 同步桥，作为 composition-root integration wiring 独立存在
- **turn-repository.ts**: 事务化 timeline 持久化仓储；assistant message content 不再写入 UIMessage JSON，delta 写入可 debounce
- **broadcast.ts**: 订阅 chat timeline 领域事件，并通过 signal broadcaster 推送 raw timeline event 给显式 watch 了 session 的 renderer；实时 chunks 投影现在在 renderer 本地完成
- **thread-search.ts**: 会话线程搜索引擎；legacy fallback、增量索引与 rebuild 都以 timeline-derived assistant 文本为准，不再解析旧 UIMessage JSON content
- **__tests__/**: chat feature 的主进程回归测试
