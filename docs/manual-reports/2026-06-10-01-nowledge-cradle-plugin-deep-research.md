# Nowledge Mem vs Cradle Plugin Deep Research

Date: 2026-06-10

Nowledge source inspected: `nowledge-co/community@ac4059e0e2327b511095581bdfe7c6c2a4722f99`.

## Question

Can Cradle Plugin basically and comprehensively support Nowledge Mem? If not, what must we investigate or change?

## Short Verdict

Not comprehensively today.

Cradle Plugin can already support a useful, guided Nowledge adapter: status, Working Memory / Context Bundle reads, memory search, memory write/distill, thread search/read, graph and Nowledge FS browsing through `nmem` CLI, Nowledge HTTP API, or a plugin-bundled MCP bridge.

It cannot honestly claim full Nowledge support yet because Cradle's current plugin host does not provide enough chat-runtime lifecycle semantics for Nowledge's strongest integration tier:

- automatic pre-turn recall injection,
- real automatic session/thread capture,
- pre-compaction capture,
- host-owned transcript identity and boundaries,
- native HTTP/streamable MCP registration,
- universal agent tool exposure across all Cradle runtimes.

The right architecture is a Cradle-owned Nowledge adapter plugin that reads/writes only Nowledge-owned data through Nowledge API/CLI/MCP, while Cradle stores only plugin-local configuration, consent, and adapter state in Cradle namespaces.

## Evidence From Nowledge

Nowledge's community repo makes the registry the canonical source of truth for integrations, including capabilities, transport, thread-save method, and autonomy contract. See `nowledge-co/community@ac4059e:integrations.json:1`.

Nowledge's plugin development guide defines three integration transports:

- `nmem` CLI as universal fallback and real transcript import path.
- MCP for runtimes that natively speak MCP and can support overrideable endpoints.
- HTTP API for UI extensions where subprocess spawning is inappropriate.

Evidence: `nowledge-co/community@ac4059e:docs/PLUGIN_DEVELOPMENT_GUIDE.md:7`.

The same guide defines minimum and optional support:

- Minimum: Working Memory read, Search, Distill, Status.
- Optional/platform-dependent: Auto-recall, Auto-capture, Pre-compaction capture, Graph exploration, real Thread save, Slash commands, Space profile support.

Evidence: `nowledge-co/community@ac4059e:docs/PLUGIN_DEVELOPMENT_GUIDE.md:180`.

The CLI documentation at `https://mem.nowledge.co/zh/docs/cli` was inspected with a browser snapshot. It exposes:

- global JSON output, `--api-url`, and `--space`;
- memory list/search/add/show/update/deprecate/supersede/move/delete;
- thread list/search/show/create/append/save/delete/move, including `nmem t save --from claude-code|codex|gemini-cli`;
- Nowledge FS capabilities/ls/cat/stat/find/grep/recall/write/rm;
- Library sources, Working Memory, Spaces, Graph, Feed, Knowledge Communities, config/model/license/remote settings;
- JSON response examples and agent integration snippets.

The guide is explicit that real transcript save requires either `nmem t save --from <runtime>` or a host-native capture path, and must not be faked as an MCP tool. Evidence: `nowledge-co/community@ac4059e:docs/PLUGIN_DEVELOPMENT_GUIDE.md:28` and `nowledge-co/community@ac4059e:docs/PLUGIN_DEVELOPMENT_GUIDE.md:235`.

Nowledge's direct MCP config is HTTP streamable:

```json
{
  "mcpServers": {
    "nowledge-mem": {
      "url": "http://127.0.0.1:14242/mcp/",
      "type": "streamableHttp"
    }
  }
}
```

Evidence: `nowledge-co/community@ac4059e:README.md:75`.

The Codex integration is hybrid: plugin package + MCP + Stop hook + `nmem` fallback. It explicitly depends on lifecycle hooks and `nmem t save --from codex` for real transcript capture. Evidence: `nowledge-co/community@ac4059e:nowledge-mem-codex-plugin/README.md:16` and `nowledge-co/community@ac4059e:nowledge-mem-codex-plugin/README.md:141`.

