# E2E And User Journey Private Release Readiness Audit H

Scope: E2E feature/step/support coverage, package scripts, and private-tester user journey readiness.

Date: 2026-06-06

Workspace state: audited the current working tree only. The workspace already had broad unrelated local modifications. This audit did not modify source files.

## Verdict

Cradle is not ready to invite private testers based on the current E2E coverage. The feature files are broad and Cucumber can discover all current scenarios, but the release gate is not wired into package scripts, the suite executes the web app in Chromium instead of the packaged Electron/private-release shape, and several high-risk first-run/native/migration journeys have no real E2E coverage.

Read-only command run:

- `npx cucumber-js --config e2e/cucumber.mjs --dry-run --format summary`
- Result: 124 scenarios discovered, 1041 steps discovered, all skipped by dry-run, no undefined-step failure observed.

Coverage shape:

- 23 feature files.
- 124 scenarios.
- 12 `@P0` tags, 103 `@P1` tags, 3 `@P2` tags.
- Only 2 `@smoke` tags, both in `chat.feature`.

## Findings

### 1. Severity: Blocker - No First-Class E2E Release Gate Exists In Package Scripts

Evidence:

- Root `package.json:10-31` defines `test`, `typecheck`, build, dev, CLI, and knip scripts, but no `e2e`, `test:e2e`, `smoke`, or Cucumber script.
- `e2e/AGENTS.md:16-19` documents manual `npx cucumber-js --config e2e/cucumber.mjs` commands instead of a package-owned release script.
- `e2e/cucumber.mjs:3-11` defines the suite, but nothing in the root scripts makes `@P0`, `@smoke`, or full E2E discoverable as a normal release gate.

Impact:

Private release readiness can drift from actual tester-facing behavior because there is no obvious command a release owner or CI job must run before inviting testers. The current state lets a broad suite exist while still being optional, undocumented at the package entrypoint, and easy to skip during packaging.

Confidence: High.

Recommended release gate:

- Add a root-level, package-owned E2E command for `@P0` and a separate full journey command.
- Treat `@P0` as mandatory before private tester invites.
- Keep the direct Cucumber command as implementation detail, not the release contract.

### 2. Severity: Blocker - The Current E2E Suite Does Not Exercise The Packaged Electron Release Shape

Evidence:

- `e2e/src/support/world.ts:185-199` launches Playwright `chromium`, creates a browser context, and navigates to `webUrl`.
- `e2e/src/support/server-lifecycle.ts:133-198` starts `apps/server` with `npx vite-node src/index.ts` and starts `apps/web` with `npx vite --port ...`.
- `e2e/src/support/electron-app.ts:15-31` contains an Electron launcher helper, but `rg` found no imports or calls to `launchElectronApp`, `isElectronMode`, `getElectronApp`, or `getMainPage` under `e2e/src`.
- `e2e/src/support/world.ts:212-218` marks `mainProcess()` unavailable in web mode, while `e2e/AGENTS.md:36-40` still tells authors to access `this.app` and use `this.mainProcess(...)`.
- `e2e/AGENTS.md:14-15` says E2E launches a compiled Electron app, which conflicts with the actual web-mode support code.

Impact:

The suite can pass while missing release-critical behavior owned by Electron main/preload/native IPC: packaged startup, server process ownership, tray menu, quit guard, updater, desktop CLI install, native file dialogs, Mac Bridge, notification center, browser webviews, Appshot hotkey, and packaged asset resolution. This is the biggest readiness gap because private testers will use the desktop app, not `vite` in Chromium.

Confidence: High.

Recommended release gate:

- Introduce a minimal packaged Electron smoke lane before inviting testers.
- At minimum cover app launch, first window render, server connection, workspace add, provider setup, chat send, quit behavior, and one native IPC-backed settings page.
- Keep the existing Chromium/web suite as fast journey coverage, but do not treat it as desktop release readiness.

