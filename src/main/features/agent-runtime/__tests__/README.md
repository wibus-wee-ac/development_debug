<!-- Once this directory changes, update this README.md -->

# Main/Features/Agent Runtime/__tests__

这些测试验证 runtime provider 合约、凭证处理与 provider catalog 行为。
它们优先证明运行时边界，而不是 UI 或 IPC 细节。
修改 provider 接口、凭证策略或 catalog 规则时，应先更新这里。

## Files

- **agent-runtime-application.test.ts**: 验证 feature-owned agent runtime application service 的 profile、probe、models 与 credential 协调行为
- **credential-vault.test.ts**: 验证凭证保存、读取与脱敏逻辑
- **openai-compatible-provider.test.ts**: 验证 OpenAI-compatible provider 的请求与恢复行为
- **provider-catalog.test.ts**: 验证 provider catalog 的注册与解析语义
