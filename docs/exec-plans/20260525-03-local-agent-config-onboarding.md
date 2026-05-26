# Local Agent Config Onboarding Source

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a future contributor can read only this file and continue the onboarding local-agent-config work without relying on chat history.

## Purpose / Big Picture

Cradle should be able to notice that a user already has local Claude Code and Codex configuration on the machine, normalize those configurations into the same external provider source shape used by CC Switch, and reuse the existing external provider refresh pipeline to create Cradle-owned `provider_targets`. This work does not enable automatic startup scanning. It provides an explicit Settings Agents `Import` action that reads allowlisted local files, projects the detected providers into Cradle-owned runtime targets, and creates user-visible Agent rows for Local Claude and Local Codex. The implementation does not write `~/.claude`, `~/.codex`, or `~/.cc-switch`, and does not log or expose real secrets through metadata or import responses.

After this change, a user can open Settings Agents, click `Import`, review a dialog of detected local Claude and Codex candidates, and choose which local Agent identities to import. If the user's local Claude or Codex configuration points at the CC Switch local proxy, Cradle resolves CC Switch's current upstream provider and model settings, but the Agent identity still remains `Local Claude` or `Local Codex`. Repeating the action refreshes the Cradle-owned external provider target data and reports the local Agent identity as already configured rather than creating duplicates. A developer can run focused server tests that create temporary Claude, Codex, and CC Switch fixture files, call the local source reader, and exercise `POST /agents/import/local-config` twice to prove idempotence.

## Progress

- [x] (2026-05-25 08:45Z) Confirmed the existing CC Switch work already uses plugin-first external provider sources, and host projection writes external records into Cradle-owned `provider_targets`.
- [x] (2026-05-25 08:51Z) Added `apps/server/src/modules/external-provider-sources/local-agent-config-source.ts` as an unregistered source utility for local Claude and Codex onboarding data.
- [x] (2026-05-25 08:55Z) Added `smol-toml` to `@cradle/server` dependencies so Codex `config.toml` is parsed with a structured TOML parser rather than ad hoc string scanning.
- [x] (2026-05-25 08:58Z) Added `apps/server/tests/local-agent-config-source.test.ts` with temporary fixture files only; the tests do not read the real user home directory.
- [x] (2026-05-25 09:01Z) Updated `apps/server/src/modules/external-provider-sources/README.md` to list the new onboarding utility and state that it is intentionally not registered on startup.
- [x] (2026-05-25 09:02Z) Verified the new reader and existing host external source tests with focused Vitest commands and server TypeScript checking.
- [x] (2026-05-25 09:09Z) Created this ExecPlan record after implementation to preserve the design, boundaries, validation evidence, and future integration path.
- [x] (2026-05-26 03:53Z) Added an explicit `/agents/import/local-config` route and Settings Agents `Import` button; startup behavior remains unchanged.
- [x] (2026-05-26 03:53Z) Added Agent import tests proving first import creates Local Claude and Local Codex, second import reports existing Agents, and secret values do not appear in the HTTP response.
- [x] (2026-05-26 03:53Z) Verified focused server tests and server TypeScript checking after the explicit import integration.
- [x] (2026-05-26 08:05Z) Corrected CC Switch proxy import semantics so CC Switch is provenance and upstream resolution only; imported Agent names remain Local Claude and Local Codex, while `modelId` and runtime config are copied from the resolved upstream provider.
- [x] (2026-05-26 08:05Z) Confirmed Agent detail and Agent list provider/model pickers use `provider_targets` through `useProviderTargets()` and `useProviderTargetModelMap()` rather than the legacy manual `agent_profiles` list.

## Surprises & Discoveries

- Observation: Cradle's current provider selection layer is `provider_targets`, while `agent_profiles` now acts as a manual-profile compatibility surface.
  Evidence: `apps/server/src/modules/profiles/service.ts` converts only manual `providerTargets` rows into `AgentProfile` objects; external source projection in `apps/server/src/modules/external-provider-sources/service.ts` writes `provider_targets` rows with `kind: 'external'`.

