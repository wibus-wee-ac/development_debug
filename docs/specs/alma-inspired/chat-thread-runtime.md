<!--
Input: Alma chat/thread route evidence and Cradle chat runtime audit.
Output: Spec for chat/thread runtime coverage.
Position: docs/specs/alma-inspired/chat-thread-runtime.md
-->

# Chat Thread Runtime

## Goal

Cradle should keep chat runtime as the canonical execution surface for user messages, agent runs, tool calls, approvals, usage, and session persistence.

## Alma Evidence

Alma exposes chat completions, threads, messages, rollback, branch, compact, switch, WebSocket generation, tool calls, citations, command surfaces, and external channel mapping to threads.

## Cradle Current State

Cradle already has `chat-runtime`, `session`, `approval`, `usage`, `issue-agent`, and provider registry integration. It supports SSE deltas, persisted snapshots, cancellation, subagent routing, approvals, and multiple runtime kinds.

## Target Ownership

`apps/server/src/modules/chat-runtime` owns execution. `session` owns session metadata and export. Feature owners may attach context, but they do not own the chat run lifecycle.

## Target Behavior

- Prompt Apps, Quick Chat, Channels, and Share call into chat runtime rather than creating separate generation systems.
- External channel messages map to Cradle sessions through a channel owner.
- Branching, compaction, and rerun semantics remain server-owned.

## API / IPC Sketch

Reuse existing `/chat/sessions/:sessionId/*` APIs. New callers pass provenance metadata such as `sourceKind`, `sourceId`, and `workspaceId`.

## Acceptance

- A Prompt App run and a Quick Chat message produce normal session messages.
- Usage and approvals are recorded through existing runtime contracts.
- External source metadata does not break existing session export.