### 3. Severity: Blocker - First-Run Onboarding Has No E2E Coverage

Evidence:

- `apps/web/src/features/onboarding/onboarding-store.ts:7-43` persists onboarding completion under `cradle:onboarding:v1` and defaults `completed` to `false`.
- `apps/web/src/features/onboarding/onboarding-page.tsx:148-220` renders a full-screen onboarding flow with locale switching, keyboard navigation, skip, next, and completion behavior.
- `rg` found no onboarding feature or step under `e2e/src/features` or `e2e/src/steps`.

Impact:

Private testers are exactly the population most likely to hit first-run onboarding. A broken overlay, blocked completion, locale issue, or persistence regression would prevent testers from reaching the core product before any existing E2E scenario starts. Current coverage mostly assumes the app shell is directly usable.

Confidence: High.

Recommended release gate:

- Add one `@P0` first-run journey that starts from a clean profile, completes or skips onboarding, reloads, and verifies the app shell remains accessible.
- Add a second lower-priority journey for locale switching only if localization is part of the private test ask.

### 4. Severity: High - Private-Tester Migration And Import Journeys Are Missing

Evidence:

- Settings navigation includes `await`, `desktop`, `import`, and `about` entries at `apps/web/src/features/settings/settings-sidebar.tsx:21-30`.
- Settings content maps `import` to `ExternalWorkImportSettings` at `apps/web/src/features/settings/settings-content.tsx:17-30`.
- Native services scan existing Claude and Codex work files from `~/.claude/projects`, `~/.codex/history.jsonl`, and `~/.codex/archived_sessions` at `apps/desktop/src/main/native-services.ts:266-303`.
- Provider settings expose `Import` and `Refresh sources` actions at `apps/web/src/features/agent-management/agent-runtime-settings.tsx:556-570`.
- Current E2E settings coverage only exercises Appearance, Support, Desktop unavailable state, Jarvis, and Chronicle dependency messaging; there are no E2E scenarios for Settings > Import, provider import, external provider source refresh, local agent import, or Await settings.

Impact:

Private testers often start by bringing existing Codex/Claude work, providers, or local agents into Cradle. These flows cross native filesystem scanning, server import APIs, settings UI, and provider/agent projections. Missing coverage here means a tester can fail before reaching the chat/kanban journeys that are currently better covered.

Confidence: High.

Recommended release gate:

- Add Electron-mode import smoke coverage for existing work discovery with isolated HOME fixtures.
- Add at least one provider import journey and one local-agent import/preview journey.
- Cover Await settings if private testers are expected to validate session-await workflows.

### 5. Severity: High - Browser Panel, Workspace Diff, And Appshot Journeys Are Not Covered By E2E

Evidence:

- The app layout hosts a browser panel region at `apps/web/src/components/layout/app-layout.tsx:427-459`.
- `apps/web/src/features/browser/browser-panel.tsx:918-927` returns "Browser Panel is available in the desktop app." when not running in Electron, so the current Chromium/web suite cannot validate real browser panel behavior.
- The browser panel renders workspace diff tabs through `WorkspaceDiffViewer` at `apps/web/src/features/browser/browser-panel.tsx:1215-1222`.
- Appshot hotkey capture is wired from desktop main to renderer at `apps/desktop/src/main/main-app.ts:360-368` and consumed by chat composer runtime at `apps/web/src/features/chat/use-composer-appshot-capture.ts:296-320`.
- `rg` found Appshot and browser-panel unit tests, but no E2E feature covering browser tab open/navigation, workspace diff viewing from Git/tool calls, Appshot hotkey capture, Appshot attachment send, or browser panel desktop IPC.

Impact:

These are high-trust private-release features because they involve native capture, embedded browsing, file/diff inspection, and chat attachments. The current E2E suite cannot catch broken desktop IPC, unavailable browser webviews, stale native capture state, failed screenshot insertion, or diff panel regressions.

