# Support Claude Official Subscription Auth

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so a future contributor can resume the work from this file and the current working tree alone.

## Purpose / Big Picture

Cradle can already run Claude Agent through the Anthropic API key path. It cannot yet represent the official Claude.ai subscription login path used by the Claude CLI and Claude Agent SDK, so providers imported from tools such as cc-switch with no Anthropic API key become unusable. After this change, server-side provider config can explicitly select Claude official subscription authentication, imported cc-switch/local Claude records can project that mode, and the Claude Agent runtime can start with SDK-managed Claude.ai login state instead of requiring `ANTHROPIC_API_KEY`.

The user-visible result is that a Claude official provider target can exist without an API key and still start a Claude Agent turn when the user is logged into the normal Claude CLI / Claude.ai account state. UI work is intentionally out of scope; this plan prepares server/runtime/config/source behavior and tests for a separate UI pass.

## Progress

- [x] (2026-06-23 15:18Z) Read the ExecPlan skill and PLANS.md requirements; confirmed this feature is complex enough for a plan.
- [x] (2026-06-23 15:18Z) Inspected existing Codex auth mode handling, Claude Agent input projection, cc-switch mapping, local agent config mapping, provider target config schemas, and runtime usage slot contracts.
- [x] (2026-06-23 15:27Z) Added Claude-owned auth mode schema and trusted config reading on the server.
- [x] (2026-06-23 15:27Z) Updated Claude Agent query option projection to support API key and Claude.ai subscription modes without environment leakage.
- [x] (2026-06-23 15:27Z) Persisted Claude Agent auth status, account, and subscription rate-limit state into providerStateSnapshot and exposed subscription limits through the existing usage UI slot contract.
- [x] (2026-06-23 15:27Z) Projected cc-switch official Claude and local no-key Claude config into the new Claude auth mode.
- [x] (2026-06-23 15:27Z) Added focused tests for provider config defaults, query option projection, provider snapshot/usage state, cc-switch mapping, and local source mapping.
- [x] (2026-06-23 15:27Z) Ran focused verification commands and recorded outcomes here.
- [x] (2026-06-24) UI pass: added a Claude auth mode picker (`apiKey` / `claudeAi`) to provider creation and edit panels, extended the profile config schema so imported `claudeAi` configs parse, and fixed `buildProfileConfig` so editing an Anthropic provider no longer strips `authMode`.
- [x] (2026-06-24) Added provider-target scoped auth diagnostics endpoint for Claude official subscription auth status, including CLI status parsing and SDK account fallback for subscription metadata.
- [x] (2026-06-24) Corrected official Claude auth root handling: `claudeAi` mode now removes Cradle-owned `CLAUDE_CONFIG_DIR` overrides and preserves user-provided Claude config dirs so it can reuse the user's Claude login state.
- [x] (2026-06-24) Re-enabled SDK session persistence for `claudeAi` mode after comparing Synara's Claude adapter; official Claude.ai turns now retain native Claude SDK resume semantics and store returned SDK session ids in `providerSessionId`.

## Surprises & Discoveries

- Observation: `BaseProviderConfig.authMode` currently uses `CodexAuthModeSchema`, and `ClaudeAgentConfigSchema` inherits it.
  Evidence: `apps/server/src/modules/provider-contracts/provider-base.ts` defines `authMode: CodexAuthModeSchema.optional()` in the base schema, which blocks a Claude-specific value such as `claudeAi`.
- Observation: Claude Agent SDK `forceLoginMethod` is not a top-level `Options` field; it is part of SDK `Settings`.
  Evidence: `apps/server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` has `Options.managedSettings?: Settings` and `Settings.forceLoginMethod?: 'claudeai' | 'console' | 'gateway'`.
- Observation: Official subscription mode must scrub inherited Anthropic auth environment variables.
  Evidence: Anthropic SDK code reads `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_BASE_URL` from the process environment when explicit credentials are absent.
- Observation: Cradle already has a generic `RuntimeUsageUiSlotState` with `planType`, `usedPercent`, reset timestamps, and credit fields.
  Evidence: `packages/chat-runtime-contracts/src/index.ts` and `apps/server/src/modules/chat-runtime/model.ts` define the `usage` slot shape; Codex already uses it for account rate limits.
