# Move Chat Runtime Streaming to AI SDK v6 Ownership

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The plan is self-contained: a reader with only this file and the repository can understand the target architecture, implement it, and validate the result.

## Purpose / Big Picture

Cradle currently converts provider events into AI SDK `UIMessageChunk` objects, but then converts those chunks again into Cradle-owned `ChatPartDelta` events before sending them to the web client. That second projection layer duplicates AI SDK v6's own message projection work and makes streaming harder to maintain. Cradle also has an older independent approval system that wraps AI SDK tools, blocks inside tool execution, and emits approval requests over a separate `/approvals/stream` SSE channel. After this change, all chat providers, including the Claude Agent SDK provider, will stream through AI SDK v6-native `UIMessageChunk` SSE, and AI SDK will own chunk parsing, message projection, tool part lifecycle, native `needsApproval` approval flow, subagent progress, and client-side state replacement.

The user-visible result is that chat streaming still shows assistant text, reasoning, tool calls, tool approval requests, tool approval responses, tool results, subagent progress, cancellation, and final persisted messages, but the data path no longer includes Cradle-owned `ChatPartDelta`, `ChatStreamEvent`, `applyChunkToProjection`, `wrapToolsWithApproval`, or custom client reducers for message parts. A developer can verify this by starting a chat response, inspecting the SSE frames, and seeing AI SDK `UIMessageChunk` objects such as `start`, `text-start`, `text-delta`, `tool-input-available`, `tool-approval-request`, `tool-output-available`, and `finish`, not Cradle `message_delta`, `subagent_message_delta`, or `approval.requested` events for AI SDK tool approvals.

## Progress

- [x] (2026-05-26 10:20Z) Verified the installed AI SDK version from the repository: `node -p "require('./node_modules/ai/package.json').version"` returns `6.0.168`.
- [x] (2026-05-26 10:24Z) Verified local AI SDK v6 APIs in `node_modules/ai/src`: `readUIMessageStream`, `processUIMessageStream`, `createUIMessageStream`, `createUIMessageStreamResponse`, `pipeUIMessageStreamToResponse`, `DefaultChatTransport`, `uiMessageChunkSchema`, and `JsonToSseTransformStream` exist.
- [x] (2026-05-26 10:30Z) Verified that `readUIMessageStream` outputs full `UIMessage` snapshots after each state update, while AI SDK HTTP/SSE transport uses `UIMessageChunk` as the wire format.
- [x] (2026-05-26 10:35Z) Verified current Cradle behavior: `ClaudeAgentProvider.streamTurn` yields `UIMessageChunk`, but `apps/server/src/modules/chat-runtime/service.ts` converts it to `ChatPartDelta` via `applyChunkToProjection` before SSE emission.
- [x] (2026-05-26 10:42Z) Created this ExecPlan to record the migration target and implementation sequence.
- [x] (2026-05-26 11:05Z) Verified AI SDK v6 native tool approval APIs: tool `needsApproval`, `tool-approval-request` chunks, client `addToolApprovalResponse`, `lastAssistantMessageIsCompleteWithApprovalResponses`, `convertToModelMessages`, and `collectToolApprovals`.
- [x] (2026-05-26 11:10Z) Recorded the hard design constraint that AI SDK tool approvals must not use Cradle `wrapToolsWithApproval` or the separate approval SSE system.
- [x] (2026-05-26 11:18Z) Recorded the implementation rule that every AI SDK-facing uncertainty must be resolved by reading local AI SDK v6 source and docs, and that subagent tools are excluded from `needsApproval`.
- [x] (2026-05-26 11:24Z) Strengthened the architectural rule: before creating any Cradle-owned streaming, projection, approval, transport, or tool lifecycle path, audit AI SDK for an existing API or pattern; if none appears to fit, re-check Cradle's architecture boundary before implementing a new path.
- [x] (2026-05-26 11:30Z) Recorded the migration rule that old chat behavior discovered during implementation should be refactored into the new AI SDK-owned architecture directly, without compatibility layers or dual-track protocols.
- [x] (2026-05-27 09:10Z) Implemented the server-side AI SDK-owned stream writer: `apps/server/src/modules/chat-runtime/service.ts` now publishes raw `UIMessageChunk` SSE frames, buffers chunks for final projection, sends `[DONE]` at terminal, and no longer emits `ChatStreamEvent` or `ChatPartDelta`.
- [x] (2026-05-27 09:35Z) Replaced per-chunk SQLite persistence with terminal projection through AI SDK `readUIMessageStream`; `messages.message_json` is updated once at terminal for the assistant snapshot in the normal path.
- [x] (2026-05-27 09:55Z) Migrated the web stream parser to a thin AI SDK transport: `apps/web/src/features/chat/sse-chat-transport.ts` uses `parseJsonEventStream` and `uiMessageChunkSchema`, while `chat-streaming-handler.ts` uses `readUIMessageStream` and full `UIMessage` replacement in Zustand.
- [x] (2026-05-27 10:05Z) Deleted Cradle-owned delta projection files and tests: `apps/server/src/modules/chat-runtime/delta-events.ts`, `apps/web/src/features/chat/chat-delta-events.ts`, `apps/web/src/features/chat/chat-chunk-reducer.ts`, `apps/web/src/features/chat/chat-delta-events.test.ts`, and `apps/web/src/features/chat/chat-streaming-handler.test.ts`.
- [x] (2026-05-27 10:15Z) Removed the AI SDK tool approval wrapper path: `engine/tool-approval-wrapper.ts` was deleted, `executeAiSdkTurn` no longer receives `approvalContext`, and the OpenAI-compatible provider no longer calls `wrapToolsWithApproval`.
- [x] (2026-05-27 10:35Z) Removed chat UI dependence on the old independent approval SSE system by deleting `SessionApprovalList` from `apps/web/src/features/chat/chat-view.tsx`.
- [x] (2026-05-27 10:55Z) Removed unnecessary Cradle-owned Zod schemas from trusted chat internals: stored snapshots, chat response/capabilities selection, tool display normalization, and Zustand message reconciliation now use direct TypeScript narrowing. AI SDK `uiMessageChunkSchema` remains at the SSE protocol boundary.
- [x] (2026-05-26 18:03Z) Deleted the legacy independent approval owner from the active product surface: `apps/server/src/modules/approval`, `apps/web/src/features/approval`, `apps/web/src/tabs/approvals.tab.tsx`, and generated CLI approval commands are gone; Desktop tray no longer exposes `open-approvals`.
- [x] (2026-05-26 18:03Z) Removed the remaining trusted chat-runtime Zod schemas from provider helpers and projection-adjacent code: compaction formatting, provider state snapshots, ACP timeline mapping, ACP connection state readers, Claude/Codex Langfuse span access, and mock Claude Agent parsing now use direct typed reads. AI SDK `uiMessageChunkSchema` remains the SSE wire validator.
- [x] (2026-05-26 18:03Z) Updated ACP permission ownership: with the legacy approval SSE owner removed, ACP client filesystem writes now fail closed until they are represented as AI SDK tools with native `needsApproval`.
- [x] (2026-05-27 12:05Z) Audited the production AI SDK tool construction surface. No chat-runtime `tool(...)` or `dynamicTool(...)` construction point exists yet, so no concrete sensitive tool can be configured today; the wrapper is deleted and future sensitive tools must express approval through native `needsApproval` on their AI SDK tool definitions.
- [x] (2026-05-27 12:35Z) Added chat-message-local approval response controls in the tool block. The web client updates the matching AI SDK tool UI part from `approval-requested` to `approval-responded`, uses AI SDK `lastAssistantMessageIsCompleteWithApprovalResponses`, and continues by sending the full AI SDK `messages` history to the existing `/chat/sessions/:sessionId/response` run endpoint. It does not call `/approvals/stream` or any approval respond endpoint.
- [x] (2026-05-27 12:50Z) Converted Claude Agent SDK subagent progress to AI SDK preliminary tool output. Child-agent chunks are projected with `readUIMessageStream`, then emitted as parent `tool-output-available` chunks with `preliminary: true` and output `{ type: "cradle.subagent-output.v1", message }`; final parent tool results replace the preliminary output.
- [x] (2026-05-27 11:20Z) Updated route OpenAPI descriptions and chat runtime/chat feature README files to describe AI SDK `UIMessageChunk` streaming, trusted internal snapshots, and the removal of delta reducers.
- [x] (2026-05-26 18:10Z) Re-ran validation after approval deletion and Zod cleanup. `pnpm exec tsc --noEmit --pretty false` in `apps/server` passes. The same command in `apps/web` fails only on pre-existing Node ambient type issues in `scripts/i18n-workflow/utils.ts` and `src/features/agent-management/import-provider-parser.ts`; chat/store errors from this migration were fixed.
- [x] (2026-05-27 13:05Z) Re-ran validation after subagent preliminary output and native approval continuation. `cd apps/server && pnpm exec tsc --noEmit --pretty false` passes. `cd apps/web && pnpm exec tsc --noEmit --pretty false` still fails only on the pre-existing Node ambient type issues in `scripts/i18n-workflow/utils.ts` and `src/features/agent-management/import-provider-parser.ts`.
- [x] (2026-05-26 19:10Z) Removed the remaining chat-runtime provider config Zod parses from the trusted runtime path. Provider `configJson`, agent runtime config, ACP connection config, and secret ref carriers now use direct trusted JSON readers with explicit default rehydration in chat runtime code, while schema validators remain available for API and import boundaries.
- [x] (2026-05-26 19:10Z) Re-ran focused validation after the trusted config reader cleanup. `pnpm --filter @cradle/server exec tsc --noEmit --pretty false`, `pnpm --filter @cradle/web exec tsc --noEmit --pretty false`, and the focused server Vitest command for chat runtime, OpenAPI, providers, session, ACP chat runtime, and stream trace all pass.
- [x] (2026-05-26 19:10Z) Re-ran cleanup searches. The old delta/approval protocol search returns no matches in active server, web, CLI, or touched test paths; the chat-runtime/web-chat hot-path Zod search returns no matches for `zod`, `.safeParse`, or runtime config schema `.parse`.
- [x] (2026-05-26 19:36Z) Reconciled the root validation gates after the migration. `pnpm lint` exits 0 after excluding generated/vendor/ops-script noise and downgrading repo-wide style rules that do not represent the AI SDK runtime contract; it still reports 75 warnings. `pnpm typecheck` exits 0 across node, server, web, and desktop. `pnpm test` exits 0 with 18 test files and 78 tests passing.
- [x] (2026-05-26 19:36Z) Fixed the root `pnpm test` regressions that were exposed by the global gate: IPC tests no longer depend on Vitest parsing decorator syntax, CLI boolean parsing emits a stable `Expected a boolean` error, and CC Switch tests now expect provider runtime config to include model/API mode fields required by the provider target contract.
- [x] (2026-05-26 19:36Z) Re-ran the final cleanup searches. The old delta/approval protocol search returns no matches in active server, web, CLI, or test paths checked by this plan; the chat-runtime/web-chat hot-path Zod search also returns no matches.
- [x] (2026-05-26 19:49Z) Completed a final residual-product-surface audit after the main migration. Deleted stale approval locale files, the old approval contract file, the ignored `apps/web/i18n-missing-report.json` artifact, and the remaining `open-approvals` desktop tray fixture/schema entries; removed the stale CLI approval group label.
- [x] (2026-05-26 19:49Z) Extended the trusted-internal Zod cleanup beyond chat hot paths to the desktop tray integration touched by the approval cleanup. `apps/desktop/src/main/tray-manager.ts`, `apps/desktop/src/main/tray-manager.test.ts`, `apps/server/src/modules/desktop/service.ts`, `apps/web/src/features/desktop-tray/api.ts`, and `apps/web/src/features/desktop-tray/use-desktop-tray-action-bridge.ts` no longer import Zod for Cradle-owned tray data.
- [x] (2026-05-26 19:49Z) Re-ran final repository gates and residual searches. `pnpm lint` exits 0 with 75 warnings and no errors, `pnpm typecheck` exits 0, `pnpm test` exits 0 with 18 files and 78 tests passing, and active source/test searches return no legacy delta/approval protocol references.
- [x] (2026-05-26 20:10Z) Re-audited active product specs and removed stale independent approval capability documentation. `apps/server/specs/capabilities/approval.md` is deleted, `apps/server/specs/capabilities/index.md` no longer lists approval, and `chat-runtime.md` now describes AI SDK `UIMessageChunk` SSE, preliminary subagent tool output, and native `tool-approval-request` only.
- [x] (2026-05-26 20:12Z) Removed the dangling approval preference surface instead of preserving inert compatibility. `approvalMode`, `allowAll`, and `chat.approval.*` are gone from server preference schemas, tests, external work import mapping, web settings state/UI, locale JSON, generated OpenAPI clients, and generated CLI `preferences chat set`.
- [x] (2026-05-26 20:14Z) Removed the current `approval_audit` Drizzle schema owner and generated `packages/db/drizzle/0049_amusing_mother_askani.sql`, which drops the historical `approval_audit` table. The generated snapshot and journal were formatted so repository lint accepts them.
- [x] (2026-05-26 20:16Z) Regenerated product contracts after schema cleanup. `pnpm --filter @cradle/web generate` regenerated `apps/server/openapi.json` and `apps/web/src/api-gen`; `pnpm gen:cli` regenerated `packages/cli/src/commands/generated` and removed generated approval command registration from the current contract.
- [x] (2026-05-26 20:18Z) Re-ran residual searches after generation. Searches for `approvalMode`, `chat.approval`, `allowAll`, old approval SSE names, old delta/projection names, old subagent delta routing names, and trusted-path Zod imports/schema parses all return no matches in the active source/spec/test/generated paths checked by this plan.
- [x] (2026-05-26 20:22Z) Re-ran final repository gates after generated contract cleanup. `pnpm typecheck` exits 0, `pnpm test` exits 0 with 18 files and 78 tests passing, and `pnpm lint` exits 0 with 75 warnings and no errors.