OpenClaw is a useful reference for "full" support. It registers tools, context engine, corpus supplement, behavioral hooks, recall hooks, session lifecycle capture hooks, slash commands, and CLI subcommands. Evidence: `nowledge-co/community@ac4059e:nowledge-mem-openclaw-plugin/src/index.js:56`, `nowledge-co/community@ac4059e:nowledge-mem-openclaw-plugin/src/index.js:86`, and `nowledge-co/community@ac4059e:nowledge-mem-openclaw-plugin/src/index.js:150`.

Alma is the closest shape to what Cradle likely wants: HTTP API for data operations, chat hooks for recall/capture, and thread snapshots on idle/thread switch/quit. Evidence: `nowledge-co/community@ac4059e:nowledge-mem-alma-plugin/README.md:5`, `nowledge-co/community@ac4059e:nowledge-mem-alma-plugin/README.md:120`, and `nowledge-co/community@ac4059e:nowledge-mem-alma-plugin/README.md:132`.

## Follow-up API Findings

No usable machine-readable OpenAPI JSON was found at common paths such as `/openapi.json`, `/api/openapi.json`, `/docs/openapi.json`, or `/docs/api/openapi.json`; the API contract had to be verified from rendered docs pages.

The most important correction is that Cradle does not need a new Nowledge parser for the first real capture path. Nowledge already exposes direct thread creation, import, and append APIs:

- `POST /threads` creates a thread from `thread_id` and `messages`, with optional `title`, `participants`, `source`, `space_id`, `project`, `workspace`, `tool_version`, `import_date`, and `metadata`. The response includes `thread`, `messages`, `created_relationships`, `auto_generated_summary`, `extracted_memories`, and `auto_extraction_performed`.
- `POST /threads/{thread_id}/append` appends direct `messages` or imports from `file_path`, supports `deduplicate` defaulting to true, `idempotency_key`, and `space_id`, and returns `messages_added` plus `total_messages`.
- `POST /threads/import` imports one or more threads from JSON messages or universal conversation markdown. `thread_id` is optional, but Cradle should supply a stable one. This is a good manual/batch import surface for Cradle markdown or normalized message exports.
- `POST /threads/sessions/save` is not a generic Cradle path today. It only accepts `client: claude-code | codex | gemini-cli`, assumes the Nowledge backend machine can read local session files directly, and says remote-safe capture should use `nmem t save --from ...` from the client machine.

Direct capture implication: a Cradle host hook can use `thread_id = cradle:<session-id>` or another stable Cradle-owned identity, send `source: "cradle"`, pass `workspace`, `project`, `tool_version`, and Cradle ids in `metadata`, then create/import once and append completed turns with `idempotency_key = cradle:<session-id>:<run-id>` or per-message external ids. Nowledge owns the stored thread and extracted memories; Cradle owns only adapter config and capture bookkeeping.

The recall/read/write surface is also enough for a useful guided adapter:

- `GET /context/bundle` returns owner/profile/policy/scope context for agents. It accepts `agent_id`, `source_app`, `host_agent_id`, `space_id`, and `include_working_memory` defaulting to true. The docs do not expand the 200 response schema.
- `GET /agent/working-memory` reads today's Working Memory by default, accepts `date` for an archived day, and accepts `space_id` defaulting to `"default"`.
- `POST /memories/search` takes `query`, `limit`, `include_entities`, `filter_labels`, `mode: deep | fast`, `space_id`, `unit_type`, event-date filters, recorded-date filters, and `temporal_context`. It returns memory results with scores, reasons, related entities, evolution context, and related links.
- `POST /memories` creates or upserts a memory with `content`, optional custom `id`, `title`, source thread/message provenance, `source`, `importance`, `confidence`, `labels`, `space_id`, `metadata`, temporal fields, and `unit_type`. The docs explicitly say provenance is only recorded when the caller supplies real ids it owns.
- `GET /threads/search` searches full threads with `query`, `mode`, `limit`, `source`, and `space_id`. `GET /threads/{thread_id}` returns thread metadata, paginated messages, related memories, entities, totals, and covered message ids.
- Nowledge FS is a preview path API behind Tree, `nmem fs`, and `mem_fs` MCP. It supports `capabilities`, `ls`, `cat`, `stat`, `find`, `grep`, `recall`, `write`, and `delete`. Writes are deliberately narrow and must go through canonical writable paths.
- `GET /spaces` returns the enabled flag plus space profile metadata: `id`, `key`, `name`, `aliases`, `description`, `icon`, `instructions`, `sharedSpaceIds`, `defaultRetrievalMode`, `usage`, `observed`, and `hasProfile`. `POST /spaces` creates a space profile with `name`, optional `id/key`, description, icon, instructions, shared spaces, and default retrieval mode.