Confidence: High.

Recommended release gate:

- Add a desktop-only `@P0` or `@P1` smoke for opening the browser panel and loading a controlled local page.
- Add a workspace diff journey from a real Git change into the browser panel diff viewer.
- Add an Appshot smoke using a mocked/native-test capture path if real macOS permissions are too expensive for CI, and reserve a manual release checklist for real permission/capture validation.

### 6. Severity: High - Approval Coverage Exists, But It Is Narrow And Likely Not Representative Of Current Runtime Risk

Evidence:

- `e2e/src/features/approval.feature:2-26` marks approval as `@P0` and covers allow/deny cards.
- `e2e/src/steps/approval.steps.ts:33-83` builds the scenario by directly writing a mock `anthropic` provider profile through `/profiles/mock-claude-agent`.
- The same step then selects the Claude Agent runtime and a mock provider from UI at `e2e/src/steps/approval.steps.ts:91-110`.
- Current server runtime code has extensive Codex approval and permission-profile types, while the E2E approval journey only covers a Claude Agent mock path and only asserts card disappearance or idle status.

Impact:

Approval is a tester-trust and safety boundary. Current E2E coverage does not prove Codex/App Server approval rendering, named permission profiles, denial propagation, file-change approval, command approval metadata, or reviewer/routing behavior. A private tester could hit a broken or misleading approval path while the `@P0` approval feature still looks covered on paper.

Confidence: Medium-high.

Recommended release gate:

- Keep the existing Claude mock approval scenario, but add at least one Codex/App Server approval journey before private release if Codex is in scope.
- Assert visible decision outcome, not just card disappearance.
- Include denial propagation in the chat transcript/status so testers can trust the permission boundary.

### 7. Severity: Medium - Smoke Tagging Does Not Match Release-Critical Journeys

Evidence:

- Feature statistics show 124 scenarios total, but only 2 `@smoke` tags.
- Both `@smoke` tags are in `chat.feature`; workspace add, onboarding, settings/provider setup, desktop launch, quit, import, browser panel, and approval have no smoke tag.
- `e2e/cucumber.mjs:8-10` runs serially with `parallel: 1` and `retry: 0`, so a full run may be expensive and brittle as the only practical safety net.

Impact:

Release owners do not have a small, meaningful smoke set that maps to "can a new private tester start using Cradle today?" The current smoke set is too narrow and can pass while first-run, desktop, provider setup, import, or native shell flows are broken.

Confidence: High.

Recommended release gate:

- Redefine smoke around a new tester path: first launch/onboarding, add workspace, configure provider, send chat, inspect result, open settings, quit/relaunch.
- Keep deeper workflow coverage in `@P1`, but make smoke a release-invite gate.

## What Is Covered Well

- Workspace CRUD and detail views have multiple real UI scenarios.
- Chat happy path, streaming stop, provider failure, reload recovery, session rename/pin/delete/export, reasoning, tool call rendering, and workspace selection are represented.
- Kanban, issue detail, comments, status columns, issue-agent linkage, search, skills, workflow rules, usage, terminal, Git branch picker, resources, plugins, right aside, keyboard shortcuts, and tab management all have feature-level coverage.
- Dry-run confirms the current feature text and step definitions are at least bound: no undefined-step failure was observed in the read-only listing command.

## Suggested Private Release Gates

1. Add a package-owned `@P0` E2E command and run it as the release invite gate.
2. Add a packaged Electron smoke lane; do not rely on Chromium/web mode for desktop release readiness.
3. Add first-run onboarding coverage from a clean profile.
4. Add importer/migration coverage for external work, provider import, and local agent import.
5. Add desktop-only coverage for browser panel, workspace diff, and Appshot attachment capture.
6. Expand approval coverage to include the Codex/App Server permission path if Codex is included in private testing.
7. Retag smoke scenarios so they represent the private tester first-day journey rather than only chat visibility/send.