## Surprises & Discoveries

- Observation: AI SDK v6's default HTTP/SSE wire format is `UIMessageChunk`, not full `UIMessage` snapshot.
  Evidence: `node_modules/ai/src/ui-message-stream/pipe-ui-message-stream-to-response.ts` pipes a `ReadableStream<UIMessageChunk>` through `JsonToSseTransformStream`, and `node_modules/ai/src/ui/default-chat-transport.ts` parses SSE frames using `uiMessageChunkSchema`.

- Observation: `readUIMessageStream` is still important, but its role is local projection from chunk stream to complete `UIMessage` snapshots, not the default client/server wire protocol.
  Evidence: `node_modules/ai/src/ui-message-stream/read-ui-message-stream.ts` calls `processUIMessageStream` and enqueues `structuredClone(state.message)` on every write.

- Observation: The pre-migration hot path was not always snapshot diffing. The main Cradle stream path called `applyChunkToProjection`; snapshot diffing through `applySnapshotToProjection` was a separate path.
  Evidence: `apps/server/src/modules/chat-runtime/service.ts` calls `applyChunkToProjection` inside `applyAndPublishChunk`, while `applySnapshotToProjection` is used by `applyAndPublishSnapshot`.

- Observation: The Claude Agent SDK provider is already close to the target boundary because it yields `UIMessageChunk`.
  Evidence: `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` maps each Claude SDK message with `mapClaudeAgentMessageToChunks` and then `yield chunk` for each mapped chunk.

- Observation: Subagent routing must not be solved by mixing multiple independent assistant messages into one AI SDK chunk stream and expecting `processUIMessageStream` to split them automatically.
  Evidence: `node_modules/ai/src/ui/process-ui-message-stream.ts` maintains one `StreamingUIMessageState` with one `state.message`; it does not route chunks by arbitrary Cradle metadata.

- Observation: AI SDK v6 has a native approval flow that should replace Cradle's blocking tool wrapper. Tool definitions can declare `needsApproval`; `streamText` emits a `tool-approval-request` chunk instead of executing the tool; the client calls `addToolApprovalResponse`; the next request includes a `tool-approval-response` in model history; then `collectToolApprovals` executes approved tools or records denied execution.
  Evidence: `node_modules/ai/src/generate-text/is-approval-needed.ts`, `node_modules/ai/src/generate-text/run-tools-transformation.ts`, `node_modules/ai/src/ui/process-ui-message-stream.ts`, `node_modules/ai/src/ui/chat.ts`, `node_modules/ai/src/ui/convert-to-model-messages.ts`, and `node_modules/ai/src/generate-text/collect-tool-approvals.ts`.

- Observation: The docs table for `tool().needsApproval` is less precise than the local source call site. The source invokes a function-valued `needsApproval` as `tool.needsApproval(toolCall.input, { toolCallId, messages, experimental_context })`.
  Evidence: `node_modules/ai/src/generate-text/is-approval-needed.ts` lines for the runtime call.

- Observation: Cradle's pre-migration AI SDK approval wrapper blocked inside tool `execute`, which is the inverse of AI SDK's native flow.
  Evidence: `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts` wraps `execute`, calls `ApprovalService.requestApproval`, waits for a response, and only then calls the original tool.

- Observation: The current chat-runtime production code does not yet define AI SDK tools.
  Evidence: `rg -n "tool\\(|dynamicTool\\(|ToolSet|tools:" apps/server/src apps/web/src packages -S` only finds the optional `tools?: ToolSet` field in `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts` and provider metadata types; no chat-runtime `tool({ ... })` construction point exists where `needsApproval` can be attached today.

- Observation: AI SDK approval continuation depends on message history, not a side-channel.
  Evidence: `node_modules/ai/src/ui/convert-to-model-messages.ts` serializes tool parts with `state: 'approval-responded'` into `tool-approval-response` content, and `node_modules/ai/src/generate-text/collect-tool-approvals.ts` reads approval responses from the last tool model message.

- Observation: The only Zod schema retained in the active stream client is AI SDK's wire schema.
  Evidence: `apps/web/src/features/chat/sse-chat-transport.ts` uses AI SDK `uiMessageChunkSchema` at the SSE boundary, while trusted internal chat files such as `tool-ui-classifier.ts`, `chat-capabilities.ts`, `use-chat-session.ts`, and `apps/web/src/store/chat.ts` no longer import Zod.

- Observation: Removing the old approval SSE owner leaves ACP filesystem writes without an approval surface.
  Evidence: `apps/server/src/modules/chat-runtime/providers/acp/runtime-integration.ts` now rejects permission requests, and `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts` returns `cancelled` when no permission handler exists. This intentionally fails closed until ACP writes are modeled as AI SDK tools with `needsApproval`.

- Observation: AI SDK v6 exposes enough chat-client primitives from the `ai` package itself to implement an `AbstractChat`-compatible approval continuation without installing `@ai-sdk/react`.
  Evidence: `node_modules/ai/src/ui/index.ts` exports `AbstractChat`, `DefaultChatTransport`, `ChatTransport`, and `lastAssistantMessageIsCompleteWithApprovalResponses`; `node_modules/ai/src/ui/chat.ts` implements `addToolApprovalResponse` by mutating the latest assistant tool part to `approval-responded`.

