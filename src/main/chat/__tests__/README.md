<!-- Once this directory changes, update this README.md -->

# Main/Features/Chat/__tests__

这些测试验证聊天编排的关键行为与回归防线。
它们应聚焦 chat feature 自身的语义，而不是 renderer 细节。
当 ChatEngine 责任继续拆分时，这里是最先需要跟进的测试面。

## Files

- **chat-engine.test.ts**: 验证 ChatEngine shell 与 turn executor / watch registry / broadcast subscriber 的核心会话行为，包括 timeline 持久化、提示词边界收缩，以及会话级 timeline 广播
- **projection-parity.test.ts**: 验证 shared timeline projector 在 hydration/live 两条路径上产出的 assistant message/chunks 语义一致
- **thread-search.test.ts**: 验证 thread search 在 FTS fallback 路径上仍会读取 timeline-derived assistant 文本，而不是依赖旧的 assistant message content 快照
- **turn-coordinator.test.ts**: 验证 provider stream 被规整为有序 timeline events 与终止信号
- **turn-state-machine.test.ts**: 验证 shared timeline chunk projector 对 reasoning/tool/text terminal 事件的实时 chunk 语义
