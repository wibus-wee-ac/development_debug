# Repository-wide anti-pattern scan synthesis

## Scope

本汇总报告合并 `multi-work` 四个独立扫描节点和主线程静态搜索结果，覆盖当前 Cradle working tree 中的主要反模式风险：

- Server/backend: `docs/multi-work/anti-pattern-scan/20260521-server-backend-ReviewA.md`
- Web/frontend: `docs/multi-work/anti-pattern-scan/20260521-web-frontend-ReviewB.md`
- CLI/generated tooling: `docs/multi-work/anti-pattern-scan/20260521-cli-tooling-ReviewC.md`
- Desktop/Rust/plugins helpers: `docs/multi-work/anti-pattern-scan/20260521-desktop-rust-plugins-ReviewD.md`

本轮目标是“扫描清楚并修复低风险高置信问题”，不是在一个 dirty worktree 中做全仓架构迁移。已修复项限定在 owner 明确、补丁小、测试可证明的范围。剩余项保留为 backlog 或架构升级项。

## Method

主线程先创建 ExecPlan `docs/exec-plans/20260521-04-anti-pattern-scan.md`，再按所有权边界分派四个独立扫描节点。每个节点输出 self-contained handoff report，包含 scope、evidence、severity、recommended fix 和 verification。

主线程随后做了交叉静态搜索和复核，重点包括：

- workspace `.agents/skills` 写入与 skills namespace ownership。
- test-only cleanup 是否会触达真实 user home。
- generated CLI boolean flag、module description 和 fallback drift。
- dynamic Tailwind class construction。
- stale Tsuki/server README references。
- helper/tooling 边界中的 raw IPC、socket、process supervisor、plugin shared config。

## Remediated Findings

### Fixed: workspace skills no longer write to `.agents/skills`

Severity before fix: High.

Owner: `apps/server/src/modules/skills`.

Changed files:

- `apps/server/src/modules/skills/skills-paths.ts`
- `apps/server/tests/skills.test.ts`
- `apps/server/src/modules/skills/README.md`

What changed:

Workspace-scope skill writes now resolve to `<workspace>/.cradle/skills`. The legacy `.agents/skills` scope remains readable as compatibility input but remains read-only for Cradle writes. Tests now assert that creating and updating workspace skills does not create `<workspace>/.agents/skills`.

Verification:

- `pnpm exec vitest run tests/test-reset.test.ts tests/skills.test.ts` from `apps/server`: passed, 2 files, 4 tests.
- `pnpm --filter @cradle/server typecheck`: passed.
- Static search confirms remaining `.agents/skills` references in the skills module are legacy read paths, tests, or documentation, not workspace writes.

### Fixed: `/test/reset` no longer deletes real HOME skills

Severity before fix: High.

Owner: `apps/server/src/modules/test-reset`.

Changed files:

- `apps/server/src/modules/test-reset/index.ts`
- `apps/server/src/modules/test-reset/README.md`
- `apps/server/tests/test-reset.test.ts`
- `apps/server/tests/README.md`
- `e2e/src/support/server-lifecycle.ts`
- `e2e/src/support/README.md`

What changed:

The reset route now only cleans HOME skills when `HOME` is inside the active `CRADLE_DATA_DIR`. Managed E2E server startup now sets `HOME` to an isolated directory under its temp data root. Tests cover both an external HOME sentinel that must survive reset and an isolated HOME sentinel that should be cleaned.

Verification:

- `pnpm exec vitest run tests/test-reset.test.ts tests/skills.test.ts` from `apps/server`: passed, 2 files, 4 tests.
- `pnpm --filter @cradle/server typecheck`: passed.

### Fixed: generated CLI boolean flags can express false

Severity before fix: High.

Owner: `packages/cli/src/runtime`.

Changed files:

- `packages/cli/src/runtime/operation-command.ts`
- `packages/cli/src/runtime/operation-command.test.ts`
- `packages/cli/src/runtime/README.md`

What changed:

Optional boolean flags now register both `--flag` and `--no-flag`. Required boolean flags use `--flag <value>` and parse only strict `true` / `false` strings or boolean values. The runtime no longer maps arbitrary non-empty strings such as `"false"` to `true`.

Verification:

- `pnpm exec vitest run src/runtime/operation-command.test.ts src/runtime/http-client.test.ts` from `packages/cli`: passed, 2 files, 3 tests.
- `pnpm --filter @cradle/cli typecheck`: passed.

### Fixed: automation CLI module description drift

Severity before fix: Medium.

Owner: `packages/cli` generator/runtime and `resources/skills/cradle-cli`.

Changed files:

- `packages/cli/scripts/generate-cli.ts`
- `packages/cli/src/runtime/operation-command.ts`
- `resources/skills/cradle-cli/SKILL.md`

What changed:

The `automation` module now has a concrete description in the generator, runtime command group descriptions, and the generated skill module block. The only remaining `"Generated Cradle CLI module."` string is the generator fallback, not the emitted skill table.

Verification:

- `pnpm --filter @cradle/cli typecheck`: passed.
- Static search confirms `resources/skills/cradle-cli/SKILL.md` no longer contains the fallback text.

### Fixed: stale skills module README inventory

Severity before fix: Medium documentation drift.

Owner: `apps/server/src/modules/skills`.

Changed file:

- `apps/server/src/modules/skills/README.md`

What changed:

The README now describes the Elysia-era `index.ts` and `model.ts` shape instead of stale Tsuki `skills.module.ts` / `skills.controller.ts` files, and documents `.agents` as read-only compatibility input.

Verification:

- Static search over `apps/server/src/modules/skills` confirms the stale `skills.module.ts` / `skills.controller.ts` names are gone from that module README.