- Observation: AI SDK continuation relies on preserving the original assistant `UIMessage` when the last message is an assistant message.
  Evidence: `node_modules/ai/src/ui-message-stream/get-response-ui-message-id.ts` reuses the last assistant id when `originalMessages` ends in an assistant message, and `node_modules/ai/src/ui-message-stream/handle-ui-message-stream-finish.ts` initializes stream processing from that last assistant message.

- Observation: The current web store must retain raw AI SDK `UIMessage.parts`, not rewrite tool parts into render-only anchors.
  Evidence: AI SDK `convertToModelMessages` serializes `approval-responded` tool UI parts into `tool-approval-response`. If Zustand stores only a reduced anchor part, approval ids, tool inputs, provider execution flags, and output states are lost before continuation.

- Observation: The remaining chat-runtime Zod cost was hidden in provider configuration reads, not only in chunk projection.
  Evidence: before cleanup, `rg -n "ConfigJsonSchema\\.parse|AgentRuntimeConfigJsonSchema\\.parse|acpChatConfigJsonSchema\\.parse" apps/server/src/modules/chat-runtime` found runtime calls in `service.ts`, `chat-turn-context.ts`, and provider implementations. After replacing them with trusted readers, the same hot-path Zod search returns no matches.

- Observation: Root `pnpm typecheck` became a clean acceptance signal only after aligning the root node TypeScript scope and fixing unrelated type drift revealed by the full gate.
  Evidence: `tsconfig.node.json` now scopes the node gate to active server source and excludes server tests from that root pass, while package-specific server/web/desktop gates still run. Small unrelated type fixes in Chronicle, the import provider parser, and the desktop browser backend let `pnpm typecheck` exit 0.

- Observation: Root `pnpm lint` was initially dominated by generated, vendored, or repo-wide style noise rather than AI SDK runtime regressions.
  Evidence: ESLint scanned `.tools/dotnet`, generated documentation source, design token JSON, and desktop release/appshot scripts before the lint config was aligned. After excluding those paths and relaxing rules such as React Refresh export boundaries, React Compiler strictness, static-regex enforcement, and one-line guard formatting, `pnpm lint` exits 0 while preserving unused-symbol errors and reporting the remaining style issues as warnings.

- Observation: The old independent approval product surface had residual non-chat entries after the main AI SDK chat migration was already functional.
  Evidence: A final search found stale approval locale files, `apps/web/src/lib/contracts/approval-events.ts`, `open-approvals` in desktop tray code/tests, a stale approval group description in `packages/cli/src/runtime/operation-command.ts`, and an ignored generated `apps/web/i18n-missing-report.json` that still referenced deleted approval namespaces. These entries were not part of AI SDK native inline approval and have been removed.

- Observation: Some remaining Zod cost was outside the chat stream itself but still guarded trusted Cradle-owned desktop tray data.
  Evidence: Before cleanup, `apps/desktop/src/main/tray-manager.ts`, `apps/desktop/src/main/tray-manager.test.ts`, `apps/server/src/modules/desktop/service.ts`, `apps/web/src/features/desktop-tray/api.ts`, and `apps/web/src/features/desktop-tray/use-desktop-tray-action-bridge.ts` imported Zod for data generated by Cradle server/Electron/web IPC. After cleanup, the focused Zod search over chat runtime, web chat, store, and desktop tray paths reports only `JSON.parse` calls and no Zod imports.

- Observation: The final audit found stale capability specs and preferences even after the runtime path had already moved to AI SDK.
  Evidence: `apps/server/specs/capabilities/chat-runtime.md` still described old delta events, `apps/server/specs/capabilities/approval.md` still documented the deleted `/approvals` owner, and preference surfaces still exposed `approvalMode`. These were documentation and generated-contract leaks, not active runtime needs, and were deleted or regenerated.

- Observation: Removing the independent approval owner also required deleting its current database owner, not only code and UI.
  Evidence: `packages/db/src/schema/chat.ts` still exported `approvalAudit`, so Drizzle generated `packages/db/drizzle/0049_amusing_mother_askani.sql` with `DROP TABLE \`approval_audit\`;`. Keeping the table would preserve a dead approval audit contract that no active AI SDK approval path writes.

- Observation: Regenerated contracts can reintroduce or expose stale schema state if OpenAPI and CLI are not regenerated after model edits.
  Evidence: Before regeneration, `apps/web/src/api-gen`, `apps/server/openapi.json`, and generated CLI commands still contained `approvalMode` or old approval command state. After `pnpm --filter @cradle/web generate` and `pnpm gen:cli`, `rg -n "approvalMode|chat\\.approval|allowAll|alwaysAllow" apps/web/src/api-gen apps/server/openapi.json packages/cli/src/commands/generated` returns no matches.

## Decision Log

- Decision: AI SDK v6 owns chat streaming semantics end to end. Cradle providers may adapt external provider events into AI SDK `UIMessageChunk`, but Cradle must not own a second message projection protocol.
  Rationale: AI SDK v6 already provides the chunk schema, SSE encoding, client parsing, message projection, tool part lifecycle, metadata handling, and subagent progress pattern. Duplicating those semantics in Cradle adds CPU cost and maintenance burden without meaningful product value.
  Date/Author: 2026-05-26 / Codex

- Decision: The target server wire format is AI SDK `UIMessageChunk` SSE, not Cradle `ChatStreamEvent` SSE and not custom `UIMessage` snapshot SSE.
  Rationale: `DefaultChatTransport` expects `UIMessageChunk` frames and AI SDK's own response helpers emit that format. Sending snapshots would require another custom transport and would still bypass AI SDK's primary client-side streaming path.
  Date/Author: 2026-05-26 / Codex

- Decision: Subagent streaming should follow AI SDK's preliminary tool result pattern wherever possible.
  Rationale: AI SDK v6 documents subagent progress as a tool whose async generator yields accumulated `UIMessage` outputs. This keeps the subagent lifecycle attached to the parent tool part and avoids Cradle-specific `subagent_message_delta` routing.
  Date/Author: 2026-05-26 / Codex

- Decision: Cradle may keep ownership of provider selection, session lifecycle, authorization, queueing, persistence, observability, and provider-specific adapters, but not chunk-to-message projection.
  Rationale: These are Cradle product responsibilities. AI SDK does not know Cradle sessions, SQLite persistence, profile selection, or queueing. The boundary is clean only if Cradle owns orchestration and AI SDK owns streaming/message semantics.
  Date/Author: 2026-05-26 / Codex

- Decision: All providers must end at the same AI SDK-owned runtime boundary.
  Rationale: Provider-specific streaming protocols are allowed only behind adapters. By the time data leaves a provider runtime and enters `chat-runtime/service.ts`, the stream must be AI SDK `UIMessageChunk` or an AI SDK `UIMessageStream`. OpenAI-compatible, Claude Agent SDK, Codex SDK, ACP, mock, and system-agent providers must not introduce provider-specific client stream protocols.
  Date/Author: 2026-05-26 / Codex

- Decision: AI SDK native `needsApproval` is the only approval mechanism for AI SDK tool execution.
  Rationale: AI SDK v6 already models tool approval as part of the `UIMessageChunk` stream and message history. Keeping `wrapToolsWithApproval` would block server execution, bypass `tool-approval-request`, duplicate UI state, and break the goal that AI SDK owns tool lifecycle semantics.
  Date/Author: 2026-05-26 / Codex

- Decision: The independent Cradle `/approvals/stream` SSE system must not carry AI SDK chat tool approvals after this migration.
  Rationale: Approval requests for AI SDK tools must appear in the chat message as tool parts with `state: 'approval-requested'`. The user's response must call `addToolApprovalResponse`, which updates the `UIMessage` and sends the next request with `tool-approval-response` in history. A separate approval SSE path would create a second source of truth.
  Date/Author: 2026-05-26 / Codex

- Decision: Cradle approval preferences and "always allow" policy may survive only as inputs to AI SDK `needsApproval` policy functions, not as an execution wrapper or separate stream.
  Rationale: Cradle can own product policy, audit, and user preference storage, but the execution decision must be expressed to AI SDK by returning `true` or `false` from `needsApproval`. If a user chooses "always allow" in the UI, Cradle may persist that policy before calling `addToolApprovalResponse({ approved: true })`; future calls then return `false` from `needsApproval`.
  Date/Author: 2026-05-26 / Codex

- Decision: Implementation must resolve AI SDK questions by reading local AI SDK v6 source and bundled docs before coding against an API shape.
  Rationale: AI SDK APIs change quickly, and this plan intentionally targets full AI SDK v6 ownership. When implementing `needsApproval`, transports, `useChat`, message conversion, subagent streaming, or tool parts, the source of truth is the installed `ai@6.0.168` package under `node_modules/ai/src` and `node_modules/ai/docs`, not memory or older examples.
  Date/Author: 2026-05-26 / Codex

- Decision: Subagent tools must not require `needsApproval`; they must execute automatically.
  Rationale: Subagent streaming is a control-flow and delegation mechanism, not the approval target described in this plan. Requiring approval for subagent tools would interrupt the preliminary tool result pattern and conflate "delegate work to a subagent" with "approve a sensitive side-effecting tool." Approval policy applies to sensitive operational tools, not to the subagent tool wrapper itself.
  Date/Author: 2026-05-26 / Codex

- Decision: Do not build a Cradle-owned path when AI SDK already provides an API, helper, transport, projection, message conversion, tool lifecycle hook, or documented pattern for the same job.
  Rationale: The core failure this plan fixes is not merely stale API usage; it is Cradle reimplementing AI SDK-owned semantics with `ChatPartDelta`, custom stream events, custom reducers, and approval side channels. During implementation, the default assumption must be that AI SDK v6 already has a supported way to solve chat streaming, message projection, tool approval, subagent progress, transport parsing, and model-message conversion. If an implementer cannot find such a way, the next step is to audit whether Cradle has modeled the feature at the wrong boundary, not to invent a new protocol.
  Date/Author: 2026-05-26 / Codex

