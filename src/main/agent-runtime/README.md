<!-- Once this directory changes, update this README.md -->

# Main/Features/Agent Runtime

Agent Runtime feature 统一管理 provider catalog、profile 元数据与凭证协作。
它对上服务于 app/ipc，对下编排具体 runtime providers。
把 provider 选择、模型探测与凭证边界放在这里，而不是散落到聊天或窗口层。

## Files

- **agent-runtime.ts**: profile CRUD、provider health check/listModels、credential、审计与 health-check capability capture 的 feature-owned application service 与 DB stores
- **catalog-instance.ts**: provider catalog 的进程级单例初始化与访问入口
- **credential-vault.ts**: 统一的凭证加密、解密与脱敏元数据逻辑
- **provider-catalog.ts**: Provider 注册与查找容器
- **runtime-provider-types.ts**: runtime provider 合约、profile 类型与共享数据结构；chat providers 直接输出 typed timeline 输入事件
- **providers/**: ACP、CLI TUI、OpenAI-compatible 等具体 provider 实现
- **__tests__/**: provider contract 与 credential 行为测试