- Observation: Empty SDK account objects should not create a usage slot.
  Evidence: The first provider test run added empty `claude-agent:usage` states to old tests because the mock `initializationResult()` returned `account: {}`. The implementation now writes an account snapshot only when account fields such as email, subscription type, token source, API key source, or API provider are present.
- Observation: Synara does not need a Claude-only UI endpoint; it exposes provider health through a generic server provider status channel and keeps Claude-specific probing inside the server health implementation.
  Evidence: Synara's `server.refreshProviders` delegates to `ProviderHealth.refresh`, while Claude logic probes `claude --version`, `claude auth status`, and SDK `initializationResult().account.subscriptionType` inside `ProviderHealth`.
- Observation: The Claude Agent SDK uses `CLAUDE_CONFIG_DIR` as a combined auth/config/transcript root, and setting it to Cradle's data directory hides the user's normal `~/.claude` / secure-storage login state.
  Evidence: SDK type docs say persisted sessions write under `~/.claude/projects` / `CLAUDE_CONFIG_DIR`; SDK implementation defaults `CLAUDE_CONFIG_DIR` to `~/.claude` and only uses its default secure-storage fallback when no explicit config dir is set.

## Decision Log

- Decision: Model official Claude subscription auth as a Claude Agent auth mode named `claudeAi`, not as a new provider kind and not as a cc-switch-only behavior.
  Rationale: Provider kind describes model API family (`anthropic`), while auth mode describes how the Claude Agent adapter authenticates. This preserves Cradle ownership and avoids encoding cc-switch semantics in runtime behavior.
  Date/Author: 2026-06-23 15:18Z / Codex
- Decision: Split provider auth mode schemas so `BaseProviderConfig` no longer owns a Codex-only enum.
  Rationale: Claude Agent needs Claude-specific auth values. Keeping provider-specific auth modes in provider-specific schemas makes ownership clear and avoids overloading Codex names.
  Date/Author: 2026-06-23 15:18Z / Codex
- Decision: In `claudeAi` mode, set SDK `managedSettings.forceLoginMethod = 'claudeai'` and use `settingSources: ['user', 'project', 'local']`.
  Rationale: The SDK documents `forceLoginMethod` as the official way to force Claude Pro/Max login and documents setting sources as the filesystem setting controls. This follows the SDK rather than inventing detection heuristics.
  Date/Author: 2026-06-23 15:18Z / Codex
- Decision: Use Cradle's existing providerStateSnapshot plus `usage` slot contract for Claude subscription and rate-limit state instead of adding UI or a new runtime event schema in this pass.
  Rationale: Cradle already uses this path for Codex account/rate-limit state. UI can consume the prepared state later without a server API redesign.
  Date/Author: 2026-06-23 15:18Z / Codex
- Decision: Expose manual refresh/read auth status as provider-target scoped diagnostics at `/provider-targets/:providerTargetId/auth-diagnostics`, not as a Claude-specific top-level endpoint.
  Rationale: Cradle's provider configuration is owned by provider targets. The generic route gives Settings UI one stable place to refresh auth state, while Claude Agent owns the current implementation branch for `anthropic` targets.
  Date/Author: 2026-06-24 / Codex
- Decision: In `claudeAi` mode, do not set Cradle's `CLAUDE_CONFIG_DIR`, preserve user-provided Claude config dirs, and do not persist SDK sessions until Cradle implements a proper SDK `SessionStore` adapter.
  Rationale: Reusing official Claude subscription auth requires the SDK/CLI to see the user's Claude login state, whether that is the default `~/.claude` root or an explicit shell-provided `CLAUDE_CONFIG_DIR`. Setting `CLAUDE_CONFIG_DIR` to Cradle's runtime directory isolates that auth state away. Leaving persistence enabled without a Cradle-owned session store would write Cradle chat transcripts into the user's `~/.claude/projects`, which violates namespace ownership. Cradle can replay its own chat history as the short-term context mechanism.
  Date/Author: 2026-06-24 / Codex