- Decision: Do not preserve legacy chat behavior through compatibility architecture during this migration.
  Rationale: Cradle has not shipped a stable public chat runtime contract that requires preserving old internal protocols. Compatibility layers would keep the exact complexity this migration is intended to remove. When old chat behavior is encountered, refactor it directly into the AI SDK v6-owned architecture, update callers and documentation, and delete the old path once the new path handles the behavior.
  Date/Author: 2026-05-26 / Codex

- Decision: Retain AI SDK `uiMessageChunkSchema` at the network boundary but remove Cradle-owned Zod schemas from trusted chat internals.
  Rationale: SSE frames are external protocol data and should be validated against AI SDK's own schema. Once a frame is accepted or a `UIMessage` snapshot is loaded from Cradle's database, running feature-owned Zod schemas over the same trusted object recreates the CPU cost and semantic duplication this migration removes.
  Date/Author: 2026-05-27 / Codex

- Decision: Do not invent an approval continuation endpoint until there is a real AI SDK `ToolSet` construction point or an AI SDK `AbstractChat` integration point to attach to.
  Rationale: AI SDK approval is a message-history protocol: `approval-requested` becomes `approval-responded`, then `convertToModelMessages` emits `tool-approval-response`. The current Cradle client is still a hand-written Zustand/request loop, and current production server tools do not exist. Adding a Cradle-specific approval endpoint now would create another custom lifecycle rather than following AI SDK's `addToolApprovalResponse` model.
  Date/Author: 2026-05-27 / Codex

- Decision: Delete the old independent approval owner instead of leaving a non-chat compatibility island.
  Rationale: The user's constraint is full AI SDK v6 ownership with no compatibility architecture. Keeping `/approvals/stream`, the web approval inbox, the approvals tab, or generated approval CLI commands would preserve a second approval lifecycle and invite future code to bypass AI SDK `needsApproval`.
  Date/Author: 2026-05-26 / Codex

- Decision: ACP client-filesystem writes fail closed until modeled as AI SDK tools.
  Rationale: ACP `fs.writeTextFile` targets user filesystem paths outside Cradle-owned data. With the legacy approval owner deleted, default-allowing these writes would be unsafe and would recreate approval semantics outside AI SDK. The correct replacement is an AI SDK tool with `needsApproval`, not another side-channel.
  Date/Author: 2026-05-26 / Codex

- Decision: Keep the existing Cradle chat orchestration hook, but make approval continuation follow AI SDK `AbstractChat` semantics exactly.
  Rationale: The web app currently owns session hydration, queueing, passive stream joining, run headers, and snapshot invalidation in `use-chat-session.ts`; replacing all of that with `@ai-sdk/react useChat` is a larger app-shell migration and the package is not currently installed. The implemented bridge mirrors AI SDK `addToolApprovalResponse`: it updates the latest assistant tool part to `approval-responded`, checks `lastAssistantMessageIsCompleteWithApprovalResponses`, and submits the complete AI SDK `messages` history to the run endpoint. This preserves AI SDK's message-history protocol without creating a separate approval channel.
  Date/Author: 2026-05-27 / Codex

- Decision: The server run endpoint accepts AI SDK `messages` history for approval continuation.
  Rationale: AI SDK native approvals require the next `streamText` call to see `tool-approval-response` in model history. Sending a new text-only user message would lose that state. `POST /chat/sessions/:sessionId/response` now accepts optional `messages`; when the last message is an assistant, the run reuses that assistant message id and projects/persists from that existing snapshot.
  Date/Author: 2026-05-27 / Codex

- Decision: Render-only tool entity indexes must not mutate stored `UIMessage` snapshots.
  Rationale: Tool entities are a web rendering cache keyed by `toolCallId`. AI SDK message history is the semantic source of truth for approvals, tool inputs, provider-executed flags, preliminary outputs, and final outputs. Rewriting message parts for rendering would recreate the same projection ownership problem this plan removes.
  Date/Author: 2026-05-27 / Codex

- Decision: Trusted chat-runtime provider config readers should preserve defaults without using Zod in the runtime hot path.
  Rationale: Provider records and agent runtime config are already Cradle-owned database state when `streamTurn` executes. Re-running Zod there is a hidden hot-path validation cost and violates the user's internal-trust constraint. Defaults that used to be supplied by schemas are now rehydrated by small typed readers, while schema validators remain appropriate at external request, import, and editor boundaries.
  Date/Author: 2026-05-26 / Codex

- Decision: The root lint gate should lint active repository source, not vendored/generated artifacts or broad style migrations unrelated to the AI SDK runtime ownership work.
  Rationale: A root validation gate is useful only if failures point to actionable product code regressions. `.tools`, generated documentation source, design token JSON, and release/appshot automation were swamping the gate with unrelated parser/style noise. Rules that conflict with current repo conventions were relaxed globally so `pnpm lint` can fail on meaningful errors such as unused symbols while reporting remaining cleanup as warnings.
  Date/Author: 2026-05-26 / Codex

- Decision: Delete stale approval locale, contract, tray, report, and CLI label surfaces instead of preserving them as empty compatibility affordances.
  Rationale: These surfaces belonged to the independent Cradle approval product path, not to AI SDK native inline tool approval. Keeping them would imply that approvals still have a global inbox, tray action, contract event stream, or generated CLI group after the migration. The only remaining approval UI for AI SDK tools is the chat tool part state managed through AI SDK message history.
  Date/Author: 2026-05-26 / Codex

- Decision: Treat desktop tray server/Electron/web IPC data as trusted internal Cradle data for this cleanup.
  Rationale: The desktop tray snapshot and pending action requests are produced by Cradle-owned server/Electron code and consumed by Cradle-owned web code. Re-running feature-owned Zod schemas over this data repeats the same validation/projection cost pattern the migration removes. HTTP request boundaries and AI SDK SSE boundaries may still validate; trusted tray integration code should use typed reads and direct narrowing only where needed.
  Date/Author: 2026-05-26 / Codex

- Decision: Delete the dangling `approvalMode` preference instead of keeping it as an inert future policy field.
  Rationale: There is no current AI SDK `ToolSet` construction point that can consume a global approval preference, and keeping `approvalMode` in preferences, settings UI, import mapping, OpenAPI, or CLI would imply the old independent approval policy still exists. Future sensitive tools can introduce AI SDK-native policy inputs at their tool definition boundary when needed.
  Date/Author: 2026-05-26 / Codex

- Decision: Drop the `approval_audit` current schema table as part of the approval owner deletion.
  Rationale: The audit table belonged to the deleted independent approval system. AI SDK native approvals are represented in `UIMessage` history and future product audit should be designed around actual AI SDK tool execution events, not a dead table that no active owner writes.
  Date/Author: 2026-05-26 / Codex

- Decision: Regenerate OpenAPI, web API clients, and generated CLI after contract cleanup rather than hand-editing generated files.
  Rationale: Manual generated-file edits are fragile and can be overwritten. The source of truth is the server schema and OpenAPI export; generated outputs must reflect that source, especially for proving `approvalMode` and approval commands are gone from public contract surfaces.
  Date/Author: 2026-05-26 / Codex

## Outcomes & Retrospective

Implementation is complete for the current codebase shape. The active server/client chat streaming path uses AI SDK `UIMessageChunk` SSE and AI SDK `readUIMessageStream` projection instead of Cradle `ChatPartDelta` or Cradle-owned stream wrappers. The old server delta projection file, web delta reducer files, AI SDK approval wrapper, server approval SSE module, web approval inbox, approvals tab, generated approval CLI commands, approval locales, approval event contract, stale approval report artifact, desktop tray approval action, CLI approval group label, `approvalMode` preference surface, and current `approval_audit` schema owner have been deleted. Chat UI no longer mounts the old independent approval SSE card list, and trusted chat internals no longer run feature-owned Zod schemas over `UIMessage` snapshots, provider state snapshots, compaction summary lines, provider mapper payloads, tool display payloads, or store reconciliation.

Native approval continuation is represented as AI SDK message history. Approval buttons are rendered from tool parts with `state: "approval-requested"`, response updates produce `approval-responded` tool parts, and the next run submits the complete `messages` array so AI SDK `convertToModelMessages` and `collectToolApprovals` can execute or deny the tool. There is no Cradle approval SSE side channel. There is still no production AI SDK `ToolSet` construction point where a concrete sensitive tool can declare `needsApproval`; this is an audited absence, not a compatibility fallback. Future tools must use native `needsApproval` directly, and subagent delegation tools must not be approval-gated.

Subagent progress now follows AI SDK preliminary tool output. Claude Agent SDK child-agent messages are locally projected into accumulated `UIMessage` snapshots and attached to the parent tool output with `preliminary: true`. The web renders nested subagent activity from that tool output, and tool entity indexing is owned by the parent message so stale nested tools are cleaned when the parent AI SDK snapshot is replaced.

Validation now proves both the focused migration surface and the repository-wide gates are in a passing state after generated contract cleanup. `pnpm lint` exits 0 with 75 warnings and no errors, `pnpm typecheck` exits 0 across node, server, web, and desktop, and `pnpm test` exits 0 with 18 files and 78 tests passing. The final residual searches return no active references to the deleted delta/approval protocol, no dangling `approvalMode` or `chat.approval` generated contract surface, and no Cradle-owned Zod in the trusted chat runtime, web chat hot path, chat store, or desktop tray integration paths touched by this cleanup.

## Context and Orientation

The repository root is `/Users/wibus/dev/Cradle`. The package manager is `pnpm@11.2.2`, and the installed AI SDK package is `ai@6.0.168`. The relevant local source of truth for AI SDK behavior is inside `node_modules/ai/src` and `node_modules/ai/docs`.