Space implication: Cradle should pass one explicit or derived `space_id` only when Cradle has a real ambient lane. Nowledge's own plugin guide says not to invent a second vault/project-memory abstraction on top of `space_id`, not to silently mix shared spaces, and not to fake per-agent mapping when host identity is unclear.

## Evidence From Cradle

Cradle server plugins can register routes, MCP servers, skills, provider/issue sources, chat runtime providers, plugin storage, chat hooks, and an event bus. Evidence: `packages/plugin-sdk/src/server.ts:6`.

The current MCP registry only models `name`, `command`, `args`, and `env`; it does not model `url` or `type: streamableHttp`. Evidence: `apps/server/src/plugins/mcp-registry.ts:7`.

Registered MCP servers are consumed by Claude Agent, ACP, and Codex. OpenAI-compatible and System Agent do not currently expose compatible plugin-MCP injection. Evidence: `apps/server/src/modules/chat-runtime/README.md:83`.

Cradle plugin chat hooks exist as a registry. Evidence: `apps/server/src/plugins/hooks.ts:1`. Server plugin context exposes `ctx.hooks.chat.onBeforeQuery` and `ctx.hooks.chat.onAfterResponse`. Evidence: `apps/server/src/plugins/context.ts:209`.

But current search found no call sites for `runBeforeQueryHooks` or `runAfterResponseHooks` outside their own exports. This means registering the hooks is not enough to affect ordinary Cradle chat turns today. The current hook payload is also weak: before-query gets `messages`, `model`, `threadId`, and metadata; after-response gets `threadId`, `model`, optional usage, and duration, but not the assistant text, full transcript, session/workspace/agent identity, or compaction lifecycle. Evidence: `packages/plugin-sdk/src/server.ts:311`.

Cradle already owns a transcript reconstruction layer internally. Evidence: `apps/server/src/modules/chat-runtime/transcript.ts:1`. The Session module can export markdown and read messages. Evidence: `apps/server/src/modules/session/service.ts:816` and `apps/server/src/modules/session/service.ts:883`. These are not currently exposed as a plugin lifecycle capture contract.

Cradle Marketplace deep links are first-party-only today: `wibus-wee/Cradle`, `plugins/*`, and `@cradle/*`. Evidence: `apps/desktop/src/main/plugin-install-links.ts:31`, `apps/desktop/src/main/plugin-install-links.ts:107`, `apps/desktop/src/main/plugin-install-links.ts:116`, and `apps/desktop/src/main/plugin-install-links.ts:129`. The docs state the same restriction. Evidence: `documentations/content/docs/developers/plugins/install-links.mdx:46`.

## Follow-up Cradle Findings

There are clean Cradle insertion points, but they are not plugin contracts yet.

Pre-turn recall should enter after Cradle resolves the session turn context and before provider `streamTurn`. `startChatRun` resolves `turnContext` and passes `systemPrompt`, `transcript`, `history`, workspace id/path, and agent id into `executeRun`. Evidence: `apps/server/src/modules/chat-runtime/service.ts:3662` and `apps/server/src/modules/chat-runtime/service.ts:3673`.