- Observation: The safest first implementation is an external source utility, not startup integration.
  Evidence: `apps/server/src/app.ts` already calls `refreshAllExternalProviderSources()` after plugin activation when background tasks are enabled. Registering a local source immediately would make it active on every startup, which is explicitly out of scope for this onboarding preparation step.

- Observation: Codex config needs a TOML parser.
  Evidence: CC Switch already uses `smol-toml` in `plugins/cc-switch/src/cc-switch-source.ts` to parse Codex TOML; reusing the same dependency in server keeps the local Codex reader structured and avoids fragile regex parsing.

- Observation: Real Claude and Codex home directories can contain many unrelated session/history files.
  Evidence: A broad local search through `~/.claude` and `~/.codex` produced large session/history output. The final reader therefore reads only fixed allowlisted paths and tests only temporary fixture directories.

- Observation: External provider projection requires Cradle's credential secret when imported records include API keys.
  Evidence: A direct refresh attempt without `CRADLE_CREDENTIAL_SECRET` returned an error message `CRADLE_CREDENTIAL_SECRET is required to manage secrets`. The import route now surfaces refresh errors as `local_agent_config_import_failed` instead of silently returning zero records.

- Observation: A CC Switch current provider is not an Agent identity.
  Evidence: The preview response now separates `agentName` (`Local Claude` or `Local Codex`) from `resolvedProviderName` (for example `CC Switch Claude`), and `apps/server/tests/agent.test.ts` asserts the imported Agent name stays local while `modelId`, Claude haiku/sonnet/opus aliases, and Codex reasoning/approval/sandbox settings come from the resolved CC Switch upstream provider.

## Decision Log

- Decision: Put the utility under `apps/server/src/modules/external-provider-sources`, not in a plugin or in `profiles`.
  Rationale: The source emits the same host-owned external provider source shape as plugins, and the existing external provider source module owns snapshot validation and runtime target projection. It should not write plugin-specific state or bypass host projection.
  Date/Author: 2026-05-25 / Codex.

- Decision: Do not register the local source during server startup yet.
  Rationale: The goal is to prepare onboarding utilities, not change startup behavior. Leaving the factory unregistered makes the code testable now while preserving an explicit future product decision about when onboarding should run.
  Date/Author: 2026-05-25 / Codex.

- Decision: Read only allowlisted local files: Claude `settings.json` and `settings.local.json`, Codex `config.toml` and `auth.json`.
  Rationale: Claude and Codex directories may contain transcripts, histories, project state, and other unrelated files. Onboarding provider detection needs only configuration signals and should avoid scanning broad user data.
  Date/Author: 2026-05-25 / Codex.

- Decision: Include process environment values by default, but make it configurable through `LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV`.
  Rationale: Existing runtime code can resolve keys from environment variables, so onboarding should be able to detect those values when explicitly invoked. Tests disable process environment input to avoid leaking the developer machine into fixture assertions.
  Date/Author: 2026-05-25 / Codex.

- Decision: Secrets may appear only in the `credential` field of `ExternalProviderRecord`, never in metadata or fingerprint hints.
  Rationale: The host projection layer already encrypts `credential` values. Metadata is displayed and persisted for diagnostics, so it must only contain non-secret signals and booleans like `hasCredential`.
  Date/Author: 2026-05-25 / Codex.

- Decision: Import is an explicit Settings Agents action, not an automatic startup action.
  Rationale: The user asked to prepare onboarding utilities without starting them automatically, then requested a nearby Import button. Explicit import gives the user control over when local files are read while still making the flow one click from Agent Management.
  Date/Author: 2026-05-26 / Codex.

- Decision: The route is owned by `agent-identity`, while local config reading and provider-target projection remain owned by `external-provider-sources`.
  Rationale: The user-visible action is "create/import Agents", but the source semantics and Cradle-owned runtime target writes already belong to the external provider source module. This preserves ownership boundaries and avoids writing to Claude/Codex namespaces.
  Date/Author: 2026-05-26 / Codex.

