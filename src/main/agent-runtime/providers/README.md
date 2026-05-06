<!-- Once this directory changes, update this README.md -->

# Main/Agent Runtime/Providers

Concrete provider implementations live here.
Each provider translates one runtime family into the shared Agent Runtime contracts.
Keep provider-specific protocol parsing out of higher-level services.

## Files

- **acp-chat-provider.ts**: ACP chat provider，透传 ACP timeline mapper 输出的 typed timeline 事件并负责 session 建立/恢复
- **cli-tui-provider.ts**: CLI/TUI provider，负责终端型 agent profile 的会话生命周期
- **openai-compatible-provider.ts**: OpenAICompatibleProvider validates Base URL/API key profile config, streams chat completions, maps text / reasoning / tool-call deltas into typed timeline facts, emits an explicit placeholder output when a tool call completes without runtime execution, and normalizes user-triggered aborts so cancelled turns do not finalize as completed.
