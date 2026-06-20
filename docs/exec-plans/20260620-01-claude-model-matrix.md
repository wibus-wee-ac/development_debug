# Add Claude model matrix defaults and chat-session overrides

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not currently contain a root `PLANS.md`; this document was authored according to `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The non-negotiable rules are: keep the plan self-contained, explain terms in plain language, update the living sections at each stopping point, and validate the work through observable behavior rather than only compiling code.

## Purpose / Big Picture

Cradle can already run direct Chat Sessions with the Claude Agent runtime, and the runtime can already pass Claude Code model aliases through environment variables. The missing user-facing behavior is that a user who opens a direct Chat Session and selects a Claude-compatible provider can only choose one main model; haiku, sonnet, opus, and subagent traffic all fall back to that one model unless the user creates an Agent and configures aliases in Agent detail. After this change, a user can configure a Claude model matrix directly in Provider Settings as the provider target default, override it for a single Chat Session without creating an Agent, and see the effective matrix that will be used on the next Claude turn.

A "model matrix" in this plan means the mapping from Claude Code's model aliases to real provider model IDs. Claude Code asks for aliases such as `haiku`, `sonnet`, and `opus`; Cradle converts those aliases into the environment variables `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, and `ANTHROPIC_DEFAULT_OPUS_MODEL` before starting a Claude Agent SDK turn. This plan does not create named templates, new database tables, or heuristic model guessing. The provider default is just provider target configuration, and the session override is just chat session configuration.

## Progress

- [x] (2026-06-20 02:17Z) Read the ExecPlan skill and PLANS rules, then confirmed the plan must be self-contained, living, and validation-oriented.
- [x] (2026-06-20 02:17Z) Researched the existing Claude Agent model alias implementation, direct Chat Session runtime settings, Provider Settings persistence, and provider target refresh paths.
- [x] (2026-06-20 02:17Z) Decided that this feature needs an ExecPlan because it touches server runtime config, provider target ownership, generated API clients, Chat composer UI, and Provider Settings UI.
- [x] (2026-06-20 02:31Z) Implemented server shared Claude model matrix helpers in `apps/server/src/modules/provider-contracts/claude-agent-config.ts`; normalized aliases are trimmed, and empty matrices remove `claudeAgent.modelAliases`.
- [x] (2026-06-20 02:34Z) Extended session runtime settings so `GET` returns `claudeAgent` and `PATCH` can persist or clear `sessions.config_json.claudeAgent.modelAliases` without changing access/interaction semantics.
- [x] (2026-06-20 02:36Z) Added provider target default matrix persistence through `PATCH /provider-targets/:providerTargetId/model-settings`, writing only `provider_targets.connection_config_json.claudeAgent.modelAliases`.
- [x] (2026-06-20 02:38Z) Preserved Cradle-owned provider target matrix preferences across external provider source refresh by merging existing aliases into the refreshed target config.
- [x] (2026-06-20 02:44Z) Added focused server tests for session runtime-settings persistence, Claude SDK env injection from session overrides, and external refresh preservation.
- [x] (2026-06-20 02:48Z) Ran `pnpm generate:web` and `pnpm gen:cli`; generated web API files and the CLI runtime-settings set command reflect the new schema.
- [x] (2026-06-20 02:53Z) Added Provider Settings controls for manual and external provider defaults using a shared `ClaudeModelMatrixEditor`; manual providers save through existing profile config, external providers save through provider-target model settings.
- [x] (2026-06-20 02:55Z) Added direct Chat Session Claude matrix popover in the composer toolbar for Claude Agent sessions, with use-provider-default, override-session, set-all-to-current, and save-provider-default actions.
- [x] (2026-06-20 02:57Z) Updated server/web READMEs and this ExecPlan with implementation results, validation output, and design decisions discovered while coding.
- [x] (2026-06-20 03:12Z) Split the generic run-time `runtimeSettings` schema from the persisted session runtime-settings schema so `/chat/sessions/:id/response` and side conversation sends expose only access/interaction, while `/chat/sessions/:id/runtime-settings` owns `claudeAgent` persistence.
- [x] (2026-06-20 03:16Z) Split the matching web TypeScript types into transient `ChatRuntimeSettingsPatch` and persisted `SessionRuntimeSettingsPatch`, fixed targeted lint issues, regenerated API/CLI projections, and reran focused validation.
- [x] (2026-06-20 03:23Z) Fixed the web typecheck blocker by importing the existing `CodexAuthModeToggle` into `draft-setup-panel.tsx`, keyed the preset setup form by `preset.id` so preset changes remount instead of synchronizing reset state through an effect, and confirmed `pnpm typecheck:apps-web` exits 0.

## Surprises & Discoveries

