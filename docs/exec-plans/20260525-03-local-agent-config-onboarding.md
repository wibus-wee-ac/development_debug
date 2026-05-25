# Local Agent Config Onboarding Source

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a future contributor can read only this file and continue the onboarding local-agent-config work without relying on chat history.

## Purpose / Big Picture

Cradle should be able to notice that a user already has local Claude Code and Codex configuration on the machine, normalize those configurations into the same external provider source shape used by CC Switch, and later reuse the existing external provider refresh pipeline to create Cradle-owned `provider_targets`. This work prepares that capability without enabling it at startup. The current implementation is intentionally a utility and source factory only: it does not register itself with the server, does not write `~/.claude`, `~/.codex`, or `~/.cc-switch`, and does not log or expose real secrets through metadata.

After this change, a developer can run a focused server test that creates temporary Claude and Codex fixture files, calls the local source reader, and observes two standard `ExternalProviderRecord` records: one `anthropic` Claude record and one `openai-compatible` Codex record. A later onboarding step can register the source and call the existing `/external-provider-sources/:sourceKey/refresh` route to project those records into `provider_targets`.

## Progress

- [x] (2026-05-25 08:45Z) Confirmed the existing CC Switch work already uses plugin-first external provider sources, and host projection writes external records into Cradle-owned `provider_targets`.
- [x] (2026-05-25 08:51Z) Added `apps/server/src/modules/external-provider-sources/local-agent-config-source.ts` as an unregistered source utility for local Claude and Codex onboarding data.
- [x] (2026-05-25 08:55Z) Added `smol-toml` to `@cradle/server` dependencies so Codex `config.toml` is parsed with a structured TOML parser rather than ad hoc string scanning.
- [x] (2026-05-25 08:58Z) Added `apps/server/tests/local-agent-config-source.test.ts` with temporary fixture files only; the tests do not read the real user home directory.
- [x] (2026-05-25 09:01Z) Updated `apps/server/src/modules/external-provider-sources/README.md` to list the new onboarding utility and state that it is intentionally not registered on startup.
- [x] (2026-05-25 09:02Z) Verified the new reader and existing host external source tests with focused Vitest commands and server TypeScript checking.
- [x] (2026-05-25 09:09Z) Created this ExecPlan record after implementation to preserve the design, boundaries, validation evidence, and future integration path.

## Surprises & Discoveries

- Observation: Cradle's current provider selection layer is `provider_targets`, while `agent_profiles` now acts as a manual-profile compatibility surface.
  Evidence: `apps/server/src/modules/profiles/service.ts` converts only manual `providerTargets` rows into `AgentProfile` objects; external source projection in `apps/server/src/modules/external-provider-sources/service.ts` writes `provider_targets` rows with `kind: 'external'`.

- Observation: The safest first implementation is an external source utility, not startup integration.
  Evidence: `apps/server/src/app.ts` already calls `refreshAllExternalProviderSources()` after plugin activation when background tasks are enabled. Registering a local source immediately would make it active on every startup, which is explicitly out of scope for this onboarding preparation step.

- Observation: Codex config needs a TOML parser.
  Evidence: CC Switch already uses `smol-toml` in `plugins/cc-switch/src/cc-switch-source.ts` to parse Codex TOML; reusing the same dependency in server keeps the local Codex reader structured and avoids fragile regex parsing.

- Observation: Real Claude and Codex home directories can contain many unrelated session/history files.
  Evidence: A broad local search through `~/.claude` and `~/.codex` produced large session/history output. The final reader therefore reads only fixed allowlisted paths and tests only temporary fixture directories.

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

## Outcomes & Retrospective

The preparation work is complete. The server now has a reusable `createLocalAgentConfigExternalProviderSource()` factory and direct snapshot reader for local Claude and Codex configuration, while startup behavior remains unchanged. Fixture tests prove the mapper returns standard external provider records, handles missing files, emits non-blocking missing-credential warnings, respects context path overrides, and avoids putting test secrets in metadata.

The next product step is to decide where onboarding should register this source. The likely path is a controlled onboarding flow or feature flag that registers the source and then uses the existing external provider source refresh route. That future step should also decide whether detected `provider_targets` automatically create user-visible `agents` or only appear as available provider targets for manual agent creation.

## Context and Orientation

Cradle's server code lives under `apps/server`. The external provider source module lives at `apps/server/src/modules/external-provider-sources`. An external provider source is a reader that returns a normalized snapshot of provider records from some external or local namespace. A provider record is not the same as a Cradle runtime target. The reader returns data; the host projection service validates it, encrypts credentials, stores source records, and creates or updates Cradle-owned `provider_targets`.