Turn capture should run after final assistant projection is complete. `finalizeActiveRun` calls `finalizeFinalMessageProjection`, flushes tool inputs, appends terminal events, and records the final message in trace payloads. Evidence: `apps/server/src/modules/chat-runtime/service.ts:5211`. The terminal event writer stores `assistant_message.snapshot_recorded` and `run.completed | run.aborted | run.failed` with the run id and message id. Evidence: `apps/server/src/modules/chat-runtime/service.ts:1258`.

The plugin event bus is not enough today. The SDK exposes generic `ctx.events.on/emit`, but search found no host chat-runtime emissions into that bus. Evidence: `packages/plugin-sdk/src/server.ts:353` and `apps/server/src/plugins/event-bus.ts:10`.

Compaction remains provider-owned UI state, not a plugin lifecycle boundary. Codex has `thread/compact/start`, `contextCompaction` items, and `thread/compacted` projections, but there is no provider-neutral pre-compaction hook with transcript access. Evidence: `apps/server/src/modules/chat-runtime-providers/codex/README.md:16`.

MCP remains stdio-shaped end to end. The SDK and registry accept only `command`, `args`, and `env`; Claude Agent, ACP, and Codex project that exact shape into their upstream runtimes. Evidence: `packages/plugin-sdk/src/server.ts:89`, `apps/server/src/plugins/mcp-registry.ts:7`, `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts:224`, `apps/server/src/modules/chat-runtime-providers/acp/connection-manager.ts:48`, and `apps/server/src/modules/chat-runtime-providers/codex/provider.ts:2805`.

## Capability Matrix

| Nowledge capability | Current Cradle plugin support | Verdict |
| --- | --- | --- |
| Status | Plugin server route or web command can call `nmem status` / `/health`. | Supported |
| Working Memory / Context Bundle | Skill and/or MCP/HTTP call can expose it. Automatic injection needs runtime hook wiring. | Guided supported; automatic incomplete |
| Memory search | Skills, MCP, server route, or web panel can call CLI/API. | Supported |
| Distill / memory write | Skills/MCP/server route can call CLI/API with `NMEM_API_KEY` env or HTTP auth. | Supported with permission/config work |
| Thread search/show | CLI/API route or MCP tools can expose progressive retrieval. | Supported |
| Nowledge FS / KFS | `nmem fs` CLI and MCP `mem_fs` can expose paths/grep/recall. | Supported as adapter surface |
| Graph/community/feed/library/spaces | Nowledge API/CLI already has endpoints/commands; Cradle can wrap them in routes/tools/UI. | Supported, but breadth requires implementation |
| MCP direct HTTP transport | Cradle plugin MCP registry is stdio command-shaped only. | Not native; needs stdio bridge or registry upgrade |
| Agent tool exposure across all runtimes | MCP only reaches Claude Agent, ACP, Codex today. | Partial |
| Auto-recall before each Cradle turn | Hook APIs exist but are not wired into chat runtime. | Not supported today |
| Auto-capture at session end | No plugin lifecycle contract with full transcript and session boundary. | Not supported today |
| Pre-compaction capture | No plugin-facing pre-compaction hook with transcript path/payload. | Not supported today |
| Slash commands | Cradle has web commands and provider runtime presentation capabilities, but no generic plugin slash-command registry matching OpenClaw/Codex. | Partial |
| Space profile support | Can pass fixed `space`, env `NMEM_SPACE`, or `space_id`; derived lane needs host identity/workspace mapping. | Partial |
| Third-party marketplace distribution | Current install link policy is first-party-only. | Not supported today |

## Recommended Architecture

Build a first-party `@cradle/nowledge-mem` plugin first, not a generic third-party import.

Layer split:

- Server layer owns Nowledge client config, health/status routes, Nowledge API/CLI proxy routes, MCP registration, skills, and chat lifecycle registrations.
- Web layer owns settings, diagnostics, a memory/search/thread panel, and command palette entries.
- Desktop layer is optional; use it only if we need local CLI discovery, config-file reading, or OS-specific install help. Do not write to Nowledge config unless Nowledge provides a stable owner API/CLI command for it.

