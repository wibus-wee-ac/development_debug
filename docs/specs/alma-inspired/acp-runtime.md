<!--
Input: Alma ACP evidence and Cradle ACP module audit.
Output: Spec for ACP runtime coverage.
Position: docs/specs/alma-inspired/acp-runtime.md
-->

# ACP Runtime

## 目标

Cradle 应继续把 ACP 作为 first-class runtime 和安装能力。Alma 证据只说明 ACP 属于本地 AI desktop 的合理能力面，不需要照搬 Alma 的实现。

## Alma 证据

Alma 依赖 `@mcpc-tech/acp-ai-provider` 和 `acpx`，有 provider/session cleanup 证据，并把 ACP 暴露为 provider type。

## Cradle 当前状态

Cradle 已有 ACP registry、distribution types、install/cancel/uninstall、audit log、install path、chat runtime integration、process supervisor、connection/session manager、approvals bridge 和 MCP server forwarding。

## Owner / Namespace

`apps/server/src/modules/acp` 拥有安装生命周期和 audit。`chat-runtime/providers/acp` 拥有 ACP chat session 语义。Web settings 与 agent runtime surfaces 只读取这些 APIs。

## 目标行为

- ACP install lifecycle 保持 server-owned 且可审计。
- ACP runtime session 走统一 chat runtime 与 approval contracts。
- ACP 通过只读 registry projection 接收 plugin/user MCP servers。

## 验收

- Installed ACP agent 可以作为 chat runtime profile 使用。
- Uninstall ACP agent 后不能创建新 session，但 audit history 保留。
- ACP failure 进入 observability，并包含可操作 error code。