- Decision: Re-enable SDK session persistence in `claudeAi` mode while still refusing to inject Cradle's `CLAUDE_CONFIG_DIR`.
  Rationale: Disabling SDK persistence removes native Claude resume, prompt-cache/session continuity, `setModel` on resumed sessions, session title lookup, and SDK context usage against the active provider thread. Synara's Claude adapter keeps SDK-native persistence/resume for real sessions, uses `settingSources: ['user', 'project', 'local']`, and passes native resume/session ids through its provider cursor. Until Cradle implements a dedicated SDK `SessionStore`, the practical behavior should favor native Claude continuity; the namespace tradeoff is accepted for official Claude.ai mode because the auth root and transcript root are coupled by the SDK.
  Date/Author: 2026-06-24 / Codex

## Outcomes & Retrospective

Implemented and verified the server/runtime/source side of Claude official subscription auth. Cradle now has a Claude-specific `authMode` with `apiKey` and `claudeAi`, the Claude Agent SDK query projection can run in official Claude.ai mode without API key resolution or Anthropic auth environment leakage, and SDK auth/account/rate-limit state is persisted in Cradle provider snapshots for later UI consumption. cc-switch official Claude and local Claude settings without a key now project `authMode: 'claudeAi'`.

UI remains intentionally out of scope. A UI pass can expose the auth mode picker and render the prepared `claude-agent:usage` / auth status state.

### 2026-06-24 UI pass

Implemented the auth mode picker for Claude providers and fixed a config-loss bug in the edit panel. The generic `usage` composer slot already renders `claude-agent:usage` state by slot id, so no additional usage UI was needed; a Claude auth-status diagnostics panel was not added because it would require a new server endpoint (out of scope for this pass).

Changes:

- `apps/web/src/features/agent-runtime/profile-config-schema.ts`: added `'apiKey'` and `'claudeAi'` to the `authMode` enum so imported Anthropic configs parse instead of throwing.
- `apps/web/src/features/agent-management/claude-auth-modes.ts` (new): `ClaudeAuthModeValue`, `CLAUDE_AUTH_MODE_OPTIONS`, `normalizeClaudeAuthMode`, `claudeCredentialPlaceholder`.
- `apps/web/src/features/agent-management/claude-auth-mode-controls.tsx` (new): `ClaudeAuthModeToggle` mirroring `CodexAuthModeToggle`.
- `apps/web/src/features/agent-management/draft-setup-panel.tsx`: Anthropic preset shows the Claude auth toggle; selecting `claudeAi` hides the endpoint/API key fields and shows a subscription notice, skips the credential requirement, and writes `config.authMode = 'claudeAi'` with an empty `baseUrl`.
- `apps/web/src/features/agent-management/profile-detail-panel.tsx`: `getProfileFormValues` reads the Claude auth mode for `anthropic` providers; `buildProfileConfig` gained an `anthropic` branch that preserves `authMode` and clears `baseUrl` for `claudeAi` (previously editing an Anthropic provider stripped `authMode` entirely); `ProfileCredentialSettings` renders a Claude auth `Select` and hides the API key input + endpoint for `claudeAi`.

Verification: `pnpm --filter @cradle/web typecheck` passed; `pnpm --filter @cradle/web test` reported 48 test files / 193 tests passed.

### 2026-06-24 provider-target auth diagnostics pass

Added a server-owned Settings API for auth refresh/read behavior without adding UI. The route is `GET /provider-targets/:providerTargetId/auth-diagnostics` and returns a common diagnostics shape with `supported`, `status`, `available`, `authStatus`, `authMode`, `authType`, `authLabel`, `version`, `message`, and redacted account metadata.

Claude Agent behavior:

- API key mode checks only whether a credential/config/env API key can be resolved and never returns the secret.
- Official Claude.ai mode runs `claude --version` and `claude auth status` after clearing inherited `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_BASE_URL`, and after removing only Cradle-owned Claude config-dir overrides, so diagnostics use the user's Claude login state. It parses login/subscription fields from CLI JSON/text and falls back to a no-message Claude Agent SDK initialization probe for account subscription metadata.
- Unsupported provider targets return `supported: false` without starting CLI or SDK probes.

