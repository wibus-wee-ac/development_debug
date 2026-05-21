<!--
Input: Alma ACP evidence and Cradle ACP module audit.
Output: Spec for ACP runtime coverage.
Position: docs/specs/alma-inspired/acp-runtime.md
-->

# ACP Runtime

## Goal

Cradle should keep ACP as a first-class runtime and installation capability, while using Alma only as confirmation that ACP belongs in the local AI desktop category.

## Alma Evidence

Alma depends on `@mcpc-tech/acp-ai-provider` and `acpx`, has provider/session cleanup evidence, and exposes ACP as a provider type.

## Cradle Current State

Cradle already has ACP registry, distribution types, install/cancel/uninstall, audit log, install path, chat runtime integration, process supervisor, connection/session manager, approvals bridge, and MCP server forwarding.

## Target Ownership

`apps/server/src/modules/acp` owns install lifecycle and audit. `chat-runtime/providers/acp` owns ACP chat session semantics. Web settings and agent runtime surfaces read these APIs.

## Target Behavior

- ACP install lifecycle remains server-owned and auditable.
- ACP runtime sessions use the unified chat runtime and approval contracts.
- ACP receives plugin/user MCP server records only through a read-only registry projection.

## API Sketch

Current APIs are sufficient for baseline coverage. Future additions should focus on diagnostics, upgrade checks, and per-agent capability display.

## Acceptance

- Installed ACP agents can be used as chat runtime profiles.
- Uninstalling an ACP agent prevents new sessions and preserves audit history.
- ACP failures appear in observability with actionable error codes.