- Observation: The Claude Agent runtime provider already strips inherited model-related environment variables before setting Cradle-controlled aliases.
  Evidence: `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` deletes `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, and `CLAUDE_CODE_SUBAGENT_MODEL`, then calls `buildClaudeAgentModelEnv`.

- Observation: Empty alias values already fall back to the effective main model.
  Evidence: `buildClaudeAgentModelEnv` computes `haiku`, `sonnet`, `opus`, and `subagentModel` as the trimmed alias value or `config.model`.

- Observation: Direct Chat Session config is already merged after provider target config and after Agent config.
  Evidence: `apps/server/src/modules/chat-runtime/runtime-session-context.ts` builds `effectiveProfile.configJson` with `...profileConfig`, `...targetModelRegistryConfig`, `...agentConfig`, and finally `...sessionConfig`. This means `sessions.config_json.claudeAgent.modelAliases` can override provider defaults and Agent settings without a new merge layer.

- Observation: The existing `/chat/sessions/:sessionId/runtime-settings` route only reads and writes `runtimeSettings.accessMode` and `runtimeSettings.interactionMode`.
  Evidence: `apps/server/src/modules/chat-runtime/runtime-settings.ts` reads `config.runtimeSettings` and ignores top-level provider-specific config such as `claudeAgent`.

- Observation: Provider Settings for manual providers already saves arbitrary passthrough config fields.
  Evidence: `apps/web/src/features/agent-runtime/profile-config-schema.ts` uses `.passthrough()`, and `apps/web/src/features/agent-management/profile-detail-panel.tsx` keeps unknown fields through `buildProfileConfig` by spreading `...rest`.

- Observation: External provider target refresh currently overwrites `connection_config_json` with the external record snapshot.
  Evidence: `apps/server/src/modules/external-provider-sources/service.ts` writes `connectionConfigJson: JSON.stringify(record.config)` during insert and conflict update. Any Cradle-owned provider target default matrix stored there must be explicitly preserved during refresh.

- Observation: The filtered script form `pnpm --filter @cradle/server test -- chat-runtime` does not filter to the chat runtime file in this workspace; it ran the full server suite.
  Evidence: The command executed `vitest run -- chat-runtime` and reported unrelated failures in `pty-websocket.test.ts`, `automation.test.ts`, `chronicle.test.ts`, and `observability.test.ts`. Exact file commands such as `pnpm --filter @cradle/server exec vitest run tests/sdk-providers.test.ts` worked.

- Observation: The full `chat-runtime.test.ts` file can fail one existing title-generation diagnostics assertion when run with all tests, but the failing test passes alone and the new Claude matrix runtime-settings test passes alone.
  Evidence: `pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts` failed `reports Codex session title regeneration provider failures with diagnostics` with an empty events list; `pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts -t "reports Codex session title regeneration provider failures with diagnostics"` passed.

- Observation: Web typecheck was blocked by an unrelated existing missing import outside the matrix code, but the fix was small enough to apply so the plan's validation gate can pass.
  Evidence: `pnpm typecheck:apps-web` originally failed with `src/features/agent-management/draft-setup-panel.tsx(411,28): error TS2552: Cannot find name 'CodexAuthModeToggle'. Did you mean 'codexAuthMode'?`. After importing `CodexAuthModeToggle` from `./codex-auth-mode-controls`, the same command exits 0.

- Observation: Reusing the same `runtimeSettingsPatchSchema` for both one-off response sends and persisted session settings made the generated API imply that `runtimeSettings.claudeAgent` could be sent on `/chat/sessions/:id/response`, even though only `/chat/sessions/:id/runtime-settings` persists it.
  Evidence: After splitting the schema, regenerated `apps/web/src/api-gen/types.gen.ts` shows `PostChatSessionsBySessionIdResponseData.body.runtimeSettings` with only `accessMode` and `interactionMode`, while `PatchChatSessionsBySessionIdRuntimeSettingsData.body` still includes `claudeAgent`.

- Observation: `react-doctor` reports broad React Compiler and state-derivation issues in changed frontend files, mostly from pre-existing component structure rather than this matrix feature. After touching `draft-setup-panel.tsx` to unblock web typecheck, React Doctor also scans that file and reports its existing component-size and effect-driven state issues.
  Evidence: `npx -y react-doctor@latest . --verbose --diff` completed with score `63 / 100 Needs work` after scanning six changed files. It still flags existing patterns such as effect-driven state sync in `chat-runtime-view.tsx`, `profile-detail-panel.tsx`, `external-provider-record-detail-panel.tsx`, and `draft-setup-panel.tsx`.

## Decision Log

- Decision: Do not create a matrix template table or a named template concept.
  Rationale: The user's pain is that direct Chat Sessions cannot configure a Claude model matrix without creating an Agent. A named template resource would introduce ownership, ordering, deletion, migration, and cross-provider compatibility questions that are not needed to solve this. Provider target default plus session override is enough.
  Date/Author: 2026-06-20 / Codex

- Decision: Store provider target defaults in existing `provider_targets.connection_config_json.claudeAgent.modelAliases`.
  Rationale: The provider target owns endpoint compatibility and default runtime behavior. The existing column already stores provider target connection/runtime configuration, is returned by provider target model settings, and is merged into Chat Runtime profiles.
  Date/Author: 2026-06-20 / Codex

- Decision: Store direct Chat Session overrides in existing `sessions.config_json.claudeAgent.modelAliases`.
  Rationale: Chat Runtime already merges `sessions.config_json` last, so this provides per-session override without new tables, new projection layers, or Agent creation.
  Date/Author: 2026-06-20 / Codex

- Decision: Reuse and extend the existing session runtime settings route instead of adding a new session config route.
  Rationale: The user explicitly rejected adding more structure. The existing route is already the Chat Session settings command boundary. The implementation should extend its body and response to include Claude Agent matrix override as a top-level sibling of `runtimeSettings`, while continuing to persist `accessMode` and `interactionMode` under `config.runtimeSettings`.
  Date/Author: 2026-06-20 / Codex

- Decision: Treat external provider target defaults as Cradle-owned provider target preferences that must survive source refresh.
  Rationale: External sources own source snapshots, but Cradle owns the projected `provider_targets` row and already preserves Cradle-owned preferences such as visible models. Preserving `claudeAgent.modelAliases` during refresh avoids writing to the external source namespace and avoids a new table.
  Date/Author: 2026-06-20 / Codex

- Decision: Do not infer haiku, sonnet, or opus mappings from model names.
  Rationale: The repository guidance forbids heuristic solutions unless discussed first. Users should choose explicit models from the provider target inventory or use the current model for all aliases.
  Date/Author: 2026-06-20 / Codex

- Decision: Preserve existing provider target `claudeAgent.modelAliases` over refreshed external source aliases when both exist.
  Rationale: Without a new column, the row cannot distinguish "source supplied this alias" from "user edited this provider target default in Cradle". The explicit user edit must survive refresh, and this plan intentionally avoids new tables or metadata columns.
  Date/Author: 2026-06-20 / Codex

- Decision: Split HTTP input patch types from normalized matrix config types on the server.
  Rationale: TypeBox request bodies allow partial alias objects such as `{ haiku?: string }`, while persisted/runtime config uses complete `{ haiku, sonnet, opus }` strings after trimming. Keeping those as separate types avoided pretending a partial request was already a complete matrix.
  Date/Author: 2026-06-20 / Codex

- Decision: Keep `claudeAgent` out of one-off response `runtimeSettings` and expose it only through the persisted session runtime-settings command boundary.
  Rationale: A matrix override changes the next Claude Agent SDK subprocess environment by writing session config. Passing it as a transient `runtimeSettings` field on a single response would be misleading unless the run start path also persisted or separately merged it. Splitting the schemas and web types keeps the API honest: transient sends carry access/interaction only, while session settings carry `claudeAgent`.
  Date/Author: 2026-06-20 / Codex

- Decision: Fix the missing `CodexAuthModeToggle` import even though it is outside the Claude matrix surface.
  Rationale: The ExecPlan's validation section requires `pnpm typecheck:apps-web` to pass. The blocker was a one-line import of an existing component and did not change provider setup semantics. Leaving it broken would make completion unprovable.
  Date/Author: 2026-06-20 / Codex

- Decision: Remount `PresetSetupForm` by `preset.id` instead of keeping a preset-change reset effect.
  Rationale: Once `draft-setup-panel.tsx` entered the diff to fix typecheck, React Doctor reported an effect that copied prop changes into multiple state setters. Keying the form by preset ID is simpler and preserves the intended behavior: choosing a different preset starts a fresh setup form.
  Date/Author: 2026-06-20 / Codex

## Outcomes & Retrospective

Implementation is complete for the server API, generated clients, Provider Settings UI, direct Chat Session UI, and focused server coverage. Users can now set Claude Agent haiku / sonnet / opus aliases at the provider target default level, override the matrix for one direct Chat Session, clear the session override back to provider default, set all aliases to the current model, and save a session draft back as the provider default without creating a new Agent or table. The final API shape intentionally keeps one-off response `runtimeSettings` limited to access/interaction settings and keeps matrix persistence under `/chat/sessions/:sessionId/runtime-settings`.

Validation passed for `pnpm generate:web`, `pnpm gen:cli`, `pnpm --filter @cradle/server typecheck`, `pnpm --filter @cradle/cli typecheck`, `pnpm typecheck:apps-web`, `pnpm --filter @cradle/cli cradle --help`, targeted web ESLint on the changed matrix command/control files plus `draft-setup-panel.tsx`, `pnpm --filter @cradle/server exec vitest run tests/sdk-providers.test.ts -t "model aliases"`, `pnpm --filter @cradle/server exec vitest run tests/external-provider-sources.test.ts -t "resolves provider target config and secret for provider operations"`, and `pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts -t "persists Claude Agent model matrix overrides in chat session runtime settings"`. `react-doctor` completed but reported existing React Compiler/state-structure findings in changed frontend files, so it is recorded as a quality finding rather than an acceptance gate for this matrix feature.

## Context and Orientation

Cradle stores provider targets in `provider_targets`. A provider target is one selectable model source, such as an Anthropic-compatible endpoint or a universal endpoint. Manual provider targets are user-authored; external provider targets are Cradle projections of external sources such as local Claude or CC Switch. The owner principle for this feature is that Cradle may read external source snapshots but should not write back to those external namespaces. Cradle may write Cradle-owned preferences to its own `provider_targets` row.

The server-side provider target module is `apps/server/src/modules/provider-targets/`. `service.ts` resolves provider target rows into runtime config, and `index.ts` exposes provider target APIs. The external source projection module is `apps/server/src/modules/external-provider-sources/`; its `service.ts` refreshes external records into `provider_targets`. If this plan stores provider defaults in `connection_config_json`, external refresh must preserve the Cradle-owned nested `claudeAgent.modelAliases` field when replacing source-owned config fields.

The Chat Runtime module is `apps/server/src/modules/chat-runtime/`. A Chat Session row has a `config_json` column. `runtime-session-context.ts` merges provider target config, model registry config, Agent config, and session config into the `RuntimeProviderTargetProfile.configJson` passed to runtime providers. Because session config is merged last, a session-level `claudeAgent.modelAliases` object naturally overrides provider and Agent defaults. `runtime-settings.ts` and `runtime-settings-api.ts` currently handle only access and interaction mode settings for a session. This plan extends that existing boundary so direct Chat Sessions can persist a Claude matrix override without adding a separate route family.

The Claude Agent runtime provider is `apps/server/src/modules/chat-runtime-providers/claude-agent/`. The important file is `input-projector.ts`, which builds Claude Agent SDK query options and environment variables. It already reads the final merged provider config using `readTrustedClaudeAgentConfig`, removes inherited model environment variables, and sets alias environment variables from `config.claudeAgent.modelAliases`.

Provider Settings UI is in `apps/web/src/features/agent-management/`. Manual provider details are rendered by `profile-detail-panel.tsx`; model inventory and custom model controls are nearby. Provider config parsing lives in `apps/web/src/features/agent-runtime/profile-config-schema.ts`. This schema currently passes through unknown config fields, which prevents data loss when adding `claudeAgent` fields.

The direct Chat Session toolbar is in `apps/web/src/features/composer-toolbar/`, with `composer-toolbar.tsx`, `provider-model-selector.tsx`, `provider-model-picker.tsx`, and `provider-model-menu.tsx` forming the provider/model selector. Chat session persistence for selected provider and model is in `apps/web/src/features/chat/chat-runtime-view.tsx`. Client commands for session runtime settings are in `apps/web/src/features/chat/commands/runtime-settings-command.ts` and `apps/web/src/features/chat/runtime/use-runtime-settings.ts`.

Generated API clients live under `apps/web/src/api-gen/`, and generated CLI commands live under `packages/cli/src/commands/generated/`. Server route schema changes require running generation commands so the web app and CLI stay aligned with the OpenAPI surface.

## Plan of Work

First, introduce shared Claude model matrix helpers rather than duplicating parsing logic. The existing web Agent config file `apps/web/src/features/agent-runtime/agent-config-schema.ts` already defines `ClaudeAgentModelAliasesSchema`. Move or re-export the alias shape into a shared local module that both Agent detail, Provider Settings, and Chat Session UI can use. A suitable path is `apps/web/src/features/agent-runtime/claude-agent-config.ts`. It should define the three alias keys `haiku`, `sonnet`, and `opus`, default empty values, and helper functions to read aliases from an arbitrary config object and write aliases back while trimming empty strings. Do not use `unknown`-heavy inline parsing in React components; use the existing Zod schemas and plain typed helper inputs.

On the server, extend the trusted Claude Agent provider config schema in `apps/server/src/modules/provider-contracts/provider-base.ts` only if needed. It already accepts `claudeAgent.modelAliases` and `claudeAgent.subagentModel`. Keep this as the authoritative runtime shape. Add focused helper functions in `apps/server/src/modules/chat-runtime/runtime-settings.ts` to read and write the top-level `claudeAgent` session override alongside the existing `runtimeSettings`. Keep `runtimeSettings` as access/interaction mode only; do not nest model aliases under `runtimeSettings`, because `input-projector.ts` expects top-level `claudeAgent`.

Extend `apps/server/src/modules/chat-runtime/runtime-settings-model.ts`, `runtime-settings-api.ts`, and `model.ts` so `GET /chat/sessions/:sessionId/runtime-settings` returns the current `claudeAgent` session override and `PATCH /chat/sessions/:sessionId/runtime-settings` accepts a partial Claude Agent override. The response should continue to include `sessionId`, `runtimeSettings`, and `applied`. Add a field such as `claudeAgent` with `modelAliases` values normalized to strings. A patch with empty aliases should remove the override or store empty strings consistently so the runtime falls back to provider defaults or the current main model. The exact semantics should be: if all alias fields are blank, remove `config.claudeAgent.modelAliases`; if `claudeAgent` becomes empty, remove `config.claudeAgent` from `sessions.config_json`.

Add provider target default matrix update support in `apps/server/src/modules/provider-targets/service.ts`, `model.ts`, and `index.ts`. Prefer extending the existing provider target model settings boundary instead of creating a new table or new resource family. The implementation can add a `PATCH /provider-targets/:providerTargetId/model-settings` handler that accepts a provider-target-owned Claude Agent config patch and returns `ProviderTargetModelSettings`. This route is the write counterpart to the existing `GET /provider-targets/:providerTargetId/model-settings`. It must update only Cradle-owned provider target preferences inside `connection_config_json`, currently `claudeAgent.modelAliases`, and must not touch credentials, source metadata, enabled state, custom models, or source-owned endpoint fields.

In `apps/server/src/modules/external-provider-sources/service.ts`, preserve the existing provider target matrix when refreshing an external provider target. Before writing `JSON.stringify(record.config)`, merge the existing row's Cradle-owned `claudeAgent.modelAliases` into the new source config if the user has set one. If the external source itself supplies `record.config.claudeAgent.modelAliases`, prefer source-provided values until the user explicitly edits the provider target default through Cradle. If the implementation cannot distinguish source-provided aliases from user-edited aliases without a new column, prefer this simple rule: when existing aliases exist, preserve them over refreshed source aliases; document this in the Decision Log if implemented.

Add Provider Settings UI controls in `apps/web/src/features/agent-management/profile-detail-panel.tsx` for manual providers whose `providerKind` is `anthropic` or `universal`. Use existing `SettingsRow`, `SettingsDivider`, `Button`, and model picker/list patterns. The UI should show a compact "Claude model matrix" section after endpoint/credential settings and before the model inventory. It should contain three selectors for Haiku alias, Sonnet alias, and Opus alias. Each selector should draw from the provider target's available models, including custom models. It should include a command to set all aliases to the current default model, and a command to clear all aliases so the provider target falls back to its main model. For manual providers, saving can flow through the existing `putProfilesById` path because `buildProfileConfig` preserves passthrough config fields. For external provider target settings, use the provider-target model settings patch described above when editing is available in the external record detail panel.

Add direct Chat Session UI controls near the composer model selector. Keep it Claude-only: show the control only when `selection.runtimeKind === 'claude-agent'` and a provider target is selected. The control should display the effective matrix by combining provider target defaults and session overrides in the same order the server uses: provider target first, Agent if present, session override last. For direct Chat Sessions with no bound Agent, this means provider target default then session override. The UI should offer "Use provider default", "Override for this session", "Set all aliases to current model", and "Save as provider default". "Use provider default" removes the session override. "Override for this session" writes to `sessions.config_json.claudeAgent.modelAliases` through the existing runtime settings mutation. "Save as provider default" writes the current matrix to the provider target default using the provider target model settings patch, then removes the session override only if the saved default matches the desired session behavior.

Do not move Agent-specific controls out of Agent detail in this plan. Agent detail can keep its existing Claude Agent SDK alias section, but after this work it should be framed as an Agent override. If duplication becomes painful during implementation, extract a `ClaudeModelMatrixEditor` component inside `apps/web/src/features/agent-management/` or `apps/web/src/features/composer-toolbar/` only if it materially reduces duplicated picker code. Keep the component pure UI plus callbacks; persistence remains owned by Provider Settings and Chat Runtime hooks.

Update i18n strings in `apps/web/src/locales/default/agent-management.ts`, `apps/web/src/locales/default/common.ts`, and generated locale JSON files only where the existing codebase requires it. Keep copy short and functional. Do not add visible instructional text explaining internals; labels like "Claude model matrix", "Haiku alias", "Use provider default", and "Set all to current model" are enough.

Regenerate generated web API and CLI surfaces after server schema changes. Run `pnpm generate:web` for `apps/web/src/api-gen` and `pnpm gen:cli` if the OpenAPI route metadata changes generated CLI command shapes. Inspect generated diffs and keep only files that changed because of the schema updates.

## Concrete Steps

Work from repository root:

    cd /Users/wibus/dev/Cradle

Confirm the current working tree before editing so unrelated user changes are not reverted:

    git status --short

Expected output may contain unrelated files. Do not reset or checkout any user changes.

Implement the server config helpers first. Edit `apps/server/src/modules/chat-runtime/runtime-settings.ts` so it can read and write both the existing `runtimeSettings` object and a top-level `claudeAgent` override from session config JSON. Add small helper functions with stable names such as `readSessionClaudeAgentConfig`, `normalizeSessionClaudeAgentPatch`, and `writeSessionRuntimeConfigJson`. Keep `writeSessionRuntimeSettingsConfigJson` or update callers carefully so existing access/interaction behavior remains unchanged.

Update server schemas. Edit `apps/server/src/modules/chat-runtime/runtime-settings-model.ts` to define a TypeBox schema for Claude Agent alias patches, then edit `apps/server/src/modules/chat-runtime/model.ts` so `runtimeSettingsBody` accepts access/interaction fields plus optional `claudeAgent`, and `runtimeSettingsResponse` returns the session-level `claudeAgent` override. Edit `apps/server/src/modules/chat-runtime/runtime-settings-api.ts` to merge and persist both pieces.

Add provider target default persistence. Edit `apps/server/src/modules/provider-targets/model.ts`, `index.ts`, and `service.ts`. Add one service function that loads a provider target row, parses `connection_config_json`, updates `claudeAgent.modelAliases`, removes empty objects, writes the same row, and returns `getProviderTargetModelSettings(providerTargetId)`. The function must work for both `manual` and `external` rows because both are Cradle provider targets. Keep the update scoped to the nested `claudeAgent` field.

Preserve external provider target defaults during refresh. Edit `apps/server/src/modules/external-provider-sources/service.ts` near `upsertRuntimeTargetForRecord`. Parse `existing.connectionConfigJson`, extract existing `claudeAgent.modelAliases`, and merge that field into the incoming `record.config` before writing `connectionConfigJson`. Keep source-owned endpoint fields from `record.config`.

Add or update server tests. Start in `apps/server/tests/chat-runtime.test.ts` because existing runtime settings tests already live there. Add a test that patches `/chat/sessions/:id/runtime-settings` with `claudeAgent.modelAliases`, verifies the response returns the override, verifies the persisted `sessions.config_json` has top-level `claudeAgent`, and verifies a subsequent Claude Agent run receives the aliases through `ANTHROPIC_DEFAULT_*` environment variables. If reusing the full Claude Agent SDK test harness is simpler, add a focused test beside the existing "applies Claude Agent SDK model aliases from agent settings to chat runs" in `apps/server/tests/sdk-providers.test.ts`. Add provider target service tests covering manual default save and external refresh preservation.

Regenerate API clients:

    pnpm generate:web
    pnpm gen:cli

If `pnpm gen:cli` changes no files, note that in the ExecPlan. If it changes generated command files for runtime settings, keep those generated changes.

Add web shared helpers. Edit or create `apps/web/src/features/agent-runtime/claude-agent-config.ts` and update `agent-config-schema.ts` to reuse it. Add typed helpers for reading matrix values from profile, agent, and session config strings. The helpers should return `{ haiku: string, sonnet: string, opus: string }` with blank strings for missing aliases.

Add Provider Settings UI. Edit `apps/web/src/features/agent-management/profile-detail-panel.tsx` to add matrix fields to `ProfileDetailFormValues`, `getProfileFormValues`, `createProfileSignature`, `watchedSignature`, and `buildProfileConfig`. Render the matrix section only for `providerKind === 'anthropic' || providerKind === 'universal'`. Use static Tailwind classes and the existing `cn()`/`~/lib/cn` helper where conditional classes are needed. Do not construct dynamic Tailwind class names.

Add Chat Session UI. Edit `apps/web/src/features/chat/commands/chat-response-command.ts`, `runtime-settings-command.ts`, `runtime/use-runtime-settings.ts`, `chat-runtime-view.tsx`, and the composer toolbar components needed to pass runtime settings update callbacks down to the model selector area. The resulting UI must allow setting session overrides without creating an Agent. Keep changes scoped; do not redesign the composer.

Update docs. Edit `apps/web/src/features/agent-management/README.md` and, if the Chat feature has a nearby README, update it to mention provider default matrix and session override ownership. Do not add marketing copy.

Run validation:

    pnpm --filter @cradle/server test -- chat-runtime
    pnpm --filter @cradle/server test -- sdk-providers
    pnpm typecheck:server
    pnpm typecheck:apps-web

If the filtered Vitest syntax does not match the workspace package scripts, run the nearest equivalent command and record the actual command and result in this ExecPlan.

Optionally run the full relevant suite after targeted tests pass:

    pnpm test

Because the user's repository guidance says not to add frontend component tests by default and not to use Browser testing unless requested, do not add React component tests or browser automation for this plan unless the implementation exposes behavior that cannot be verified by typecheck and server tests.

## Validation and Acceptance

The feature is accepted when these behaviors are true.

First, direct Chat Session overrides work without creating an Agent. Create or open a Chat Session using the Claude Agent runtime and an Anthropic-compatible or universal provider target. Select a main model such as `glm-5.2`. Open the Claude model matrix control, set Haiku to one model, Sonnet to another model, and Opus to another model, then save as a session override. Send a message. The server-side test should prove the next Claude Agent SDK query receives:

    ANTHROPIC_DEFAULT_HAIKU_MODEL=<selected haiku model>
    ANTHROPIC_DEFAULT_SONNET_MODEL=<selected sonnet model>
    ANTHROPIC_DEFAULT_OPUS_MODEL=<selected opus model>

Second, clearing the session override uses the provider default or main model fallback. Click "Use provider default" in the Chat Session matrix control. The session `config_json` should no longer contain a top-level `claudeAgent.modelAliases` override. A subsequent turn should use provider target defaults if present; if provider defaults are blank, `buildClaudeAgentModelEnv` should fall back to the effective main model for all three aliases.

Third, Provider Settings defaults work. In Provider Settings for an Anthropic-compatible manual provider, set the Claude model matrix and let autosave complete. Reload the provider settings panel. The three alias selectors should show the saved values. A new direct Chat Session using that provider should show those values as the effective provider default before any session override is set.

Fourth, external provider refresh does not destroy Cradle-owned defaults. For an external provider target with an existing `connection_config_json.claudeAgent.modelAliases`, run the external source refresh test or service-level test. The refreshed target should keep the aliases while updating source-owned fields such as endpoint, display name, and source fingerprint.

Fifth, existing runtime settings behavior remains intact. Existing tests around `accessMode`, `interactionMode`, pending runs, and applied status should still pass. If a runtime settings patch contains only access/interaction fields, it should not add or remove `claudeAgent`. If a patch contains only `claudeAgent`, it should not change access/interaction settings.

Expected command results after implementation:

    pnpm --filter @cradle/server test -- chat-runtime
    # Expected: all selected chat-runtime tests pass, including the new session Claude matrix override test.

    pnpm --filter @cradle/server test -- sdk-providers
    # Expected: all selected sdk-providers tests pass, including existing Agent alias tests.

    pnpm typecheck:server
    # Expected: exits 0 with no TypeScript errors.

    pnpm typecheck:apps-web
    # Expected: exits 0 with no TypeScript errors.

Actual validation during implementation:

    pnpm --filter @cradle/server typecheck
    # Passed: tsc --noEmit exited 0.

    pnpm generate:web
    # Passed: OpenAPI web generation completed and wrote apps/web/src/api-gen.

    pnpm gen:cli
    # Passed: Generated 245 CLI commands and updated the CLI skill manifest.

    pnpm --filter @cradle/server exec vitest run tests/sdk-providers.test.ts -t "model aliases"
    # Passed: 2 tests passed, including provider default and session override SDK env tests.

    pnpm --filter @cradle/server exec vitest run tests/external-provider-sources.test.ts -t "resolves provider target config and secret for provider operations"
    # Passed: 1 test passed, including external refresh preservation of claudeAgent.modelAliases.

    pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts -t "persists Claude Agent model matrix overrides in chat session runtime settings"
    # Passed: 1 test passed, 52 skipped.

    pnpm --filter @cradle/cli typecheck
    # Passed: tsc --noEmit exited 0.

    pnpm --filter @cradle/cli cradle --help
    # Passed: CLI help rendered command list and exited 0.

    pnpm --filter @cradle/web exec eslint src/features/agent-management/draft-setup-panel.tsx src/features/agent-runtime/claude-agent-config.ts src/features/agent-management/claude-model-matrix-editor.tsx src/features/chat/runtime/claude-session-model-matrix-control.tsx src/features/chat/runtime/use-runtime-settings.ts src/features/agent-management/provider-target-model-settings.ts src/features/chat/commands/chat-response-command.ts src/features/chat/commands/runtime-settings-command.ts
    # Passed: targeted ESLint exited 0 after import sorting and local hook/type cleanup.

    npx -y react-doctor@latest . --verbose --diff
    # Completed but not clean: score 63 / 100 with existing React Compiler/state-structure findings in changed frontend files.

    pnpm typecheck:apps-web
    # Passed: tsc --noEmit exited 0.

## Idempotence and Recovery

No database migration is planned. The implementation uses existing JSON columns: `provider_targets.connection_config_json` and `sessions.config_json`. Running the code multiple times should not duplicate data because the matrix is stored at stable JSON paths. Saving blank aliases should remove the override rather than writing accumulating tombstones.

If API generation produces unexpected generated-file churn, stop and inspect whether the server TypeBox schemas changed too broadly. Revert only generated files that are unrelated to this feature; do not revert user changes. If external provider refresh preservation accidentally overwrites source-owned fields, restore the refresh logic so `record.config` remains the base object and only the Cradle-owned `claudeAgent.modelAliases` preference is merged in.

If tests fail because an active Claude Agent run cannot accept a matrix update mid-stream, do not attempt to mutate the running SDK process environment. Record the behavior as "applies to next turn" and ensure UI copy and tests reflect that. Environment variables are created when a Claude Agent SDK query starts, so live-turn mutation is not a requirement.

If the provider model inventory is empty, the UI should still allow clearing aliases and setting all aliases to the current main model when one exists. It should not guess model IDs. The recovery path is for the user to add custom models through the existing custom models editor or refresh provider models.

## Artifacts and Notes

Important existing evidence:

    apps/server/src/modules/chat-runtime/runtime-session-context.ts
      configJson: JSON.stringify({
        ...profileConfig,
        ...targetModelRegistryConfig,
        ...agentConfig,
        ...sessionConfig
      })

This merge order is the reason session-level `claudeAgent.modelAliases` can override provider target defaults without new runtime plumbing.

    apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts
      const haiku = readNonEmptyEnvValue(aliases?.haiku) || config?.model
      const sonnet = readNonEmptyEnvValue(aliases?.sonnet) || config?.model
      const opus = readNonEmptyEnvValue(aliases?.opus) || config?.model

This fallback is the reason blank aliases are safe: they fall back to the effective main model.

    packages/db/src/schema/provider-target.ts
      connectionConfigJson: text('connection_config_json').notNull().default('{}')
      enabledModelsJson: text('enabled_models_json').notNull().default('[]')
      customModelsJson: text('custom_models_json').notNull().default('[]')

This plan intentionally uses existing provider target storage and does not add a table or column.

## Interfaces and Dependencies

Server interfaces to produce:

In `apps/server/src/modules/chat-runtime/runtime-settings.ts`, keep the existing exported functions and add functions with these responsibilities:

    readSessionRuntimeSettings(configJson: string | null | undefined): ChatRuntimeSettings
    readSessionClaudeAgentConfig(configJson: string | null | undefined): { modelAliases: { haiku: string, sonnet: string, opus: string } } | null
    normalizeRuntimeSettingsPatch(value: unknown): ChatRuntimeSettingsPatch
    normalizeSessionClaudeAgentPatch(value: unknown): { modelAliases?: { haiku?: string, sonnet?: string, opus?: string } } | null
    writeSessionRuntimeSettingsConfigJson(configJson: string | null | undefined, settings: ChatRuntimeSettings): string
    writeSessionClaudeAgentConfigJson(configJson: string | null | undefined, patch: SessionClaudeAgentPatch): string

If implementation shows that one combined writer is cleaner, use a single function with a clear name such as `writeSessionRuntimeConfigJson`, but keep all existing call sites correct.

In `apps/server/src/modules/chat-runtime/runtime-settings-api.ts`, extend the DTO to:

    interface ChatRuntimeSettingsDto {
      sessionId: string
      runtimeSettings: ChatRuntimeSettings
      claudeAgent: SessionClaudeAgentConfig | null
      applied: boolean
    }

In `apps/server/src/modules/provider-targets/service.ts`, add:

    updateProviderTargetClaudeAgentConfig(
      input: ProviderTarget | string,
      patch: { modelAliases?: { haiku?: string, sonnet?: string, opus?: string } }
    ): ProviderTargetModelSettings

The function must update the existing provider target row and return the same model settings shape used by `getProviderTargetModelSettings`.

Web interfaces to produce:

In `apps/web/src/features/agent-runtime/claude-agent-config.ts`, expose:

    export const CLAUDE_AGENT_ALIAS_KEYS = ['haiku', 'sonnet', 'opus'] as const
    export type ClaudeAgentAliasKey = typeof CLAUDE_AGENT_ALIAS_KEYS[number]
    export interface ClaudeAgentModelAliases { haiku: string; sonnet: string; opus: string }
    export const DEFAULT_CLAUDE_AGENT_ALIASES: ClaudeAgentModelAliases
    export function readClaudeAgentModelAliases(config: Record<string, unknown> | string | null | undefined): ClaudeAgentModelAliases
    export function writeClaudeAgentModelAliases(config: Record<string, unknown>, aliases: ClaudeAgentModelAliases): Record<string, unknown>

Use Zod schemas rather than inline unknown-heavy parsing. If TypeScript can infer the shape directly from Zod, prefer that inferred type.

In `apps/web/src/features/chat/commands/chat-response-command.ts`, keep `ChatRuntimeSettingsPatch` scoped to transient response runtime controls:

    export type ChatRuntimeSettingsPatch = Partial<ChatRuntimeSettings>

This type is used by ordinary message sends, queue items, side conversations, and composer access/interaction controls. It must not include `claudeAgent`, because a Claude matrix is persisted session configuration rather than a one-off response option.

In `apps/web/src/features/chat/commands/runtime-settings-command.ts`, expose the persisted session patch type:

    export interface SessionClaudeAgentConfigPatch {
      modelAliases?: Partial<ClaudeAgentModelAliases>
    }

    export type SessionRuntimeSettingsPatch = ChatRuntimeSettingsPatch & {
      claudeAgent?: SessionClaudeAgentConfigPatch | null
    }

Callers that save direct Chat Session matrix overrides, such as `apps/web/src/features/chat/runtime/use-runtime-settings.ts`, should use `SessionRuntimeSettingsPatch`.

On the generated OpenAPI surface, `PostChatSessionsBySessionIdResponseData.body.runtimeSettings` and the side conversation response equivalent should contain only:

    {
      accessMode?: 'approval-required' | 'full-access'
      interactionMode?: 'default' | 'plan'
    }

`PatchChatSessionsBySessionIdRuntimeSettingsData.body` should contain:

    {
      accessMode?: 'approval-required' | 'full-access'
      interactionMode?: 'default' | 'plan'
      claudeAgent?: {
        modelAliases?: {
          haiku?: string
          sonnet?: string
          opus?: string
        }
      }
    }

The default path should persist the override before the next turn through `/chat/sessions/:sessionId/runtime-settings`.

Revision note 2026-06-20 02:17Z: Initial ExecPlan created from discussion of CRA-013 and the direct Chat Session Claude model matrix gap. The plan chooses provider target defaults plus session overrides, uses existing JSON columns, and explicitly avoids named template tables.

Revision note 2026-06-20 02:57Z: Implementation completed for server persistence, external refresh preservation, generated API/CLI clients, Provider Settings UI, direct Chat Session UI, focused tests, and docs. Recorded validation results and the unrelated web typecheck blocker.

Revision note 2026-06-20 03:16Z: Tightened the API and web types so `claudeAgent` is only accepted by the persisted session runtime-settings route, not by transient response `runtimeSettings`. Recorded regenerated API/CLI output, targeted lint, react-doctor findings, and updated validation commands.

Revision note 2026-06-20 03:23Z: Resolved the remaining web typecheck blocker by importing the existing Codex auth mode toggle in draft provider setup, keyed preset setup forms by preset id to avoid one reset effect, reran validation, and updated outcomes to state that `pnpm typecheck:apps-web` now passes.