Verification:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/claude-agent/account-diagnostics.test.ts tests/openapi.test.ts
    Result: 2 test files passed, 8 tests passed.

    pnpm --filter @cradle/server typecheck
    Result: passed.

### 2026-06-24 auth-root correction

Corrected the official Claude auth root after reviewing the SDK behavior. Setting `CLAUDE_CONFIG_DIR` to Cradle's runtime directory makes the SDK ignore the user's normal Claude login state. `claudeAi` mode now removes Cradle-owned `CLAUDE_CONFIG_DIR` / `CLAUDE_SECURESTORAGE_CONFIG_DIR` values from child env, while preserving a user shell-provided custom Claude config dir, so SDK/CLI auth resolves through the user's Claude root / secure storage.

After comparing Synara's Claude adapter, Cradle now keeps SDK session persistence enabled for `claudeAi` mode. This restores native SDK resume semantics and stores returned SDK session ids in `providerSessionId`. The accepted tradeoff is that official Claude.ai sessions use the SDK's coupled auth/transcript root, normally `~/.claude/projects`, until Cradle adds a proper SDK `SessionStore` integration.

Verification:

    pnpm --filter @cradle/server exec vitest run tests/provider-base.test.ts tests/local-agent-config-source.test.ts src/modules/chat-runtime-providers/claude-agent/provider.test.ts src/modules/chat-runtime-providers/claude-agent/account-diagnostics.test.ts tests/openapi.test.ts
    Result: 5 test files passed, 54 tests passed.

    pnpm exec vitest run plugins/cc-switch/src/cc-switch-source.test.ts
    Result: 1 test file passed, 6 tests passed.

    pnpm --filter @cradle/server typecheck
    Result: passed.

## Context and Orientation

Cradle's server runtime provider boundary is under `apps/server/src/modules/chat-runtime-providers`. The Claude Agent adapter lives in `apps/server/src/modules/chat-runtime-providers/claude-agent`. The function `buildClaudeQueryOptions` in `input-projector.ts` converts a Cradle runtime input into `@anthropic-ai/claude-agent-sdk` query options. Today it always resolves an API key, throws `auth_failed` when no key is found, disables SDK filesystem settings with `settingSources = []`, and injects `ANTHROPIC_API_KEY`.

Provider target configuration is parsed in `apps/server/src/modules/provider-contracts/provider-base.ts`. A provider target is Cradle's stored record for a model provider connection. Its `connectionConfigJson` is merged with model settings and later passed to runtime providers as `profile.configJson`.

External provider sources import provider records from other products. The cc-switch plugin is in `plugins/cc-switch/src/cc-switch-source.ts`. The local agent config source is in `apps/server/src/modules/external-provider-sources/local-agent-config-source.ts`. These sources may read other products' config, but Cradle writes only Cradle-owned provider targets and secrets.

The Claude Agent SDK supports Claude.ai subscription login through its own login state and settings. In SDK type declarations, `Options.env` replaces the child process environment, `Options.settingSources` controls whether user/project/local Claude settings are loaded, and `Options.managedSettings.forceLoginMethod = 'claudeai'` forces Claude Pro/Max style login. The SDK emits `auth_status` and `rate_limit_event` messages and exposes `initializationResult().account`.

Cradle runtime UI state is stored in `runtimeSession.providerStateSnapshot` and surfaced by `getUiSlotStates`. Codex has a large state projector in `apps/server/src/modules/chat-runtime-providers/codex/projection/state-projector.ts`; Claude Agent has a smaller projector in `apps/server/src/modules/chat-runtime-providers/claude-agent/state-projector.ts`. The generic `usage` slot already exists and is suitable for Claude subscription rate limits.

## Plan of Work

First, edit `apps/server/src/modules/provider-contracts/provider-base.ts` so base provider config no longer declares Codex-only `authMode`. Add `ClaudeAgentAuthModeSchema = z.enum(['apiKey', 'claudeAi'])`, export its type, put `authMode` on `ClaudeAgentConfigSchema`, and keep Codex `authMode` on Codex/OpenAI-compatible schemas. Default trusted Claude config reading should return `authMode: 'apiKey'` when none is stored.