- Decision: Superseded: dedupe initially used Cradle-owned external runtime target identity plus runtime kind.
  Rationale: The first import implementation treated an existing Agent with the same `providerTargetId` and runtime kind as already configured. This was later superseded because CC Switch's current upstream provider can change without changing the user's local Claude or Codex app identity.
  Date/Author: 2026-05-26 / Codex.

- Decision: Dedupe now uses the local app identity before provider target identity for onboarding imports.
  Rationale: CC Switch's current upstream provider can change, but the user still has one local Claude configuration and one local Codex configuration. Importing a new upstream target must update or reuse `Local Claude` / `Local Codex`, not create `CC Switch current provider Agent` rows or multiple local Agents for the same app.
  Date/Author: 2026-05-26 / Codex.

- Decision: Agent detail and Agent list provider/model pickers use `provider_targets` directly.
  Rationale: Runtime selection has to include both manual provider targets and external provider targets created by CC Switch and local onboarding. The legacy `agent_profiles` route is a manual-provider settings adapter and is not a complete runtime-selection source.
  Date/Author: 2026-05-26 / Codex.

## Outcomes & Retrospective

The preparation work is complete, and the first explicit onboarding entry point is implemented. The server now has a reusable `createLocalAgentConfigExternalProviderSource()` factory and direct snapshot reader for local Claude and Codex configuration, while startup behavior remains unchanged. The Agent Identity module exposes preview and commit routes for local import. Preview refreshes the direct local source and any registered CC Switch source, then returns selectable candidates for a dialog. Commit projects records into Cradle-owned external provider targets, creates or updates Local Claude and Local Codex Agent rows, and returns existing Agents on repeated imports. Fixture tests prove the mapper returns standard external provider records, handles missing files, emits non-blocking missing-credential warnings, respects context path overrides, resolves CC Switch proxy upstream models and runtime settings, avoids putting test secrets in metadata, and keeps the HTTP import response free of plaintext fixture secrets.

The previous product gap around Agent detail has been closed for runtime selection: Agent detail and Agent list provider/model pickers now use provider targets directly. The manual profile screens still exist as the manual provider editing surface, but they are no longer the Agent detail runtime picker data source.

## Context and Orientation

Cradle's server code lives under `apps/server`. The external provider source module lives at `apps/server/src/modules/external-provider-sources`. An external provider source is a reader that returns a normalized snapshot of provider records from some external or local namespace. A provider record is not the same as a Cradle runtime target. The reader returns data; the host projection service validates it, encrypts credentials, stores source records, and creates or updates Cradle-owned `provider_targets`.

The existing host projection service is `apps/server/src/modules/external-provider-sources/service.ts`. It reads registered sources from `apps/server/src/plugins/external-provider-source-registry.ts`, validates each `ExternalProviderSourceSnapshot`, writes `external_provider_sources` and `external_provider_records`, and then creates `provider_targets` rows with `kind: 'external'`.

The local onboarding utility is `apps/server/src/modules/external-provider-sources/local-agent-config-source.ts`. It exports `resolveLocalAgentConfigSourceConfig`, `readLocalAgentConfigExternalProviderSnapshot`, `readLocalAgentConfigExternalProviderSnapshotFromContext`, and `createLocalAgentConfigExternalProviderSource`. It is not imported by `apps/server/src/app.ts`, `apps/server/src/plugins/context.ts`, or any plugin activation path, so it does not run automatically.

The explicit Agent import routes are `POST /agents/import/local-config/preview` and `POST /agents/import/local-config` in `apps/server/src/modules/agent-identity/index.ts`. Their service implementations are `previewLocalConfigImport()` and `importLocalConfig()` in `apps/server/src/modules/agent-identity/service.ts`. They create no source registration at startup; instead, preview calls `refreshDirectExternalProviderSource()` in `apps/server/src/modules/external-provider-sources/service.ts` for the local source only when the route is invoked, and it refreshes registered CC Switch sources to resolve proxy upstreams. The renderer hook `useAgents()` in `apps/web/src/features/agent-runtime/use-agents.ts` calls these routes, and `apps/web/src/features/agent-management/agent-list.tsx` exposes the Settings Agents `Import` button next to `Add agent`.

