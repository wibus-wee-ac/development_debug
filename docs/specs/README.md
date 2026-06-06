# Specs

这个目录保存面向未来实现的产品与能力规格。它不同于 `docs/exec-plans/`：spec 先定义目标、边界、owner、API/UI/data 形态和验收口径；ExecPlan 再把被选中的 spec 变成可执行实施计划。

## Files

- **README.md**: 本目录说明。
- **alma-inspired/**: 从 Alma packaged app 证据和 Cradle 当前能力对比中拆出的 Alma-inspired 功能规格。
- **appshot-capture.md**: Cradle Appshot capture 策略规格，记录 `cradle-native`、`codex-private`、Codex 私有 Apple Event 证据、owner 边界和视觉一致性验收口径。
- **browser-panel-webview-bridge.md**: Browser Panel webview bridge 规格，记录 `window.codex.sendPrompt(...)`、popup routing、Chat prompt ingress，以及 Browser Use plugin 的非 owner 边界。
- **cradle-unified-ui-slots.md**: Cradle 统一 UI 槽位矩阵，记录 provider/native source 到 Cradle 产品槽位和首选产品 surface 的投影关系。
- **jarvis-context-engine.md**: Jarvis Context Engine 规格，整理 VS Code Copilot、GitHub Copilot、Cursor 等现代 IDE AI 的 context 编排方式，并定义 Cradle 的 feature-owned semantic context、attention context、explicit references、retrieval 和 prompt assembly 目标架构。
- **linear-ai-intelligence/**: Linear AI Intelligence 规格集，基于 Linear Triage Intelligence、Code Intelligence、Linear Agent 和 developer agent protocol 调研，定义 Cradle 的 `work-intelligence`、`code-intelligence` 和 `agent-interaction-runtime` 目标架构。
- **linear-diffs/**: Linear Diffs / Reviews 调研、覆盖矩阵与 Cradle Diff Review 规格，定义独立 `diff-review` owner、source adapter、review lifecycle、agent fix loop、structural highlighting、guided review 和后续会话恢复 prompt。
- **multi-agent-collaboration.md**: Cradle 多 Agent 协作架构规格，记录 single-writer、clean-context reviewer、smart friend、manager delegation 和结构化通信的设计约束。
- **multica-inspired/**: Multica 调研与 Cradle 目标规格，覆盖 agent teammate、runtime/task lifecycle、skills/templates、squads/autopilots、external ingress、clean architecture 和后续会话恢复 prompt。
- **multi-agent-pattern-matrix.md**: Multi Agent pattern 覆盖矩阵，逐项映射 `multi-agent.wiki` 全部协作模式到 Cradle 的 adopt/support/constrain/defer 策略、owner、插点和验收标准。
- **multi-agent-runtime-architecture.md**: Multi Agent runtime 技术规格，定义 future `agent-orchestration`、task registry、context policy、blackboard、event log、guardrails、workspace isolation 和 MCP/A2A/ACP 协议网关边界。
- **multi-agent-continuation-prompt.md**: Multi Agent 调研证据、恢复命令和后续会话 prompt，用于重启 Cradle multi-agent collaboration 设计或实现工作。
- **search-as-code-generation.md**: Search as Code Generation 规格，基于 Perplexity SaC 调研定义 Cradle 的 agentic-search-runtime、sandbox、SDK primitive、artifact、skill、eval 和实现 Prompt。
- **search-as-code-generation-handoff.md**: Search as Code Generation 后续会话恢复手册，记录外部依据、当前判断、恢复 Prompt 和实现入口。