Second, edit `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts`. Add a small helper that reads the effective Claude auth mode. For `apiKey`, preserve current behavior: require `ANTHROPIC_API_KEY`, set `settingSources = []`, inject the key and optional base URL, and set Cradle's SDK config dir. For `claudeAi`, do not call `resolveApiKey`, do not throw when no key is configured, set `settingSources` to `['user', 'project', 'local']`, set `managedSettings.forceLoginMethod = 'claudeai'`, keep SDK session persistence enabled for native resume, delete inherited Anthropic API credentials from the child environment, and remove only Cradle-owned Claude config-dir overrides.

Third, add Claude Agent account and rate-limit snapshot projection. Extend `apps/server/src/modules/chat-runtime-providers/claude-agent/state-projector.ts` with functions that can write account info from `activeQuery.initializationResult()` and rate-limit info from SDK `rate_limit_event` messages into `providerStateSnapshot.claudeAgent`. Add a function that projects this state to `RuntimeUsageUiSlotState` with slot id `claude-agent:usage`. Call these functions from `provider.ts` after the query is created and while streaming SDK messages.

Fourth, update external provider sources. In `plugins/cc-switch/src/cc-switch-source.ts`, when a Claude provider is the official cc-switch Claude seed and has no Anthropic credential, include `authMode: 'claudeAi'` in the provider config and metadata. In `apps/server/src/modules/external-provider-sources/local-agent-config-source.ts`, when local Claude settings exist but no Anthropic credential exists, project `authMode: 'claudeAi'` so local official CLI login can be represented explicitly.

Fifth, add tests. Use existing test files rather than creating broad new suites: `apps/server/tests/provider-base.test.ts`, `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.test.ts`, `plugins/cc-switch/src/cc-switch-source.test.ts`, and any existing local-agent-config-source tests if present. Tests should prove no API key is required in `claudeAi` mode, Anthropic key/token/base URL env variables are scrubbed in official mode, API key mode still requires a key, rate-limit and account snapshots become usage slot state, cc-switch official maps to `authMode: 'claudeAi'`, and local no-key Claude config maps likewise.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle`.

Inspect and edit files:

    sed -n '1,260p' apps/server/src/modules/provider-contracts/provider-base.ts
    sed -n '150,280p' apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts
    sed -n '1,260p' apps/server/src/modules/chat-runtime-providers/claude-agent/state-projector.ts
    sed -n '600,635p' plugins/cc-switch/src/cc-switch-source.ts
    sed -n '500,535p' apps/server/src/modules/external-provider-sources/local-agent-config-source.ts

After implementation, run focused tests:

    pnpm --filter @cradle/server exec vitest run tests/provider-base.test.ts src/modules/chat-runtime-providers/claude-agent/provider.test.ts
    pnpm exec vitest run plugins/cc-switch/src/cc-switch-source.test.ts

Then run a server typecheck if focused tests pass:

    pnpm --filter @cradle/server typecheck

Expected success looks like Vitest reporting all selected tests passed and typecheck completing without TypeScript errors. If unrelated dirty files or unrelated existing failures appear, record their exact paths and error summaries in this plan and in the final report.

Verification completed from `/Users/wibus/dev/Cradle`:

    pnpm --filter @cradle/server exec vitest run tests/provider-base.test.ts src/modules/chat-runtime-providers/claude-agent/provider.test.ts tests/local-agent-config-source.test.ts
    Result: 3 test files passed, 46 tests passed.

    pnpm exec vitest run plugins/cc-switch/src/cc-switch-source.test.ts
    Result: 1 test file passed, 6 tests passed.

    pnpm --filter @cradle/server typecheck
    Result: passed.

    pnpm --filter @cradle/cc-switch typecheck
    Result: passed.

## Validation and Acceptance

Acceptance is met when these behaviors are demonstrably true:

An API key Claude Agent target still works as before. A test using `readSecret` or `ANTHROPIC_API_KEY` sees `queryOptions.settingSources` equal `[]`, `queryOptions.env.ANTHROPIC_API_KEY` set to the key, and optional `ANTHROPIC_BASE_URL` preserved.

A `claudeAi` Claude Agent target starts without an API key. A test with `profile.configJson` containing `{ "authMode": "claudeAi" }` and no credential does not throw `auth_failed`, sees `queryOptions.settingSources` equal `['user', 'project', 'local']`, sees `queryOptions.managedSettings.forceLoginMethod` equal `claudeai`, sees `queryOptions.persistSession` equal `true`, stores returned SDK session ids in `providerSessionId`, and sees no `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, or Cradle-owned `CLAUDE_CONFIG_DIR` in the child env.

