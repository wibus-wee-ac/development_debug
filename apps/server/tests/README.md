<!--
Output: apps/server test inventory.
Input: Vitest suites for server foundation and capabilities.
Position: apps/server/tests index.
-->

# Server Tests

Profile/provider integration suites now exercise typed `config` objects at HTTP boundaries instead of opaque `configJson` strings, keeping the test surface aligned with OpenAPI-facing request schemas.

## Files

- **config.test.ts**: server config parsing and validation.
- **agent-runtime-config.test.ts**: runtime config JSON helper preservation for cli-tui launch and Codex session bindings.
- **elysia-skeleton.test.ts**: parallel Elysia migration coverage for `/health`, `/preferences/chat`, structured validation normalization, `/openapi.json`, and `/docs/openapi.json` compatibility.
- **request-id.test.ts**: request-id middleware behavior.
- **openapi.test.ts**: generated OpenAPI JSON exposure, Scalar docs UI route, DTO-backed request schema coverage, and `ApiDoc.responses` response-schema coverage.
- **exception-filter.test.ts**: AppError normalization.
- **database.test.ts**: database lifecycle migrations.
- **health.test.ts**: health endpoint response.
- **approval.test.ts**: in-memory pending approval registry create/list/respond flows and structured errors.
- **workspace.test.ts**: workspace capability CRUD + file IO.
- **session.test.ts**: session capability CRUD + messages + markdown export.
- **session-await.test.ts**: session await/resume lifecycle, pending states, and resume semantics.
- **chat-runtime.test.ts**: chat run execution, strict snapshot hydration, SSE `message_delta` sequencing, usage writes, and abort flow.
- **kanban.test.ts**: kanban board shell, default status seeding, issue core loop, and comments core loop.
- **issue-agent.test.ts**: issue delegation, activity timeline, rerun, and undelegation flows.
- **git.test.ts**: workspace-owned git status, branches, commit graph, checkout, and create-branch flows.
- **observability.test.ts**: observability event persistence, incident rules, empty-output failure semantics, and bundle export.
- **preferences.test.ts**: server-owned chat preference defaults, JSON persistence, and invalid payload handling.
- **fetch-retry.test.ts**: retry/backoff helpers for outbound HTTP integrations.
- **pty.test.ts**: session-owned cli-tui terminal runtime, SSE stream, input, replay, and cleanup.
- **pty-websocket.test.ts**: PTY WebSocket live channel, reconnect, delete-session teardown, and cli-tui session ownership semantics.
- **codex-session-capture.test.ts**: Codex CLI JSONL metadata capture rules for cli-tui resume bindings.
- **agent.test.ts**: agent identity capability CRUD + filters + avatar URL policy.
- **workflow-rules.test.ts**: workflow-rules HTTP CRUD + filesystem ownership.
- **profiles.test.ts**: profile CRUD, secret masking, and provider metadata endpoints.
- **sdk-providers.test.ts**: unified Claude Agent / Codex metadata probing, model listing, `/chat` execution flows, and subagent delta routing contracts.
- **acp.test.ts**: ACP registry browsing, install lifecycle, installed-agent inventory, and audit queries.
- **acp-chat-runtime.test.ts**: unified ACP chat execution, approval routing, session-title sync, and usage persistence.
- **skills.test.ts**: skills inventory, CRUD, import/export, and fetch-source flows across scopes.
- **usage.test.ts**: usage analytics daily totals, summary, streak stats, and per-session totals.
- **search.test.ts**: thread search over titles, user content, and assistant plain-text cache derived from `messages.content`.
- **pack-codebase.test.ts**: workspace-owned repomix packing over HTTP and structured validation errors.
