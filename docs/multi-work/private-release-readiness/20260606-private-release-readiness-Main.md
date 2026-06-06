# Cradle Private Release Readiness Audit

Date: 2026-06-06

Scope: determine whether Cradle is ready to invite private release testers. Signing, notarization, and certificate issues are intentionally excluded.

Method: 12 independent subagent audits plus main-thread verification commands. This audit did not fix source code. The only intentional written artifacts are the handoff markdown files in this directory.

## Verdict

Cradle is not ready for private release testing.

The current worktree has multiple release blockers across build gates, desktop packaging, runtime/server contracts, database migrations, plugins/skills packaging, web runtime, E2E coverage, and tester onboarding. The risk is not a single rough edge; several core private-test paths cannot be trusted end to end:

- Build/type gates are red for server/web surfaces.
- Current desktop release artifacts are stale and incomplete.
- Current migrations needed by runtime are untracked or absent from existing artifacts.
- Packaged plugin and builtin skill resources are incomplete.
- Tester-facing onboarding/install/update/feedback paths are not documented.

## Effective Audit Rounds

The requested minimum was at least 10 subagent investigation rounds. This run produced 12 effective handoff files:

1. `20260606-desktop-packaging-ReleaseAuditA2.md`
2. `20260606-native-desktop-ReleaseAuditB.md`
3. `20260606-server-runtime-ReleaseAuditC.md`
4. `20260606-database-migrations-ReleaseAuditD.md`
5. `20260606-web-runtime-ReleaseAuditE.md`
6. `20260606-cli-runtime-ReleaseAuditF.md`
7. `20260606-plugins-skills-ReleaseAuditG.md`
8. `20260606-e2e-journeys-ReleaseAuditH.md`
9. `20260606-config-env-ReleaseAuditI.md`
10. `20260606-docs-onboarding-ReleaseAuditJ.md`
11. `20260606-dependencies-ReleaseAuditK.md`
12. `20260606-dirty-regressions-ReleaseAuditL.md`

## Main-Thread Verification

Commands run from `/Users/wibus/dev/Cradle`:

```bash
pnpm typecheck
pnpm test
pnpm --filter @cradle/web exec tsc --noEmit
pnpm --filter @cradle/cli exec tsc --noEmit
pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json
pnpm --filter @cradle/web build
pnpm --filter @cradle/cli build
pnpm --filter @cradle/server exec tsc --noEmit
```

Observed main-thread results:

- `pnpm typecheck` failed on `thinkingEffort` contract mismatches.
- `pnpm test` failed: desktop `window-manager` tests, native `better-sqlite3` ABI mismatch tests, and an empty design-system test file.
- `pnpm --filter @cradle/web exec tsc --noEmit` failed on `thinkingEffort` UI/API type mismatch.
- `pnpm --filter @cradle/cli exec tsc --noEmit` passed.
- `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json` passed.
- `pnpm --filter @cradle/web build` produced a bundle, but Vite DevTools started an unauthenticated local service after build.
- `pnpm --filter @cradle/cli build` passed.
- `pnpm --filter @cradle/server exec tsc --noEmit` failed in the main-thread run with `thinkingEffort` and Elysia response-contract errors. Some subagent runs observed server typecheck passing in their isolated timing/environment; the conservative release conclusion treats the reproduced main-thread failure and other failing server tests as blockers.

## Blockers

### 1. Type and Contract Gates Are Red

Evidence:

- Main-thread `pnpm typecheck` failed.
- Main-thread `pnpm --filter @cradle/web exec tsc --noEmit` failed.
- Main-thread `pnpm --filter @cradle/server exec tsc --noEmit` failed.
- Audits C, E, and L independently identify `thinkingEffort` split across DB schema, server model/service, generated OpenAPI types, and web UI.

Impact:

Private release cannot rely on current build gates. The issue is semantic, not just TypeScript noise: `auto`, `none`, `minimal`, and `max` are inconsistently accepted or rejected across agent identity, chat runtime, persistence, generated clients, and UI.

### 2. Current Desktop Release Artifacts Are Not Distributable

Evidence:

- Audit A2 found existing DMG/ZIP artifacts missing `Resources/bin/cradle` and `Resources/cli/index.js`.
- Audit A2 found existing artifacts only include migrations through `0060`, while the repo has migrations through `0064`; the unpacked app only reaches `0062`.
- Audit L found ignored local release bundles still expose removed `pack-codebase` HTTP, CLI, and MCP surfaces.

Impact:

The current `apps/desktop/release` artifacts must not be sent to testers. They do not represent the source tree and are missing core resources.

### 3. Database Migration Inputs Are Not Release-Safe

Evidence:

- Audit D found `0061` to `0064` Drizzle SQL and snapshot files are untracked.
- Runtime code already depends on migration `0064` making `backend_runs.binding_id` nullable.
- A2 confirmed existing artifacts do not include all current migrations.

Impact:

Clean checkout, CI, or packaged app builds can miss required schema upgrades. Existing tester databases may fail on startup or run creation.

### 4. Server Startup and Runtime Diagnostics Are Not Ready

Evidence:

- Audit C found focused startup/OpenAPI/health/chat-runtime tests could not construct the server app in the observed environment due to native SQLite ABI mismatch.
- Audit C found `/health` and `/openapi.json` registration is behind startup chat-runtime DB recovery.
- Audit C found `/chat/runtimes/health` exists but builtin providers do not implement real `healthCheck()` methods.

Impact:

Basic liveness can be swallowed by DB/native/runtime failures, and testers will not have actionable diagnostics for Codex, Claude, ACP, Jarvis, or OpenAI-compatible runtime failures.

### 5. Plugins and Builtin Skills Are Not Packaged Coherently

Evidence:

- Audit G found packaged `browser-use` MCP server cannot resolve `@modelcontextprotocol/sdk`.
- Audit G found packaged desktop only includes `browser-use`, not `system-info` or `cc-switch`.
- Audit G found `system-info` and `cc-switch` manifests still point at TypeScript source entries.
- Audit G found `resources/skills` are not copied into desktop resources, so builtin `cradle-cli` and `observability-debugger` skills are missing.

Impact:

Private testers will see broken or absent plugin/tooling surfaces, including browser automation and baseline Codex skill guidance.

### 6. Web Runtime Critical Paths Are Failing

Evidence:

- Audit E found web typecheck failed.
- Audit E found `pnpm --filter @cradle/web test` failed across query refresh, BrowserPanel, and Kanban runtime-provider boundaries.
- Audit E found `i18n:check` failed with 61 missing keys in settings/chat runtime text.
- Audit E found web build starts unauthenticated Vite DevTools and can leave a service/process behind.

Impact:

Agent settings, chat runtime settings, browser panel, kanban, and localized settings/chat screens are not stable enough for invited testers.

### 7. E2E Does Not Validate The Packaged Private Release Shape

Evidence:

- Audit H found no root first-class E2E/private-release gate script.
- Audit H found current E2E uses Chromium plus Vite web/dev server, not packaged Electron.
- Audit H found first-run onboarding, provider import, browser panel, workspace diff, Appshot, and broader approval/runtime flows lack private-test coverage.
- Audit L found workspace detail E2E still targets deleted capsule composer test IDs.

Impact:

Existing E2E coverage cannot prove the actual artifact and first-day tester journey.

### 8. Tester Onboarding and Operations Are Missing

Evidence:

- Audit J found no tester-facing path from invite to install to first successful chat.
- Audit J found quick start docs include inaccurate packaged build commands.
- Audit J found no private tester checklist or feedback submission protocol.
- Audit I found update testing depends on build-time `CRADLE_DESKTOP_UPDATE_URL` and has no repo-local release feed guard.

Impact:

Even if a package were built, testers would lack reliable install, setup, provider configuration, update, and feedback instructions.

## High-Risk Non-Blockers

- Native desktop quit lifecycle is confusing: tray quit is intercepted by double Command-Q guard, and normal quit can detach rather than stop the desktop-owned server. See Audit B.
- macOS permissions for Appshot/global hotkey are exposed through bridge APIs but not discoverable in product UI. See Audit B.
- Notification center lacks authorization/fallback handling. See Audit B.
- CLI mostly builds, but `gen:cli`/OpenAPI drift checks require explicit data-dir env, and root `bin` points to ignored dist output. See Audit F.
- Native ABI handling is split between workspace Node and Electron runtime. Packaged macOS arm64 native deps can load in the checked artifact, but dev/test ABI is currently broken and Windows/Linux packaging boundaries are not validated. See Audit K.
- Server and desktop docs are stale relative to Elysia composition and current private-release operations. See Audits C and J.
- `.env.example` includes a fixed `CRADLE_CREDENTIAL_SECRET`, and telemetry/diagnostics defaults need privacy review before private test. See Audit I.

## Minimum Release-Test Gates

Before inviting private testers, require at least:

1. Server and web typecheck pass from a clean checkout.
2. Unit tests relevant to desktop main, server runtime, web runtime, DB migration, and plugins pass under the intended Node/Electron ABI.
3. Drizzle migrations `0061` to `0064` are tracked and packaged.
4. A fresh desktop package is built and inspected, with stale `apps/desktop/release` artifacts removed or ignored by the release process.
5. Packaged app contains required CLI, bin, migrations, plugins, plugin runtime deps, and builtin skills.
6. Packaged app can launch, serve health/OpenAPI, load runtime settings, create a workspace, configure a provider, and complete a first chat.
7. Browser/Appshot/plugin paths either work in packaged app or are hidden from testers.
8. Private tester install, first-run setup, update, diagnostics, and feedback docs exist.
9. Update channel behavior is explicitly configured or explicitly out of scope for the first private test.
10. Removed `pack-codebase` surfaces are absent from distributed artifacts and user-facing docs.

## Final Recommendation

Do not invite private testers yet.

The next action should be a release-blocker cleanup pass owned by feature area: contracts/migrations, desktop packaging, plugin resources, web runtime, server diagnostics, E2E packaged smoke, and tester docs. After that, rerun this audit against a clean checkout and a freshly produced desktop artifact.