When the SDK reports account or rate-limit information, the runtime session snapshot stores it under `claudeAgent`, and `getUiSlotStates` can return a `usage` state with `slotId: 'claude-agent:usage'`, a `planType` from the subscription type, and utilization/reset fields from the SDK rate-limit event.

When cc-switch contains its official Claude provider with empty env settings, the external provider snapshot includes an Anthropic record whose config has `authMode: 'claudeAi'` and no credential. When local Claude settings exist without a key, local-agent-config produces the same explicit auth mode.

## Idempotence and Recovery

All edits are regular TypeScript source/test changes and can be re-run safely. The tests create temporary directories and should clean them in `afterEach`. If a test run is interrupted, rerun the same Vitest command. Do not run destructive Git commands. Existing unrelated dirty files such as `2026-06-22daily-release-notes.md` and `daily-release-notes/` must remain untouched.

If the implementation discovers that SDK type names differ from the plan, read `apps/server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` and adjust to the actual exported types, then record the difference in `Surprises & Discoveries`.

## Artifacts and Notes

Important evidence from investigation:

    BaseProviderConfig currently has CodexAuthModeSchema authMode, so Claude cannot parse claudeAi until this is split.
    SDK Options.env replaces the subprocess environment, so environment scrubbing must be explicit.
    SDK Settings.forceLoginMethod has the documented value claudeai for Claude Pro/Max.
    RuntimeUsageUiSlotState already exists and includes planType, usedPercent, reset windows, credits, and updatedAt.

Verification transcript summary:

    Test Files  3 passed (3)
    Tests       46 passed (46)

    Test Files  1 passed (1)
    Tests       6 passed (6)

    pnpm --filter @cradle/server typecheck
    $ tsc --noEmit

    pnpm --filter @cradle/cc-switch typecheck
    $ tsc --noEmit

Unrelated dirty working tree entries observed and left untouched:

    D 2026-06-22daily-release-notes.md
    ?? daily-release-notes/

## Interfaces and Dependencies

In `apps/server/src/modules/provider-contracts/provider-base.ts`, define and export:

    export const ClaudeAgentAuthModeSchema = z.enum(['apiKey', 'claudeAi'])
    export type ClaudeAgentAuthMode = z.infer<typeof ClaudeAgentAuthModeSchema>

`ClaudeAgentConfig` must include:

    authMode: ClaudeAgentAuthMode

In `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts`, `buildClaudeQueryOptions` must produce SDK `Options` with these mode-dependent invariants:

    apiKey mode: settingSources is [], env.ANTHROPIC_API_KEY is set, missing key throws auth_failed.
    claudeAi mode: settingSources is ['user', 'project', 'local'], managedSettings.forceLoginMethod is 'claudeai', persistSession is true, Anthropic credential/base URL env values are absent, and Cradle-owned CLAUDE_CONFIG_DIR is absent while user-provided Claude config dirs are preserved.

In `apps/server/src/modules/chat-runtime-providers/claude-agent/state-projector.ts`, add functions that provider code can call without knowing snapshot internals:

    writeClaudeAgentAccountSnapshot(runtimeSession, account)
    projectClaudeAgentRateLimitSnapshot(runtimeSession, message)
    projectClaudeAgentUsageUiSlotState(runtimeSession)

The SDK dependency is `@anthropic-ai/claude-agent-sdk` from `apps/server/package.json`. Use exported SDK types when practical, but trust local TypeScript types and avoid ad hoc `unknown` parsing unless the SDK does not export a specific shape.

Revision note 2026-06-23 15:18Z: Initial ExecPlan created before implementation to satisfy the complex feature workflow and capture the architecture decisions.

Revision note 2026-06-23 15:27Z: Updated after implementation and validation to record completed work, the empty-account discovery, exact verification commands, remaining UI scope, and unrelated dirty files.