Data ownership:

- Nowledge owns memories, threads, spaces, sources, graph, feed, config, and remote API credentials.
- Cradle owns only plugin-local state: selected mode, endpoint preference, consent/grants, UI settings, and cached non-authoritative diagnostics.
- Do not write to `~/.agents/skills`, `~/.nowledge-mem`, Codex config, or other product namespaces directly unless the target owner exposes a command/API and the user explicitly asks.

Transport plan:

1. HTTP API first for structured operations and UI.
2. `nmem` CLI fallback for diagnostics and real transcript import once Cradle has a supported runtime identifier or import path.
3. MCP for agent tools, initially via stdio bridge if we keep current Cradle MCP schema.
4. Upgrade Cradle MCP registry to support streamable HTTP natively if Nowledge is expected to be a first-class integration.

## Required Cradle Host Upgrades For "Basically Full"

1. Wire plugin chat hooks into Chat Runtime.

   `onBeforeQuery` must run before provider input is finalized and be able to inject bounded context parts. `onAfterResponse` must run after final assistant content is available.

2. Replace the weak hook payload with a real lifecycle contract.

   Minimum fields: session id, workspace id/path, agent id, runtime kind, provider target, user message id/content, assistant message id/content after completion, transcript window, run id, abort/cancel state, and metadata.

3. Add session lifecycle hooks.

   Needed events: session start/resume, turn start, before provider prompt build, after assistant final message, session archive/delete, session close/end if available.

4. Add compaction lifecycle hooks.

   Needed events: before compaction/pre-compression with transcript access, after compaction for reload/recall only. This mirrors Nowledge's rule that pre-compaction capture must happen before possible data loss.

5. Expose a plugin-safe transcript export API.

   It should use Cradle-owned transcript reconstruction, not raw DB access. It should support full export for capture and bounded export for prompt context.

6. Extend MCP registration.

   Model both stdio and streamable HTTP:

   - stdio: `{ type: "stdio", command, args, env }`
   - streamable HTTP: `{ type: "streamableHttp", url, headers? }`

   Providers that cannot consume a transport should fail closed or require a host-owned proxy.

7. Add a provider-neutral plugin tool registry or make MCP available to all runtimes.

   Otherwise Nowledge tools remain unavailable in OpenAI-compatible/System Agent sessions.

8. Add plugin configuration and secret UX.

   Need sensitive fields for `NMEM_API_KEY`, endpoint URL, mode, fixed space, derived space template, and maybe a "use local desktop" default. Secrets must not appear in CLI args or logs.

9. Decide marketplace policy.

   Either keep Nowledge first-party under `plugins/nowledge-mem`, or design a third-party plugin install policy. Current Marketplace deep links cannot install from `nowledge-co/community`.

## Remaining Investigation

1. Live Nowledge API validation.

   The rendered docs are sufficient for architecture, but implementation should still run live smoke calls against a local or remote Nowledge instance for `context/bundle`, Working Memory, memory search/create, thread create/import/append, FS read/search, and spaces because no machine-readable OpenAPI artifact was found.

2. Cradle transcript identity.

   Decide the stable `thread_id` scheme and metadata shape for Cradle sessions. The current best path is direct HTTP create/import/append with `source: "cradle"`; a Nowledge-owned `source_app=cradle` parser is optional, not a prerequisite.

3. Hook semantics and ordering.

   Decide exactly where a Nowledge pre-turn recall block enters the provider input for each runtime: Codex, Claude Agent, ACP, OpenAI-compatible, System Agent.

4. MCP transport compatibility.

   Validate whether Cradle's target providers can accept streamable HTTP MCP directly if registry supports it, or whether each provider needs translation.

5. Space mapping.

   Decide Cradle's honest ambient lane source: workspace path, agent persona, profile, explicit plugin setting, or no default. Do not invent per-agent routing unless Cradle exposes a stable identity.