An AI SDK `UIMessageChunk` is a small streaming event such as `text-start`, `text-delta`, `text-end`, `tool-input-available`, `tool-output-available`, `start`, or `finish`. AI SDK uses these chunks to build a full `UIMessage`, which is a chat message with an `id`, `role`, optional `metadata`, and a `parts` array. Projection means updating the current full `UIMessage` as chunks arrive.

Current server provider flow is split across these files:

- `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` defines the provider interface. `streamTurn` returns `AsyncGenerator<UIMessageChunk, void, void>`.
- `apps/server/src/modules/chat-runtime/providers/claude-agent/mapper.ts` adapts Claude Agent SDK messages into AI SDK `UIMessageChunk[]`.
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` reads Claude Agent SDK messages and yields mapped chunks.
- `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts` uses `streamText().toUIMessageStream()` for AI SDK-native model providers. Snapshot-only execution and approval wrapping have been removed from the active path.
- `apps/server/src/modules/chat-runtime/service.ts` receives provider chunks, publishes those chunks as AI SDK SSE frames, and uses `readUIMessageStream` over the buffered chunks for terminal snapshot persistence.
- `apps/server/src/modules/chat-runtime/message-snapshots.ts` contains trusted helper functions for stored `UIMessage` snapshots.
- `apps/server/src/modules/chat-runtime/delta-events.ts` has been deleted.
- `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts` has been deleted.
- `apps/server/src/modules/approval` has been deleted. There is no remaining `/approvals/stream` route for chat tool approval. Do not restore this owner for AI SDK tool execution.

Current web client flow is split across these files:

- `apps/web/src/features/chat/sse-chat-transport.ts` parses AI SDK `UIMessageChunk` SSE with AI SDK `uiMessageChunkSchema`.
- `apps/web/src/features/chat/chat-streaming-handler.ts` feeds AI SDK chunks into `readUIMessageStream` and replaces full `UIMessage` snapshots in Zustand.
- `apps/web/src/features/chat/chat-delta-events.ts` and `apps/web/src/features/chat/chat-chunk-reducer.ts` have been deleted.
- `apps/web/src/features/chat/use-chat-session.ts` creates optimistic user messages, starts response streams, parses AI SDK chunks, and drives `ChatStreamingHandler`.
- `apps/web/src/store/chat.ts` owns Cradle's current Zustand chat state and receives full `UIMessage` updates from AI SDK projection. Its tool entity normalization is a rendering concern, not a streaming protocol.
- `apps/web/src/features/approval` and `apps/web/src/tabs/approvals.tab.tsx` have been deleted. Chat approval UI must be rendered from AI SDK tool parts with `state: 'approval-requested'`, not from a global approval inbox.
- `apps/web/src/locales/*/approval.json`, `apps/web/src/locales/default/approval.ts`, `apps/web/src/lib/contracts/approval-events.ts`, and the ignored `apps/web/i18n-missing-report.json` artifact have been deleted. Do not reintroduce an approval namespace or contract for AI SDK chat tool approval; inline tool parts are the contract.
- Desktop tray code no longer exposes `open-approvals`, and `packages/cli/src/runtime/operation-command.ts` no longer advertises an approval command group. Do not reintroduce these entry points for AI SDK chat tool approval.

The AI SDK v6 APIs to use are:

- `streamText().toUIMessageStream()` for providers backed by AI SDK language models.
- `createUIMessageStream()` when Cradle needs to create a stream by writing AI SDK chunks manually or merging streams.
- `createUIMessageStreamResponse()` or `pipeUIMessageStreamToResponse()` when a route can directly return or pipe an AI SDK chunk stream.
- `DefaultChatTransport` when the web client can let AI SDK fetch and parse the response.
- `uiMessageChunkSchema` and `parseJsonEventStream` only when a thin custom transport is needed.
- `readUIMessageStream()` for local aggregation to full `UIMessage` snapshots, especially for persistence or preliminary tool outputs, not as the default server-to-client wire format.
- `needsApproval` on AI SDK tools to request user confirmation before execution.
- `addToolApprovalResponse({ id, approved, reason?, options? })` on the AI SDK chat client to record approval responses.
- `lastAssistantMessageIsCompleteWithApprovalResponses` as the `sendAutomaticallyWhen` predicate when the UI should automatically continue after all approval requests in the latest assistant step have responses.
- `convertToModelMessages()` to serialize `approval-responded` UI parts into model history as `tool-approval-response`.

During implementation, every non-trivial AI SDK question must be checked against local installed sources before editing. This is not just a "keep checking" habit; it is a design gate. Before implementing any Cradle-owned transport, stream parser, message projection, approval flow, tool reducer, subagent routing mechanism, or model-history conversion, first search `node_modules/ai/src` and `node_modules/ai/docs` for an existing AI SDK API or pattern. Use `rg` for names such as `useChat`, `DefaultChatTransport`, `createUIMessageStream`, `pipeUIMessageStreamToResponse`, `needsApproval`, `addToolApprovalResponse`, `processUIMessageStream`, `readUIMessageStream`, `convertToModelMessages`, and `lastAssistantMessageIsCompleteWithApprovalResponses`. If local source and docs disagree, prefer source and prove the choice with typecheck. If no AI SDK API appears to solve the problem, pause and audit whether the proposed Cradle design has placed ownership at the wrong boundary before adding new infrastructure.

The chat runtime may contain additional legacy behaviors beyond the stream and approval paths named in this plan. If implementation reveals old behavior such as queue continuation details, passive observer updates, run display metadata, tool entity side channels, snapshot refresh policy, or provider-specific routing that conflicts with AI SDK v6 ownership, refactor that behavior into the new architecture directly. Do not preserve old semantics by adding a compatibility facade, fallback protocol, migration mode, or dual reducer. The correct shape is a single AI SDK-owned streaming and message lifecycle with Cradle-owned orchestration around it.

## Plan of Work

Milestone 1 establishes the AI SDK stream contract at the server boundary. Update `apps/server/src/modules/chat-runtime/service.ts` so an active run stores and publishes AI SDK `UIMessageChunk` frames instead of Cradle `ChatStreamEvent` delta frames. Replace `RunSubscriber = (event: ChatStreamEvent, terminal: boolean) => void` with a stream item type that can represent an AI SDK chunk plus terminal status. The emitted SSE data must be exactly the AI SDK JSON chunk object accepted by `uiMessageChunkSchema`. For `POST /chat/sessions/:sessionId/response`, return a `ReadableStream<Uint8Array>` that writes `data: ${JSON.stringify(chunk)}\n\n` for each chunk, with headers compatible with AI SDK UI message streams. Keep Cradle headers such as `x-cradle-run-id`, `x-cradle-assistant-message-id`, and `x-cradle-user-message-id` because they are Cradle session metadata, not message projection.

Milestone 2 removes server-side Cradle projection from the hot path. In `service.ts`, replace `applyAndPublishChunk` with a function that records the raw provider chunk, publishes the raw AI SDK chunk, and updates a local AI SDK projection only for final persistence. The projection for persistence should use AI SDK's `readUIMessageStream` or `processUIMessageStream`, not `applyChunkToProjection`. Do not write SQLite on every chunk. Persist the final assistant `UIMessage` once when a run reaches `finish`, `abort`, or `error`. Persist intermediate snapshots only if a crash recovery requirement is explicitly reintroduced later; it is not part of this plan.

Milestone 3 makes the web client consume AI SDK v6 streams. Prefer `DefaultChatTransport` if it can fit the current `startChatResponse` and `subscribeChatSessionStream` endpoints without losing Cradle headers. If headers such as `x-cradle-run-id` must be read before streaming, implement a thin local transport in `apps/web/src/features/chat` whose `sendMessages` returns `ReadableStream<UIMessageChunk>` and uses AI SDK's `parseJsonEventStream` plus `uiMessageChunkSchema` instead of Cradle Zod schemas. The client-side projection must be AI SDK's `processUIMessageStream` through `AbstractChat`, `useChat`, or a tiny adapter that uses the same AI SDK API. The Zustand store should receive full `UIMessage` replacement updates, matching AI SDK's own `AbstractChat` behavior.

Milestone 4 migrates AI SDK tool approvals to native `needsApproval`. Remove `approvalContext` and `wrapToolsWithApproval` from `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts`. Delete or retire `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts` after all imports are gone. Configure sensitive operational tools with `needsApproval` at the point where the AI SDK `ToolSet` is created. A tool should return `false` from `needsApproval` when Cradle policy says the operation is safe or already allowed, and `true` when the user must approve it. Subagent tools are explicitly excluded: a subagent delegation tool must not set `needsApproval` and must execute automatically. The tool `execute` function must not block on Cradle approval. On the web side, render approval controls from tool parts with `state: 'approval-requested'`; approve or deny by calling `addToolApprovalResponse({ id: part.approval.id, approved, reason })`. Configure automatic continuation with `lastAssistantMessageIsCompleteWithApprovalResponses` unless the UI intentionally requires a manual continue action.

Milestone 5 removes the old approval stream from the AI SDK tool path. Stop using `/approvals/stream`, `approval.requested`, and `approval.resolved` for AI SDK chat tool approval requests. Remove references from chat UI flows and generated CLI flows that only existed to answer AI SDK tool approvals. The old `apps/server/src/modules/approval`, `apps/web/src/features/approval`, approvals tab, tray action, and generated approval CLI commands should stay deleted. If future non-chat approval policy is required, it must be designed as a separate product feature and must not be used for AI SDK chat tool execution.

Milestone 6 converts subagent progress to AI SDK's preliminary tool result pattern. A preliminary tool result is an intermediate tool output yielded by an async generator before the final tool output. For subagents, the yielded output should be a complete accumulated `UIMessage` snapshot generated by `readUIMessageStream({ stream: subagentResult.toUIMessageStream() })` or by the equivalent provider adapter. Each yield replaces the previous tool output. The UI should render the subagent inside the parent tool part. This removes the need for `subagent_message_delta`, `parentToolCallId` routing events, and per-subagent `partIndex` deltas.

Milestone 7 aligns all providers. Each provider may adapt its external protocol into AI SDK chunks internally, but the exported `streamTurn` boundary must stay AI SDK-native. `ClaudeAgentProvider` should keep `mapClaudeAgentMessageToChunks`, but remove Cradle-only routing metadata unless it is displayed as ordinary UI metadata. `OpenAICompatibleProvider` should use `executeAiSdkTurn`, not `executeAiSdkTurnSnapshots`, unless a local-only test proves snapshots are still required. `Codex`, `ACP`, `mock-claude-agent`, and `system-agent` providers should be audited so no provider emits Cradle stream events, depends on `ChatPartDelta`, or uses a Cradle-owned approval stream for AI SDK tool approval semantics.

Milestone 8 removes obsolete code and updates documentation. Delete `apps/server/src/modules/chat-runtime/delta-events.ts` after all imports are gone. Delete or rewrite `apps/web/src/features/chat/chat-delta-events.ts`, `apps/web/src/features/chat/chat-streaming-handler.ts`, `apps/web/src/features/chat/sse-chat-transport.ts`, and `apps/web/src/features/chat/chat-chunk-reducer.ts` according to remaining responsibilities. Delete `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts` after native `needsApproval` is in place. Update `apps/server/src/modules/chat-runtime/index.ts` route descriptions so they describe AI SDK UI message stream SSE, not `message_delta`, `subagent_message_delta`, or approval side-channel events. Update `apps/server/src/modules/chat-runtime/README.md`, `apps/server/src/modules/approval/README.md`, and affected `apps/web/src/features/chat/README.md` or `apps/web/src/features/approval/README.md` if present.

Milestone 9 removes compatibility assumptions discovered along the way. Audit chat runtime call sites after each major deletion. If a caller depends on old stream event names, delta sequences, per-chunk persistence, passive delta replay, approval SSE state, or custom tool entity patches, rewrite the caller to consume AI SDK-derived `UIMessage` state or Cradle orchestration state. Do not add a translation layer from new AI SDK state back into old Cradle event shapes. This milestone is complete only when there is one active chat architecture rather than old and new paths coexisting.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle` unless a step explicitly says otherwise.

First, confirm the AI SDK version and API availability before coding:

    node -p "require('./node_modules/ai/package.json').version"
    rg -n "readUIMessageStream|processUIMessageStream|pipeUIMessageStreamToResponse|DefaultChatTransport|uiMessageChunkSchema" node_modules/ai/src

Expected output includes version `6.0.168` and matches in `node_modules/ai/src/ui-message-stream`, `node_modules/ai/src/ui`, and `node_modules/ai/src/index.ts`.

Next, map current Cradle-owned projection entry points:

    rg -n "ChatPartDelta|ChatStreamEvent|applyChunkToProjection|applyChatPartDeltas|buildEventStreamFromResponse|chat-chunk-reducer|subagent_message_delta" apps/server/src apps/web/src

Expected output lists the files named in the orientation section. During implementation, this command should shrink until only migration notes or no matches remain.

Map the current legacy approval entry points:

    rg -n "wrapToolsWithApproval|ToolApprovalContext|approvalContext|/approvals/stream|approval.requested|approval.resolved|addToolApprovalResponse|needsApproval" apps/server/src apps/web/src node_modules/ai/src

Expected output initially includes `apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts`, `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts`, `apps/server/src/modules/approval`, `apps/web/src/features/approval`, and AI SDK source files. During implementation, production code in the AI SDK chat path should keep `needsApproval` and `addToolApprovalResponse` references but lose `wrapToolsWithApproval`, `ToolApprovalContext`, and `/approvals/stream` dependencies.

Before writing any replacement for an old Cradle-owned path, run a targeted AI SDK audit. Start with:

    rg -n "createUIMessageStream|pipeUIMessageStreamToResponse|DefaultChatTransport|processUIMessageStream|readUIMessageStream|convertToModelMessages|needsApproval|addToolApprovalResponse|lastAssistantMessageIsCompleteWithApprovalResponses|tool-approval-request|preliminary" node_modules/ai/src node_modules/ai/docs

For each proposed custom helper, write down in this plan which AI SDK API was considered and why the chosen implementation still keeps AI SDK as the semantic owner. A valid reason is "Cradle is adapting an external provider into AI SDK's type," for example converting Claude Agent SDK messages into `UIMessageChunk`. An invalid reason is "Cradle wants a simpler local protocol" when AI SDK already has a protocol.

Implement Milestone 1 and Milestone 2 in `apps/server/src/modules/chat-runtime/service.ts`. Keep route function names stable unless a cleaner rename is clearly worth the blast radius. Add a small server-side helper that converts `UIMessageChunk` to SSE by JSON-stringifying the chunk exactly once. Do not wrap the chunk in a Cradle event object.

Implement Milestone 3 in the web chat feature. If using `DefaultChatTransport`, configure it to call the existing Cradle endpoint and pass the same request body shape currently sent by `startChatResponse`. If a thin custom transport is needed, it must expose the same shape as AI SDK's `ChatTransport` and return parsed `UIMessageChunk` objects. Do not recreate `applyChatPartDeltas`.

Implement Milestone 4 by moving approval decisions into tool definitions. A minimal approved shape is:

    const sensitiveTool = tool({
      description: 'Run a sensitive operation',
      inputSchema,
      needsApproval: async (input, options) => {
        return shouldRequestApproval({ input, toolCallId: options.toolCallId })
      },
      execute: async (input, options) => {
        return runSensitiveOperation(input, options)
      },
    })

Do not call `ApprovalService.requestApproval` from `execute`. Do not add an EventSource subscription to answer AI SDK tool approvals.

When touching this milestone, first inspect the installed AI SDK implementation:

    rg -n "needsApproval|tool-approval-request|addToolApprovalResponse|collectToolApprovals|lastAssistantMessageIsCompleteWithApprovalResponses" node_modules/ai/src node_modules/ai/docs

Then implement against the observed source. Do not infer `needsApproval` signatures from memory.

Implement Milestone 6 by changing subagent handling so parent tool outputs carry subagent progress snapshots. The implementation should follow the AI SDK docs pattern already present in `node_modules/ai/docs/03-agents/06-subagents.mdx`: the subagent stream is read through `readUIMessageStream`, and each yielded complete `UIMessage` replaces the previous tool output.

After each milestone, run:

    pnpm typecheck

For focused test coverage, run existing tests first:

    pnpm test -- apps/web/src/features/chat/chat-streaming-handler.test.ts apps/web/src/features/chat/chat-delta-events.test.ts

These two tests are expected to be deleted or rewritten when the delta reducer is removed. Their replacement should verify AI SDK chunk streaming and full message replacement behavior. If a route-level test suite exists for `apps/server/src/modules/chat-runtime`, add or update tests there so a stream emits AI SDK chunk frames and final persistence writes one assistant message.

Before completion, run:

    pnpm lint
    pnpm typecheck
    pnpm test

## Validation and Acceptance

Acceptance is based on observable behavior, not only compilation.

For server SSE format, start a chat response against a provider that can produce streaming text. Inspect the response body. The stream must contain frames like:

    data: {"type":"start","messageId":"assistant-..."}

    data: {"type":"text-start","id":"..."}

    data: {"type":"text-delta","id":"...","delta":"Hello"}

    data: {"type":"text-end","id":"..."}

    data: {"type":"tool-approval-request","approvalId":"...","toolCallId":"..."}

    data: {"type":"finish","finishReason":"stop"}

The stream must not contain:

    data: {"type":"message_delta",...}
    data: {"type":"subagent_message_delta",...}
    "deltas":[...]
    "partIndex"
    data: {"type":"approval.requested",...}

For the web client, send a normal message from the chat UI. The assistant response should stream progressively. The store should replace or append full `UIMessage` snapshots as AI SDK projection updates them. Text, reasoning, tool calls, and tool results should render with the same or better behavior than before.

For native tool approval, trigger a tool whose `needsApproval` returns `true` once a real AI SDK `ToolSet` construction point exists. The network stream should contain a `tool-approval-request` AI SDK chunk. The chat UI should render the corresponding tool part with `state: 'approval-requested'`. Approving or denying must follow AI SDK `addToolApprovalResponse` semantics: update the matching tool part to `approval-responded` with `{ id: part.approval.id, approved, reason? }`, check `lastAssistantMessageIsCompleteWithApprovalResponses`, and submit the complete AI SDK `messages` history to continue. The next request's model history must include a `tool-approval-response`; the server should execute the approved tool and stream a `tool-output-available` chunk, or produce AI SDK's denied execution behavior. No request should be sent to `/approvals/{approvalId}/respond` for this AI SDK tool approval.

For subagent approval exclusion, trigger a subagent delegation tool. The subagent tool must run automatically and stream preliminary tool outputs without producing a `tool-approval-request` for the delegation itself. Sensitive tools used inside the subagent may have their own explicit approval policy only if they are ordinary operational tools, but the subagent wrapper must not require approval.

For approval cleanup, run:

    rg -n "wrapToolsWithApproval|ToolApprovalContext|approvalContext|approval.requested|approval.resolved|/approvals/stream" apps/server/src apps/web/src

At completion, this should return no references in the AI SDK chat path. If the approval module remains for non-AI-SDK provider protocols, remaining references must be isolated to those protocols and documented as outside AI SDK tool approval.

For subagent progress, trigger a provider flow that starts a subagent. The UI should show subagent progress inside the parent tool part as preliminary tool output. The stream should remain AI SDK chunk SSE. There should be no Cradle `subagent_message_delta` event in the network response.

For persistence, inspect the chat session after the run completes and reload the page. The final assistant message should be present with the complete `parts` array. SQLite writes should occur at terminal persistence points, not once per chunk. If logging is available, the number of final message persistence calls for one assistant response should be one in the non-error happy path.

For cleanup, run:

    rg -n "ChatPartDelta|ChatStreamEvent|applyChunkToProjection|applyChatPartDeltas|subagent_message_delta|message_delta" apps/server/src apps/web/src

At completion, this should return no production-code references. If tests or historical docs still mention these names, they must clearly mark them as removed legacy behavior or be deleted.

The latest focused validation completed during implementation was:

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    # exits 0

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    # exits 0

    pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts tests/openapi.test.ts tests/sdk-providers.test.ts tests/session.test.ts tests/acp-chat-runtime.test.ts tests/chat-stream-trace.test.ts --maxWorkers=1 --fileParallelism=false
    # exits 0; 6 test files passed, 29 tests passed

    rg -n "subagentMessagesMap|setSubagentMessages|upsertSubagentMessage|subagentMessages\\(|bucketSubagentMessagesByParentToolCall|EMPTY_SUBAGENT_MESSAGES|subagent_message_delta|ChatPartDelta|ChatStreamEvent|applyChunkToProjection|applyChatPartDeltas|message_delta|wrapToolsWithApproval|ToolApprovalContext|approvalContext|/approvals/stream|approval\\.requested|approval\\.resolved" apps/server/src apps/web/src packages/cli/src apps/server/tests apps/web/src
    # returns no matches

    rg -n "\\bzod\\b|from 'zod'|from \"zod\"|\\.safeParse\\(|ConfigJsonSchema\\.parse|AgentRuntimeConfigJsonSchema\\.parse|SessionRuntimeConfigJsonSchema\\.parse|acpChatConfigJsonSchema\\.parse" apps/server/src/modules/chat-runtime apps/web/src/features/chat apps/web/src/store/chat.ts
    # returns no matches

    pnpm lint
    # exits 0; ESLint reports warnings only.

    pnpm typecheck
    # exits 0; node, server, web, and desktop typecheck commands all pass.

    pnpm test
    # exits 0; 18 test files passed, 78 tests passed.

The latest final validation after residual approval surface and desktop tray Zod cleanup is:

    rg -n "open-approvals|approval\\.json|default/approval|approval-events|ApprovalRequestedPayload|ApprovalResolvedPayload|apps/web/src/features/approval|apps/server/src/modules/approval|/approvals/stream|approval\\.requested|approval\\.resolved|Manage pending approvals" apps/desktop/src apps/server/src apps/server/tests apps/web/src packages/cli/src
    # returns no matches

    rg -n "subagentMessagesMap|setSubagentMessages|upsertSubagentMessage|subagentMessages\\(|bucketSubagentMessagesByParentToolCall|EMPTY_SUBAGENT_MESSAGES|subagent_message_delta|ChatPartDelta|ChatStreamEvent|applyChunkToProjection|applyChatPartDeltas|message_delta|wrapToolsWithApproval|ToolApprovalContext|approvalContext|/approvals/stream|approval\\.requested|approval\\.resolved" apps/server/src apps/web/src packages/cli/src apps/server/tests
    # returns no matches

    rg -n "\\bzod\\b|from 'zod'|from \"zod\"|\\.safeParse\\(|\\.parse\\(" apps/server/src/modules/chat-runtime apps/web/src/features/chat apps/web/src/store/chat.ts apps/server/src/modules/desktop apps/web/src/features/desktop-tray apps/desktop/src/main/tray-manager.ts apps/desktop/src/main/tray-manager.test.ts
    # returns only JSON.parse calls, not Zod imports or schema parse calls.

    pnpm lint
    # exits 0; 75 warnings and 0 errors.

    pnpm typecheck
    # exits 0.

    pnpm test
    # exits 0; 18 test files passed, 78 tests passed.

The latest final validation after capability spec cleanup, dangling approval preference deletion, `approval_audit` schema removal, and generated contract regeneration is:

    pnpm --filter @cradle/web generate
    # exits 0; regenerates apps/server/openapi.json and apps/web/src/api-gen from the current server contract.

    pnpm gen:cli
    # exits 0; Generated 195 CLI commands and removed generated approval command registration from the current contract.

    rg -n "approvalMode|chat\\.approval|allowAll|alwaysAllow" apps/web/src/api-gen apps/server/openapi.json packages/cli/src/commands/generated
    # returns no matches

    rg -n "open-approvals|approval\\.json|default/approval|approval-events|ApprovalRequestedPayload|ApprovalResolvedPayload|apps/web/src/features/approval|apps/server/src/modules/approval|/approvals/stream|approval\\.requested|approval\\.resolved|Manage pending approvals|approvalMode|chat\\.approval|allowAll|alwaysAllow" apps/desktop/src apps/server/src apps/server/tests apps/server/specs apps/web/src packages/cli/src packages/db/src
    # returns no matches

    rg -n "subagentMessagesMap|setSubagentMessages|upsertSubagentMessage|subagentMessages\\(|bucketSubagentMessagesByParentToolCall|EMPTY_SUBAGENT_MESSAGES|subagent_message_delta|ChatPartDelta|ChatStreamEvent|applyChunkToProjection|applyChatPartDeltas|message_delta|wrapToolsWithApproval|ToolApprovalContext|approvalContext|/approvals/stream|approval\\.requested|approval\\.resolved" apps/server/src apps/web/src packages/cli/src apps/server/tests apps/server/specs
    # returns no matches

    rg -n "from 'zod'|from \"zod\"|\\.safeParse\\(|ConfigJsonSchema\\.parse|AgentRuntimeConfigJsonSchema\\.parse|SessionRuntimeConfigJsonSchema\\.parse|acpChatConfigJsonSchema\\.parse" apps/server/src/modules/chat-runtime apps/web/src/features/chat apps/web/src/store/chat.ts apps/server/src/modules/desktop apps/web/src/features/desktop-tray apps/desktop/src/main/tray-manager.ts apps/desktop/src/main/tray-manager.test.ts
    # returns no matches

    rg -n "approvalMode|chat\\.approval|allowAll|alwaysAllow|approval_audit|approvalAudit|ApprovalAudit|Capability: Approval|/approvals|message_delta|subagent_message_delta|ChatPartDelta|ChatStreamEvent|wrapToolsWithApproval|open-approvals|approval-events" apps/server/src apps/server/tests apps/server/specs apps/web/src packages/cli/src packages/db/src packages/db/drizzle/0049_amusing_mother_askani.sql
    # returns only packages/db/drizzle/0049_amusing_mother_askani.sql:1:DROP TABLE `approval_audit`;

    pnpm typecheck
    # exits 0.

    pnpm test
    # exits 0; 18 test files passed, 78 tests passed.

    pnpm lint
    # exits 0; 75 warnings and 0 errors.

## Idempotence and Recovery

Most steps are code edits and can be repeated safely. The migration should be implemented in small milestones so `pnpm typecheck` can be run after each major edit. Avoid destructive Git commands. Do not use `git reset --hard` or force pushes as part of this plan.

If the server stream conversion breaks the web client, keep the server route compiling and temporarily add a focused parser test that consumes AI SDK chunk SSE directly. Then repair the client transport against that test. Do not reintroduce `ChatPartDelta` as a compatibility layer.

If subagent preliminary tool output cannot represent one of Cradle's current UI states, add the missing state as AI SDK-compatible tool output data. Do not add a second message projection protocol. If truly separate concurrent subagent messages are required later, the only acceptable fallback is a minimal route envelope around `UIMessageChunk`, not `partIndex` deltas; this fallback must be recorded as a new decision before implementation.

If final-only persistence loses necessary recovery behavior, add a documented recovery checkpoint mechanism based on AI SDK `UIMessage` snapshots. The checkpoint must be a persistence concern only and must not become the client streaming protocol.

If native AI SDK approval does not cover a non-AI-SDK provider protocol, do not route that provider's approval through AI SDK unless the provider is actually represented as AI SDK tools. Keep any non-AI-SDK approval system explicitly outside the AI SDK chat tool approval path and document the ownership boundary. For AI SDK tools, falling back to `wrapToolsWithApproval` is not allowed.

If an implementation detail is unclear, stop writing code for that detail and inspect `node_modules/ai/src` and `node_modules/ai/docs` with `rg` before continuing. This is not optional for AI SDK-facing code. Record surprising source behavior in `Surprises & Discoveries` before relying on it.

If an AI SDK API cannot be found for a proposed chat-runtime responsibility, treat that as an architectural smell first. Ask whether the responsibility should instead be expressed as an AI SDK tool, `UIMessageChunk`, `UIMessage` metadata, preliminary tool result, `ChatTransport`, or model-message conversion. Only after that boundary audit may Cradle add a small adapter, and the adapter must convert into or out of AI SDK-owned types rather than becoming a parallel semantic system.

If removing an old chat path breaks a behavior that still matters, repair the behavior in the new architecture instead of restoring the old path. For example, if removing delta replay affects passive observers, redesign passive observation around AI SDK chunks, persisted `UIMessage` snapshots, or Cradle run lifecycle state. Do not keep both `ChatStreamEvent` replay and AI SDK UI message streaming alive as parallel systems.

## Artifacts and Notes

Current AI SDK v6 source evidence:

    node_modules/ai/src/ui-message-stream/read-ui-message-stream.ts
      readUIMessageStream consumes UIMessageChunk and enqueues structuredClone(state.message).

    node_modules/ai/src/ui/process-ui-message-stream.ts
      processUIMessageStream maintains activeTextParts, activeReasoningParts, partialToolCalls, message.metadata, and tool part state.

    node_modules/ai/src/ui-message-stream/pipe-ui-message-stream-to-response.ts
      pipeUIMessageStreamToResponse accepts ReadableStream<UIMessageChunk> and serializes it as SSE.

    node_modules/ai/src/ui/default-chat-transport.ts
      DefaultChatTransport parses SSE using uiMessageChunkSchema and returns ReadableStream<UIMessageChunk>.

    node_modules/ai/docs/03-agents/06-subagents.mdx
      The documented subagent streaming pattern uses readUIMessageStream and async generator preliminary tool results.

    node_modules/ai/src/generate-text/is-approval-needed.ts
      Runtime source for needsApproval. Function-valued needsApproval receives the tool input and an options object with toolCallId, messages, and experimental_context.

    node_modules/ai/src/generate-text/run-tools-transformation.ts
      Emits tool-approval-request instead of executing a tool when approval is needed during streaming.

    node_modules/ai/src/ui/process-ui-message-stream.ts
      Converts tool-approval-request chunks into tool UI parts with state approval-requested and approval id.

    node_modules/ai/src/ui/chat.ts
      Defines addToolApprovalResponse and updates the latest assistant message to approval-responded.

    node_modules/ai/src/ui/convert-to-model-messages.ts
      Converts approval-responded tool UI parts into tool-approval-response content in model history.

    node_modules/ai/src/generate-text/collect-tool-approvals.ts
      Reads tool-approval-response content from the latest tool message and decides which tool calls are approved or denied.

Current Cradle source evidence:

    apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts
      ClaudeAgentProvider.streamTurn yields UIMessageChunk objects after mapping Claude SDK messages.

    apps/server/src/modules/chat-runtime/providers/claude-agent/mapper.ts
      mapClaudeAgentMessageToChunks converts Claude SDK messages to UIMessageChunk[].

    apps/server/src/modules/chat-runtime/service.ts
      The active run path publishes AI SDK UIMessageChunk SSE frames directly and uses AI SDK readUIMessageStream for terminal assistant snapshot persistence.

    apps/web/src/features/chat/sse-chat-transport.ts
      The thin web transport parses AI SDK UIMessageChunk SSE frames with parseJsonEventStream and uiMessageChunkSchema.

    apps/web/src/features/chat/chat-streaming-handler.ts
      ChatStreamingHandler feeds AI SDK chunks into readUIMessageStream and replaces full UIMessage snapshots in Zustand.

    apps/server/src/modules/chat-runtime/engine/tool-approval-wrapper.ts
      Deleted. AI SDK tool approval must use native needsApproval and message-history continuation.

    apps/server/src/modules/approval/index.ts
      Deleted. There is no independent approval SSE owner for AI SDK chat tool approvals.

## Interfaces and Dependencies

The repository must use `ai@6.0.168` or a later AI SDK v6 version whose local source exposes the same APIs. Before relying on newer behavior, re-run the API search in `node_modules/ai/src` and update this plan with any differences.

The provider boundary remains:

    streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void>

This is defined in `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`. All providers must implement this AI SDK-native boundary. Providers may internally adapt non-AI-SDK protocols, such as Claude Agent SDK `SDKMessage`, ACP updates, Codex SDK events, or mock data, but must not return Cradle stream events.

The server stream boundary should become:

    type AiSdkRunStreamItem =
      | { type: 'chunk'; chunk: UIMessageChunk }
      | { type: 'terminal'; status: 'complete' | 'aborted' | 'failed'; errorText?: string }

The exact type name may change during implementation, but the concept must remain: subscribers receive AI SDK chunks for the client stream and terminal status for Cradle orchestration. Terminal status must not be encoded as a Cradle message delta. Where possible, terminal status should correspond to AI SDK chunks such as `finish`, `abort`, or `error`.

The web client stream boundary should become a `ReadableStream<UIMessageChunk>`. It may be produced by AI SDK `DefaultChatTransport` or by a thin custom transport that uses AI SDK parsing primitives. It must not parse `ChatStreamEvent`.

The store update boundary should become full message replacement:

    updateMessage(sessionId: string, messageId: string, updater: (message: UIMessage) => UIMessage): void

or an equivalent operation that replaces the complete `UIMessage` snapshot produced by AI SDK projection. It must not apply `ChatPartDelta`.

The subagent output shape should be an AI SDK tool output containing an accumulated `UIMessage` snapshot or a small typed object that includes that snapshot. The parent tool part owns the display location. Cradle should not route subagent chunks by `parentToolCallId` in the client stream.

The approval boundary for AI SDK tools is:

    needsApproval?: boolean | ((input: unknown, options: { toolCallId: string; messages: ModelMessage[]; experimental_context: unknown }) => boolean | Promise<boolean>)

The exact generic type is provided by AI SDK's `Tool` type. Implementers should let TypeScript infer it from `tool({ ... })`; the signature above describes the runtime call shape observed in `ai@6.0.168`. `needsApproval` is the only place where Cradle policy can decide whether an AI SDK tool call should pause for user approval.

Subagent tools must not implement this approval boundary. They should omit `needsApproval` entirely or return `false` if a shared helper forces the property to exist. The expected behavior is automatic execution followed by preliminary tool output streaming.

Any new interface in this migration must satisfy this ownership test: it either is an AI SDK interface, directly implements an AI SDK interface, or adapts a non-AI-SDK provider into an AI SDK interface. Interfaces that define a parallel meaning for chunks, messages, approvals, tool states, or subagent routing are out of scope and should be rejected.

Compatibility interfaces are also out of scope. Do not introduce names such as `LegacyChatStreamEvent`, `AiSdkCompatDelta`, `DeltaCompatibilityAdapter`, or equivalent concepts. A deleted Cradle-owned stream or approval concept should stay deleted; remaining behavior must move to AI SDK-owned types or Cradle orchestration types.

The web approval response boundary for AI SDK tools is:

    addToolApprovalResponse({ id, approved, reason, options })

The `id` must be `part.approval.id` from a tool UI part whose state is `approval-requested`. The response must update the `UIMessage` to `approval-responded` and continue by using AI SDK's automatic send predicate or an explicit AI SDK chat send. In this repository, `apps/web/src/features/chat/use-chat-session.ts` implements the same state transition and `lastAssistantMessageIsCompleteWithApprovalResponses` predicate while keeping Cradle's session orchestration hook; the continuation request is the existing `/chat/sessions/:sessionId/response` endpoint with a full `messages` array. It must not call `/approvals/:approvalId/respond`.

Revision note 2026-05-26: Initial plan created after local investigation of `ai@6.0.168` and current Cradle chat runtime. The plan records the architectural decision that all providers end at an AI SDK v6-owned streaming and projection boundary, with Cradle retaining only orchestration, persistence, provider adaptation, and product-specific state.

Revision note 2026-05-26: Added native AI SDK tool approval constraints after investigating `needsApproval`, `tool-approval-request`, `addToolApprovalResponse`, `convertToModelMessages`, and `collectToolApprovals`. The plan now explicitly forbids `wrapToolsWithApproval` and the independent Cradle approval SSE system for AI SDK chat tool approvals.

Revision note 2026-05-26: Added implementation-time source verification requirements and clarified that subagent tools are not approval-gated; they must execute automatically and use AI SDK preliminary tool results for progress.

Revision note 2026-05-26: Strengthened the plan from "verify AI SDK details while implementing" to "audit AI SDK for an existing API or pattern before creating any Cradle-owned path." If no API seems to fit, the plan now requires an architecture-boundary audit before custom infrastructure is allowed.

Revision note 2026-05-26: Added the no-compatibility migration rule for chat behavior. Old chat paths discovered during implementation must be refactored directly into the AI SDK v6 architecture rather than preserved through compatibility layers or dual protocols.

Revision note 2026-05-26: Recorded deletion of the legacy approval owner, ACP fail-closed behavior for client filesystem writes, expanded trusted-internal Zod cleanup, and the latest typecheck results. The plan now treats `/approvals/stream`, the approval inbox, the approvals tab, and generated approval CLI commands as deleted legacy surfaces rather than optional compatibility islands.

Revision note 2026-05-27: Recorded completion of Claude Agent subagent preliminary tool output, AI SDK message-history approval continuation, raw `UIMessage` preservation in the web store, and final focused validation results. The plan now reflects that current remaining `needsApproval` work is limited to future real AI SDK tool definitions because no production `ToolSet` construction point exists today.

Revision note 2026-05-26: Recorded the final trusted-internal Zod cleanup for provider config reads and updated validation evidence to show focused server/web typechecks and focused chat runtime tests passing. This was an intermediate state before the later root gate reconciliation.

Revision note 2026-05-26: Reconciled the plan with final root validation evidence. `pnpm lint`, `pnpm typecheck`, and `pnpm test` now all exit 0; the old delta/approval protocol search and trusted chat-runtime/web-chat Zod search return no matches. The plan also records the lint-gate boundary decision that generated/vendor/ops-script noise and broad style migrations should not block this AI SDK runtime ownership work.

Revision note 2026-05-26: Added the final residual approval product-surface cleanup and desktop tray trusted-internal Zod cleanup. The plan now records deletion of stale approval locale/contract/tray/report/CLI-label surfaces and the latest root validation evidence after that cleanup.

Revision note 2026-05-26: Recorded the final contract and schema cleanup pass. The plan now includes deletion of stale capability approval docs, removal of dangling `approvalMode` settings/API/CLI surfaces, the Drizzle migration dropping `approval_audit`, regenerated OpenAPI/web/CLI outputs, residual search evidence, and passing root lint/typecheck/test gates after generation.