The current local file assumptions are deliberately small. For Claude, the reader looks for `~/.claude/settings.json` and `~/.claude/settings.local.json` by default and reads their `env` objects. For Codex, it looks for `~/.codex/config.toml` and `~/.codex/auth.json` by default. All paths can be overridden through the source read context `sharedConfig` or environment variables with the `LOCAL_AGENT_CONFIG_*` names documented below.

## Plan of Work

The implemented plan keeps the feature inside the existing external source architecture. First, add a local source reader that understands Claude and Codex configuration files and maps them into the plugin SDK's `ExternalProviderSourceSnapshot` shape. The Claude mapper should produce a single current record with `externalId: 'claude:local-current'`, `app: 'claude'`, `providerKind: 'anthropic'`, optional `baseUrl`, optional `model`, optional Claude Agent model aliases, and an optional API-key credential. The Codex mapper should produce a single current record with `externalId: 'codex:local-current'`, `app: 'codex'`, `providerKind: 'openai-compatible'`, optional `baseUrl`, optional `model`, optional `apiMode`, optional reasoning/sandbox/approval settings, and an optional API-key credential.

Second, add focused tests that create temporary directories and files for the reader. These tests must disable process environment input so test results are independent of the developer's real machine. The tests should assert that expected records are returned, missing files produce an empty snapshot rather than an error, missing credentials are represented as informational record-level warnings, and secrets do not appear in metadata.

Third, update server dependency metadata and the external provider source README. Server needs `smol-toml` because Codex configuration is TOML and must be parsed with a structured parser. The README should tell future contributors that the utility exists and is intentionally not registered on startup.

Fourth, expose a controlled Agent import action. In `apps/server/src/plugins/external-provider-source-registry.ts`, export the stable source-key derivation helper so direct refresh can use the same key as registered sources. In `apps/server/src/modules/external-provider-sources/service.ts`, extract refresh logic into a helper and add `refreshDirectExternalProviderSource()` for explicit, unregistered onboarding reads. In `apps/server/src/modules/agent-identity/service.ts`, add `importLocalConfig()` that refreshes the local source, lists active records for that source, resolves each projected runtime target, and creates or reuses an Agent for Claude and Codex. In `apps/web/src/features/agent-runtime/use-agents.ts`, add a TanStack mutation for the import route and invalidate Agents and provider targets on success. In `apps/web/src/features/agent-management/agent-list.tsx`, place an `Import` button next to `Add agent`, show a compact result message, and select the first created or existing imported Agent.

## Concrete Steps

The implementation has already been applied in the current worktree. To reproduce or continue it from repository root `/Users/wibus/dev/Cradle`, inspect these files:

    sed -n '1,460p' apps/server/src/modules/external-provider-sources/local-agent-config-source.ts
    sed -n '200,360p' apps/server/src/modules/agent-identity/service.ts
    sed -n '1,120p' apps/web/src/features/agent-runtime/use-agents.ts
    sed -n '640,720p' apps/web/src/features/agent-management/agent-list.tsx
    sed -n '1,260p' apps/server/tests/local-agent-config-source.test.ts
    sed -n '250,370p' apps/server/tests/agent.test.ts
    sed -n '1,80p' apps/server/src/modules/external-provider-sources/README.md
    rg -n "createLocalAgentConfigExternalProviderSource|local-agent-config|LOCAL_AGENT_CONFIG" apps/server/src apps/server/tests

The final `rg` command should show the source factory in the utility, the Agent import service, and tests. It should not show imports from `apps/server/src/app.ts` or plugin activation code.

Run the focused tests and typecheck from repository root:

    pnpm --filter @cradle/server exec vitest run tests/local-agent-config-source.test.ts
    pnpm --filter @cradle/server exec vitest run tests/agent.test.ts tests/local-agent-config-source.test.ts
    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/server exec vitest run tests/external-provider-sources.test.ts tests/local-agent-config-source.test.ts

Expected results are one passing test file for the first command, two passing test files with six passing tests for the second command, no TypeScript errors for the third command, and two passing test files with eight passing tests for the fourth command.

## Validation and Acceptance