The existing host projection service is `apps/server/src/modules/external-provider-sources/service.ts`. It reads registered sources from `apps/server/src/plugins/external-provider-source-registry.ts`, validates each `ExternalProviderSourceSnapshot`, writes `external_provider_sources` and `external_provider_records`, and then creates `provider_targets` rows with `kind: 'external'`.

The local onboarding utility is `apps/server/src/modules/external-provider-sources/local-agent-config-source.ts`. It exports `resolveLocalAgentConfigSourceConfig`, `readLocalAgentConfigExternalProviderSnapshot`, `readLocalAgentConfigExternalProviderSnapshotFromContext`, and `createLocalAgentConfigExternalProviderSource`. It is not imported by `apps/server/src/app.ts`, `apps/server/src/plugins/context.ts`, or any plugin activation path, so it does not run automatically.

The current local file assumptions are deliberately small. For Claude, the reader looks for `~/.claude/settings.json` and `~/.claude/settings.local.json` by default and reads their `env` objects. For Codex, it looks for `~/.codex/config.toml` and `~/.codex/auth.json` by default. All paths can be overridden through the source read context `sharedConfig` or environment variables with the `LOCAL_AGENT_CONFIG_*` names documented below.

## Plan of Work

The implemented plan keeps the feature inside the existing external source architecture. First, add a local source reader that understands Claude and Codex configuration files and maps them into the plugin SDK's `ExternalProviderSourceSnapshot` shape. The Claude mapper should produce a single current record with `externalId: 'claude:local-current'`, `app: 'claude'`, `providerKind: 'anthropic'`, optional `baseUrl`, optional `model`, optional Claude Agent model aliases, and an optional API-key credential. The Codex mapper should produce a single current record with `externalId: 'codex:local-current'`, `app: 'codex'`, `providerKind: 'openai-compatible'`, optional `baseUrl`, optional `model`, optional `apiMode`, optional reasoning/sandbox/approval settings, and an optional API-key credential.

Second, add focused tests that create temporary directories and files for the reader. These tests must disable process environment input so test results are independent of the developer's real machine. The tests should assert that expected records are returned, missing files produce an empty snapshot rather than an error, missing credentials are represented as informational record-level warnings, and secrets do not appear in metadata.

Third, update server dependency metadata and the external provider source README. Server needs `smol-toml` because Codex configuration is TOML and must be parsed with a structured parser. The README should tell future contributors that the utility exists and is intentionally not registered on startup.

## Concrete Steps

The implementation has already been applied in the current worktree. To reproduce or continue it from repository root `/Users/wibus/dev/Cradle`, inspect these files:

    sed -n '1,460p' apps/server/src/modules/external-provider-sources/local-agent-config-source.ts
    sed -n '1,260p' apps/server/tests/local-agent-config-source.test.ts
    sed -n '1,80p' apps/server/src/modules/external-provider-sources/README.md
    rg -n "createLocalAgentConfigExternalProviderSource|local-agent-config|LOCAL_AGENT_CONFIG" apps/server/src apps/server/tests

The final `rg` command should show the source factory only in the new utility and tests. It should not show imports from `apps/server/src/app.ts` or plugin activation code.

Run the focused tests and typecheck from repository root:

    pnpm --filter @cradle/server exec vitest run tests/local-agent-config-source.test.ts
    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/server exec vitest run tests/external-provider-sources.test.ts tests/local-agent-config-source.test.ts

Expected results are one passing test file for the first command, no TypeScript errors for the second command, and two passing test files with eight passing tests for the third command.

## Validation and Acceptance

Acceptance for this plan is intentionally internal but observable through tests. A human can verify the feature by running:

    pnpm --filter @cradle/server exec vitest run tests/local-agent-config-source.test.ts

The expected result is:

    Test Files  1 passed (1)
    Tests  4 passed (4)

The most important behavior in that test is that temporary fixture Claude and Codex files produce two records. The Claude record has `externalId: 'claude:local-current'`, `app: 'claude'`, and `providerKind: 'anthropic'`. The Codex record has `externalId: 'codex:local-current'`, `app: 'codex'`, and `providerKind: 'openai-compatible'`. The test also checks that fixture secrets are present only in `credential` fields and not in provider metadata.

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

## Artifacts and Notes

The main implementation file is:

    apps/server/src/modules/external-provider-sources/local-agent-config-source.ts

The focused test file is:

    apps/server/tests/local-agent-config-source.test.ts

The dependency and lockfile updates are:

    apps/server/package.json
    pnpm-lock.yaml

Observed validation output from the completed implementation:

    RUN  v4.1.4 /Users/wibus/dev/Cradle/apps/server

    Test Files  1 passed (1)
    Tests  4 passed (4)

    RUN  v4.1.4 /Users/wibus/dev/Cradle/apps/server

    Test Files  2 passed (2)
    Tests  8 passed (8)

The server typecheck command also exited successfully:

    pnpm --filter @cradle/server exec tsc --noEmit

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