6. Secret and remote mode.

   Decide whether the plugin reads Nowledge shared config through `nmem config client`, asks user for API URL/key in Cradle, or supports both with clear precedence.

7. E2E proof.

   A credible proof should send a unique marker through a Cradle chat session, verify it appears in Nowledge via `nmem t search` / `nmem t show`, and verify memory search/Working Memory retrieval in a fresh Cradle turn.

## Recommended First Implementation Slice

The first slice should be a narrow host lifecycle upgrade plus a thin Nowledge adapter, not a large Nowledge UI.

Host API changes:

- Replace the current weak chat hooks with a real chat lifecycle contract, or add a new versioned contract beside them.
- Add a pre-provider-input hook at the `resolveTurnContext` boundary. It should allow bounded context injection as host-owned prompt context, not arbitrary mutation of provider-native state.
- Add a turn-completed hook at the `finalizeActiveRun` boundary. It should include session id, run id, user message id/content, assistant message id/content, runtime kind, provider target, model, workspace id/path, agent id, status, usage, and a plugin-safe transcript export function.
- Add a pre-compaction hook only where a provider can actually expose it before data loss. For providers without such a boundary, the plugin must report no pre-compaction capture.
- Add a plugin-safe transcript export API using Cradle's transcript/session reconstruction, not raw database access.

Nowledge adapter behavior:

- Store only Cradle-owned adapter config/state: endpoint, auth secret reference, mode, selected/derived space policy, capture consent, last captured run/message cursor, and diagnostics cache.
- Use HTTP first for `context/bundle`, Working Memory, memory search/create, thread search/read/import/append, FS read/search, and spaces.
- Use `source: "cradle"` and stable Cradle ids in `metadata`.
- Create/import the Nowledge thread once, then append completed turns with dedupe/idempotency.
- Register MCP through a stdio bridge initially, unless Cradle's MCP registry is upgraded to support `type: "streamableHttp"`.
- Treat `nmem` CLI as diagnostics and local import fallback, not as a place for Cradle to write Nowledge config files directly.

## Proposed Phased Plan

Phase 0: honest guided adapter.

- Add server routes for health/status, context bundle, Working Memory, memory search/create, thread search/read/import/append, Nowledge FS read/search, and spaces, backed by HTTP API with CLI diagnostics fallback.
- Register Nowledge skills: working-memory, search-memory, distill-memory, thread-search/thread-show, save-thread/status.
- Add web panel and commands for status/search/settings.
- Register MCP via stdio bridge if needed.

This achieves useful support without claiming automatic capture.

Phase 1: host lifecycle upgrade.

- Wire plugin hooks into Chat Runtime.
- Add transcript export and lifecycle event payloads.
- Add pre-compaction hook.
- Add secret/config UX.

This enables automatic recall and real capture.

Phase 2: first-class Nowledge integration.

- Native streamable HTTP MCP registration.
- Provider-neutral tool availability or universal MCP injection.
- Direct HTTP create/import/append capture with `source: "cradle"` and stable Cradle metadata, or a Nowledge-owned `source_app=cradle` importer if Nowledge adds one later.
- Space mapping and plugin settings.
- E2E smoke against a temporary Nowledge space.

## Final Answer

Cradle Plugin can support Nowledge meaningfully now, but only at the guided/manual and partial MCP level. It cannot yet support Nowledge "basically comprehensively" in the sense Nowledge uses for high-quality native integrations, because the missing pieces are host lifecycle semantics, transcript capture, pre-compaction capture, and MCP transport/tool availability.

The highest-leverage next move is not to write a big Nowledge UI first. It is to make Cradle's plugin lifecycle real for chat turns: hook wiring, transcript export, compaction/session events, and MCP transport expansion. The new API finding improves the path: once Cradle exposes reliable turn lifecycle data, Nowledge can be fed directly through thread create/import/append APIs without waiting for a Cradle-specific Nowledge parser.