Acceptance for this plan is intentionally internal but observable through tests. A human can verify the feature by running:

    pnpm --filter @cradle/server exec vitest run tests/local-agent-config-source.test.ts

The expected result is:

    Test Files  1 passed (1)
    Tests  4 passed (4)

The most important behavior in that test is that temporary fixture Claude and Codex files produce two records. The Claude record has `externalId: 'claude:local-current'`, `app: 'claude'`, and `providerKind: 'anthropic'`. The Codex record has `externalId: 'codex:local-current'`, `app: 'codex'`, and `providerKind: 'openai-compatible'`. The test also checks that fixture secrets are present only in `credential` fields and not in provider metadata.

Run:

    pnpm --filter @cradle/server exec vitest run tests/agent.test.ts tests/local-agent-config-source.test.ts

The expected result after explicit import integration is:

    Test Files  2 passed (2)
    Tests  6 passed (6)

The new Agent import test creates temporary Claude and Codex config fixtures, configures `CRADLE_CREDENTIAL_SECRET` for encrypted credential projection, calls `POST /agents/import/local-config` twice, and expects the first response to report `created: 2` and the second response to report `existing: 2`. It also expects the HTTP responses not to contain the fixture secret values.

Run:

    pnpm --filter @cradle/server exec vitest run tests/external-provider-sources.test.ts tests/local-agent-config-source.test.ts

The expected result is:

    Test Files  2 passed (2)
    Tests  8 passed (8)

This proves the new utility coexists with the existing external source host behavior.

Run:

    pnpm --filter @cradle/server exec tsc --noEmit

The expected result is command exit code 0 and no TypeScript diagnostics. This proves the new source utility, tests, and dependency metadata typecheck in the server project.

## Idempotence and Recovery

The implementation is additive and safe to re-run. The tests use temporary directories under the operating system temp directory and remove them in `afterEach`. No test reads or writes the real `~/.claude`, `~/.codex`, or `~/.cc-switch` directories. The production utility reads fixed allowlisted paths only when a caller explicitly invokes the snapshot reader or source factory; because it is not registered, simply starting the server does not call it.

If dependency installation or lockfile verification is interrupted, rerun `pnpm install --lockfile-only` or rerun the focused command that triggered installation. The dependency added is `smol-toml` at version `^1.6.1`, which already exists in the workspace lockfile through the CC Switch plugin. If a future contributor accidentally registers the source too early, undo only that import or registry call; keep the utility and tests intact.

If local machine environment variables interfere with manual experiments, pass `LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV=false` through source `sharedConfig` or environment. The tests already do this by using `includeProcessEnv: false` in direct config and shared config override values.

The explicit HTTP import reads only the default allowlisted locations and the process environment switch. Do not add arbitrary file path fields to the public route body; test-only fixture paths should be supplied through environment overrides or direct source-context tests, not through renderer-controlled request payloads.

## Artifacts and Notes

The main implementation file is:

    apps/server/src/modules/external-provider-sources/local-agent-config-source.ts

The focused test file is:

    apps/server/tests/local-agent-config-source.test.ts

The explicit import integration test is in:

    apps/server/tests/agent.test.ts

The dependency and lockfile updates are:

    apps/server/package.json
    pnpm-lock.yaml

Observed validation output from the completed implementation:

    RUN  v4.1.4 /Users/wibus/dev/Cradle/apps/server

    Test Files  1 passed (1)
    Tests  4 passed (4)

    RUN  v4.1.4 /Users/wibus/dev/Cradle/apps/server

    Test Files  2 passed (2)
    Tests  6 passed (6)

    RUN  v4.1.4 /Users/wibus/dev/Cradle/apps/server

    Test Files  2 passed (2)
    Tests  8 passed (8)

The server typecheck command also exited successfully:

    pnpm --filter @cradle/server exec tsc --noEmit

The web typecheck command was also attempted:

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false

It remained blocked by pre-existing Node type configuration errors under `apps/web/scripts/i18n-workflow/utils.ts`, not by the Agent import files. A separate unrelated generated mutation call in `agent-runtime-settings.tsx` was fixed by passing an empty options object to `refreshExternalSources.mutate({})`.

