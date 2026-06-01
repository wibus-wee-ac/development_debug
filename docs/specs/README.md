<!--
Input: Repository documentation inventory.
Output: Specs directory inventory.
Position: docs/specs/README.md
-->

# Specs

这个目录保存面向未来实现的产品与能力规格。它不同于 `docs/exec-plans/`：spec 先定义目标、边界、owner、API/UI/data 形态和验收口径；ExecPlan 再把被选中的 spec 变成可执行实施计划。

## Files

- **README.md**: 本目录说明。
- **alma-inspired/**: 从 Alma packaged app 证据和 Cradle 当前能力对比中拆出的 Alma-inspired 功能规格。
- **appshot-capture.md**: Cradle Appshot capture 策略规格，记录 `cradle-native`、`codex-private`、Codex 私有 Apple Event 证据、owner 边界和视觉一致性验收口径。
- **cradle-unified-ui-slots.md**: Cradle 统一 UI 槽位矩阵，记录 provider/native source 到 Cradle 产品槽位和首选产品 surface 的投影关系。
- **jarvis-context-engine.md**: Jarvis Context Engine 规格，整理 VS Code Copilot、GitHub Copilot、Cursor 等现代 IDE AI 的 context 编排方式，并定义 Cradle 的 feature-owned semantic context、attention context、explicit references、retrieval 和 prompt assembly 目标架构。
- **multi-agent-collaboration.md**: Cradle 多 Agent 协作架构规格，记录 single-writer、clean-context reviewer、smart friend、manager delegation 和结构化通信的设计约束。