## Remaining Confirmed Backlog

### High

- `src/cli/**` still contains a second, legacy `cradle` CLI that bypasses generated OpenAPI ownership. Fix requires an explicit product decision: delete/archive it, or rename it as internal diagnostics and migrate surviving capabilities into generated CLI routes.
- Frontend automation still bypasses generated SDK/query types via a handwritten client. Fix should remove the local API contract and keep only view-model adapters in `features/automation`.
- `apps/web/src/features/browser/browser-panel.tsx` mixes webview control, privileged script injection, state orchestration, and UI chrome. Fix should split host boundary, gate injection, and migrate ordinary controls to design-system primitives.
- Electron preload exposes arbitrary IPC channel access. Fix should narrow `window.cradle` to explicit runtime-validated methods or add a preload allowlist.
- Chronicle cross-process URL ownership still drifts when desktop uses dynamic server ports. Fix should pass `CRADLE_URL` explicitly across desktop/server/Rust process boundaries.
- Desktop plugin shared config is a global env bus. Fix should namespace config by plugin owner and only expose current-plugin config to each server plugin.
- Browser-use backend socket is unauthenticated. Fix should add a per-run token/handshake, private socket directory, and remove default-path fallback outside explicit dev mode.
- Search FTS path lacks a schema/migration owner and has dormant result mapping issues. Fix should either add a DB-owned FTS contract with tests or remove the FTS-first claim and dormant branch until it exists.

### Medium

- Runtime usage aggregation still uses large raw SQL query bodies against Drizzle-owned tables. Fix should move ordinary aggregates to Drizzle APIs while keeping only small typed SQLite expressions where needed.
- Plugin storage API is process-local but exposed as generic storage. Fix should either rename/document it as volatile or add DB-backed plugin storage with stable ownership.
- Server/OpenAPI docs still contain broader stale Tsuki-era architecture references outside the fixed skills README. Fix should update `apps/server/README.md` and `apps/server/src/openapi/README.md`.
- Skill frontmatter parsing is duplicated between source preview and canonical store paths. Fix should extract a single skills-owned parser.
- App layout owns Browser/Jarvis feature wiring. Fix should move feature lifecycle into feature-owned slot providers or bridges.
- Home dashboard mixes mock operational data with live data. Fix should gate demo data behind an explicit dev/demo mode or remove it from production rendering.
- Streamdown bypass-fence smoother can keep scheduling RAF while caught up. Fix should reuse the caught-up timer path and add a hook scheduling test.
- `tabs-next` tab semantics lack a `tablist` owner and arrow-key roving. Fix should add ARIA structure and keyboard navigation tests.
- CLI generator does not validate the OpenAPI boundary before emitting commands. Fix should add assertion/fixture tests for supported schema shapes and duplicate command paths.
- CLI runtime context uses a hidden Commander option and unchecked cast. Fix should move context binding to an explicit helper boundary.
- Legacy desktop browser backend duplicates active browser-use backend. Fix should remove inactive implementation or extract a single protocol owner.
- Desktop server process supervisor has implicit lifecycle state. Fix should use an explicit supervisor with start/stop promises, restart policy, and tests.
- Rust `codex_exec` timeout helper can send late `SIGKILL` by PID. Fix should use a cancellable child timeout mechanism.
- Desktop/server plugin source resolution is split. Fix should share one resolver and one env contract.
- Electron native rebuild helper hard-codes Electron version. Fix should read the installed Electron package version.

### Low

- Some frontend raw buttons and inputs bypass design-system primitives in compact surfaces. Fix opportunistically while touching those features.
- `resources/skills/cradle-cli/SKILL.md` still depends on generator discipline for the module table. The immediate drift is fixed, but a generator validation gate would prevent recurrence.

## Checked Without Finding Issues

- Dynamic Tailwind class construction was checked across `apps/web`, `packages/tabs-next`, and `packages/streamdown`. No application-level dynamic Tailwind utility generation was found. The remaining dynamic `className` construction in streamdown is package-owned BEM-style class naming, not Tailwind utility construction.
- Skills legacy `.agents/skills` compatibility remains read-only; the high-risk issue was workspace writes into `.agents`, now fixed.
- Observability debugger skill uses parameter binding and documents read-only SQLite behavior; no mutation anti-pattern was found in that helper.
- Electron base window hardening uses `contextIsolation`, `nodeIntegration: false`, and `sandbox: true`; the desktop concern is preload exposure, not missing base flags.
- Generated CLI command files remain thin wrappers over `registerOperationCommand`; the scan did not find generated command modules doing their own fetch or output formatting.

## Validation Evidence

Commands already run successfully in this pass:

- `pnpm exec vitest run tests/test-reset.test.ts tests/skills.test.ts` from `apps/server`: passed, 2 files, 4 tests.
- `pnpm exec vitest run src/runtime/operation-command.test.ts src/runtime/http-client.test.ts` from `packages/cli`: passed, 2 files, 3 tests.
- `pnpm --filter @cradle/cli typecheck`: passed.
- `pnpm --filter @cradle/server typecheck`: passed.

Final static audit:

- All four handoff reports exist under `docs/multi-work/anti-pattern-scan/`.
- `resources/skills/cradle-cli/SKILL.md` no longer contains emitted fallback module text.
- Skills workspace writes now resolve to workspace `.cradle/skills`; `.agents/skills` remains only as legacy read compatibility and tests.

## Quality Gate

This synthesis reconciles all four `multi-work` handoff reports, distinguishes fixed findings from architecture backlog, includes helper/tooling-specific risks, and records verification evidence for touched code. The scan objective is complete as a repository-wide anti-pattern inventory; the backlog items are intentionally not marked fixed because they require broader ownership or architecture decisions.