During validation, pnpm performed lockfile supply-chain checks and Electron postinstall hooks because the server dependency graph changed. Those hooks completed successfully. The worktree also contained unrelated desktop, web, CC Switch, and docs changes that were not part of this plan and were not reverted.

## Interfaces and Dependencies

The local source utility must provide these exported interfaces and functions in `apps/server/src/modules/external-provider-sources/local-agent-config-source.ts`:

    export interface LocalAgentConfigSourceConfig {
      claudeDir: string
      claudeSettingsPath: string
      claudeLocalSettingsPath: string
      codexDir: string
      codexConfigPath: string
      codexAuthPath: string
      includeProcessEnv: boolean
    }

    export function resolveLocalAgentConfigSourceConfig(ctx?: ExternalProviderSourceReadContext | null): LocalAgentConfigSourceConfig

    export function readLocalAgentConfigExternalProviderSnapshot(config: LocalAgentConfigSourceConfig): ExternalProviderSourceSnapshot

    export async function readLocalAgentConfigExternalProviderSnapshotFromContext(ctx: ExternalProviderSourceReadContext): Promise<ExternalProviderSourceSnapshot>

    export function createLocalAgentConfigExternalProviderSource(): ExternalProviderSource

The source id is `local-agent-config`, and the label is `Local Agent Config`. The stable record ids are `claude:local-current` and `codex:local-current`. These ids are intentionally source-local ids; once the source is registered by a future onboarding flow, the host registry will derive a full source key from the owner and source id.

The explicit Agent import preview route has this public shape:

    POST /agents/import/local-config/preview
    body: { includeProcessEnv?: boolean }

The response includes `candidates` and `sourceRefreshes`. Each candidate includes the local app (`claude` or `codex`), `agentName` (`Local Claude` or `Local Codex`), `resolvedProviderName` for the upstream provider used to populate model settings, `sourceKind` (`local-config` or `cc-switch`), source-local external record id, provider target id if projected, model id, endpoint, importability, existing-Agent status, optional reason, notes, and the Agent row when present.

The explicit Agent import commit route has this public shape:

    POST /agents/import/local-config
    body: { includeProcessEnv?: boolean, candidateIds?: string[] }

The response includes the preview, `created`, `existing`, `skipped`, and an `agents` array. Each array item includes the local app (`claude` or `codex`), selected candidate id, `sourceKind`, source-local external record id, provider target id if projected, runtime kind, status (`created`, `existing`, or `skipped`), optional reason, and the Agent row when present. The route intentionally does not expose arbitrary path override fields.

The supported override keys are:

    LOCAL_AGENT_CONFIG_CLAUDE_DIR
    LOCAL_AGENT_CONFIG_CLAUDE_SETTINGS_PATH
    LOCAL_AGENT_CONFIG_CLAUDE_LOCAL_SETTINGS_PATH
    LOCAL_AGENT_CONFIG_CODEX_DIR
    LOCAL_AGENT_CONFIG_CODEX_CONFIG_PATH
    LOCAL_AGENT_CONFIG_CODEX_AUTH_PATH
    LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV

The dependency added to `apps/server/package.json` is:

    "smol-toml": "^1.6.1"

`smol-toml` is used only to parse Codex `config.toml`. Claude files are JSON and are parsed with `JSON.parse` through Zod-backed schemas. Zod validates both reader inputs so malformed files become warnings rather than process crashes.

Revision note, 2026-05-25 09:09Z: Created this ExecPlan after implementing the first local-agent-config onboarding utility. The note exists so future contributors can understand why the source is present but not yet registered at startup.

Revision note, 2026-05-26 03:53Z: Updated this ExecPlan after adding the explicit Settings Agents import flow. The revision records the non-startup boundary, idempotent Agent creation behavior, credential-secret projection requirement, validation evidence, and the public HTTP interface.

Revision note, 2026-05-26 08:05Z: Updated this ExecPlan after correcting CC Switch proxy semantics and Agent detail provider-target migration. The revision records that CC Switch current providers resolve upstream model settings but do not become Agent identities, and that Agent detail/list runtime pickers now use `provider_targets`.
