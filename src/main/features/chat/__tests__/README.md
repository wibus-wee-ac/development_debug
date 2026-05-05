<!-- Once this directory changes, update this README.md -->

# Main/Features/Chat/__tests__

这些测试验证聊天编排的关键行为与回归防线。
它们应聚焦 chat feature 自身的语义，而不是 renderer 细节。
当 ChatEngine 责任继续拆分时，这里是最先需要跟进的测试面。

## Files

- **chat-engine.test.ts**: 验证 ChatEngine 的核心会话与流式行为
