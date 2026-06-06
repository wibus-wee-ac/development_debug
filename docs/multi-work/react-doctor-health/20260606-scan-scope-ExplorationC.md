# React Doctor Scan Scope Investigation

## Executive Conclusion

React Doctor's duplicate paths in the Cradle baseline are real report-level duplication. The same physical package files are being reported once with the monorepo-relative path, such as `apps/web/src/features/chat/image-lightbox.tsx`, and once with the package-local path, such as `src/features/chat/image-lightbox.tsx`.

The likely cause is React Doctor's workspace scan strategy: from the repository root it scans workspace projects, but also reports per-project findings relative to each project directory. In a monorepo where many packages have `src`, `components`, `lib`, or `showcase/src` directories, those package-local paths collide in the aggregate report.

The correct first response is scope control, not broad rule suppression. Use React Doctor's existing supported controls to avoid duplicate scan roots and generated noise:

- Prefer targeted scan commands for focused work, especially `npx -y react-doctor@latest apps/web --verbose --diff` or `npx -y react-doctor@latest --project @cradle/web --verbose --diff`.
- If a root-level config is added later, use `doctor.config.*` only for scan scope and generated-file excludes, not to hide React semantics rules.
- Exclude generated files such as `apps/web/src/api-gen/**` from React Doctor if the tool supports config in the installed version. It does: `ReactDoctorConfig.ignore.files` excludes files from scanning entirely.

No package or config file was modified in this investigation.

## Evidence Read

Inputs inspected:

- `docs/exec-plans/20260606-02-react-doctor-health.md`
- root `package.json`
- `pnpm-workspace.yaml`
- `eslint.config.mjs`
- `.gitignore`
- `.prettierignore`
- `knip.json`
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `apps/web/vite.config.ts`
- React Doctor baseline under `/var/folders/vx/5kj6zs2n1zsb9k23r5gm9qbh0000gn/T/react-doctor-71b76d8b-ebae-43d0-ab94-c97104efd92f`
- cached React Doctor `0.4.0` README, CLI help, and `ReactDoctorConfig` type under `/Users/wibus/.npm/_npx/81e833f6d16d6127/node_modules/react-doctor`

Baseline facts:

- `diagnostics.json` contains `4993` diagnostics across `1066` unique reported file paths.
- `src/*` bare paths account for `2306` diagnostics across `324` reported file paths.
- `apps/web/*` paths account for `1686` diagnostics across `269` reported file paths.
- `dist`, `build`, `out`, `coverage`, `docs`, Markdown files, and `node_modules` did not appear in the baseline diagnostic paths.

Duplicate-pair evidence:

| Scan root | Duplicate path pairs | Diagnostics in paired paths |
| --- | ---: | ---: |
| `apps/web` | `269` | `3378` |
| `apps/landing` | `12` | `126` |
| `apps/playground` | `5` | `35` |
| `packages/tabs-next` | `4` | `48` |
| `packages/streamdown` | `25` | `196` |
| `packages/design-system` | `16` | `182` |
| `packages/plugin-sdk` | `3` | `12` |
| `plugins/system-info` | `2` | `34` |
| `plugins/browser-use` | `1` | `2` |
| `plugins/cc-switch` | `1` | `2` |
| `documentations` | `7` | `32` |

Representative duplicate pairs:

- `apps/web/src/features/chat/image-lightbox.tsx` and `src/features/chat/image-lightbox.tsx`
- `apps/web/src/features/browser/browser-annotation-adjustment-panel.tsx` and `src/features/browser/browser-annotation-adjustment-panel.tsx`
- `packages/tabs-next/src/components/tab-bar.tsx` and `src/components/tab-bar.tsx`
- `packages/streamdown/src/blocks/code-block.tsx` and `src/blocks/code-block.tsx`
- `apps/landing/src/components/footer.tsx` and `src/components/footer.tsx`
- `documentations/components/home/hero.tsx` and `components/home/hero.tsx`

These are not just repeated lines inside one text report. The duplicate paths exist in `diagnostics.json`, so downstream score and issue counts can be distorted.

## Likely Scan Roots Causing Duplication

The root workspace is:

```yaml
packages:
  - packages/*
  - apps/*
  - plugins/*
  - documentations
```

React Doctor CLI help exposes:

```text
react-doctor [options] [command] [directory]
--project <name>    select workspace project (comma-separated for multiple)
-y, --yes           skip prompts, scan all workspace projects
```

The baseline was run from repository root with:

```bash
npx -y react-doctor@latest . --verbose
```

Given the output shape, the likely behavior is:

1. React Doctor detects the pnpm workspace at `/Users/wibus/dev/Cradle`.
2. It scans all workspace projects because `-y` is implied by `npx -y` for npm, while the command itself also receives `-y` in the observed invocation pattern or otherwise skips workspace selection.
3. For package-local scans, diagnostics are emitted relative to the scanned package directory.
4. The aggregate report also includes monorepo-relative paths for the same project files.

This creates ambiguous bare paths:

- `src/components/footer.tsx` likely means `apps/landing/src/components/footer.tsx` in one diagnostic.
- `src/components/tab-bar.tsx` likely means `packages/tabs-next/src/components/tab-bar.tsx` in another.
- `src/features/chat/image-lightbox.tsx` likely means `apps/web/src/features/chat/image-lightbox.tsx`.
- `src/web.tsx` can map to plugin projects such as `plugins/system-info/src/web.tsx`, not `apps/web`.

Therefore, a bare `src/...` diagnostic should not be edited directly by path. It must be mapped back to the owning package root before source changes.

## Existing Repository Excludes

The repository already excludes many paths in tools React Doctor did not fully inherit.

Root `.gitignore` excludes:

- `node_modules`
- `dist`
- `out`
- `.eslintcache`
- `*.tsbuildinfo`
- `data`
- `.env`
- `chronicle/target/`
- `apps/desktop/release`
- `.cradle/`
- `apps/server/openapi.json`
- `apps/web/i18n-hardcoded-report.json`
- `apps/web/i18n-missing-report.json`
- `apps/web/i18n-unused-keys-report.json`
- `.build`
- `tmp`
- `artifacts`
- `.pnpm-store`

Root `eslint.config.mjs` ignores:

- `**/components/ui/**`
- `**/routeTree.gen.ts`
- `**/api-gen/**`
- `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**`
- `apps/server/src/modules/chat-runtime-providers/codex/app-server-capabilities.ts`
- `.agents/**`
- `.claude/**`
- `.tools/**`
- `apps/desktop/scripts/**`
- `documentations/.source/**`
- `docs/design-system/tokens.json`
- `**/dist/**`
- `**/build/**`
- `**/out/**`
- `**/coverage/**`
- `**/*.tsbuildinfo`
- `**/*.md`
- `packages/cli/**`

Root `knip.json` ignores:

- `**/*.d.ts`
- `**/routeTree.gen.ts`
- `**/api-gen/**`
- `.agents/**`
- `.claude/**`

`apps/web/tsconfig.json` includes `src/**/*` and excludes:

- `src/api-gen/**`

## Generated And Build Paths To Exclude

React Doctor `0.4.0` supports a `doctor.config.*` file and this typed field:

```ts
interface ReactDoctorIgnoreConfig {
  files?: string[];
}
```

The type documentation says `ignore.files` contains glob patterns whose files are excluded from scanning entirely, matched against paths relative to the scanned directory.

Recommended generated/build excludes if a root config is introduced:

```jsonc
{
  "$schema": "https://react.doctor/schema/config.json",
  "ignore": {
    "files": [
      "**/api-gen/**",
      "**/routeTree.gen.ts",
      "**/*.tsbuildinfo",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/coverage/**",
      "apps/server/openapi.json",
      "apps/web/i18n-hardcoded-report.json",
      "apps/web/i18n-missing-report.json",
      "apps/web/i18n-unused-keys-report.json",
      "documentations/.source/**"
    ]
  }
}
```

Baseline impact:

- `api-gen` currently contributes `403` diagnostics across `12` files.
- `apps/web/src/api-gen/**` is mostly `deslop/unused-export` noise from generated client files. It also has a small number of general static diagnostics such as `react-doctor/no-barrel-import`, `react-doctor/async-await-in-loop`, and `react-doctor/js-index-maps`.
- `dist/build/out/coverage` contributes `0` diagnostics in the baseline, but should still be excluded defensively because those directories exist locally.

Do not blindly exclude `**/components/ui/**` in React Doctor yet.

The root ESLint config ignores `**/components/ui/**`, but React Doctor reported `260` diagnostics across `88` component UI paths. Some are likely design-system or generated-shadcn noise, but others are real React or accessibility risks:

- `react-hooks-js/set-state-in-effect`
- `react-doctor/exhaustive-deps`
- `react-doctor/no-aria-hidden-on-focusable`
- `react-doctor/control-has-associated-label`
- `react-doctor/no-event-handler`

If UI primitives are excluded, it should be done with a narrower rule-level or package-ownership decision, not as a scan-scope cleanup default.

## Risks Of Suppressing Valid Diagnostics

Suppressing by rule is risky here because the duplicate problem is path-level, while many rules point at real React semantics:

- `react-doctor/rules-of-hooks` and `react-hooks-js/hooks` can indicate real hook-order violations.
- `react-hooks-js/purity` and `react-doctor/no-render-in-render` can block React Compiler optimization or expose render-time side effects.
- `react-hooks-js/set-state-in-effect` may identify cascading render patterns that are expensive or semantically fragile.
- Accessibility rules in UI primitives can affect every app consumer, even when the component file is shared or scaffolded.
- Dead-code diagnostics for generated API files are mostly noise, but dead-code diagnostics for feature files can identify stale architecture and should not be globally disabled.

The main false-positive control should be:

1. Remove duplicate scan roots.
2. Exclude generated files from scanning.
3. Only then evaluate remaining diagnostics by source inspection.

Avoid these broad suppressions for the current health plan:

- Do not set `rules["react-doctor/react-compiler-no-manual-memoization"] = "off"` just because it is noisy. It has `1669` baseline diagnostics, and turning it off would hide real places where the project may be relying on manual memoization despite React Compiler.
- Do not set `deadCode: false` globally unless the workstream explicitly gives up on dead-code analysis. It would hide generated noise, but also hide real unused files, unused exports, unused dependencies, and circular dependencies.
- Do not suppress all `src/**` paths. In a package-local scan, `src/**` is the actual app or package source.
- Do not suppress all `components/**` paths. In `documentations`, bare `components/**` is real source.

## Recommended Minimal Changes

No changes were made here. The following are recommendations for the main agent.

### Option 1: Prefer focused scripts and avoid root full scans for feature work

This is the lowest-risk change because it avoids new config semantics.

Recommended commands:

```jsonc
{
  "scripts": {
    "doctor:web": "react-doctor apps/web --verbose",
    "doctor:web:diff": "react-doctor apps/web --verbose --diff",
    "doctor:workspace": "react-doctor . --verbose",
    "doctor:workspace:diff": "react-doctor . --verbose --diff"
  }
}
```

For ad hoc current use without installing React Doctor:

```bash
npx -y react-doctor@latest apps/web --verbose --diff
npx -y react-doctor@latest --project @cradle/web --verbose --diff
```

Expected benefit:

- Keeps `@cradle/web` work from being diluted by `apps/landing`, `packages/streamdown`, `packages/tabs-next`, plugins, and documentation.
- Avoids the most confusing bare `src/...` aggregate paths when the target is one package.

Risk:

- Focused scans do not validate cross-workspace packages unless they are selected separately.
- If the web app imports workspace source packages, the focused app scan may still report dependency package files depending on React Doctor's project detection.

### Option 2: Add a root `doctor.config.json` for generated-file excludes only

This addresses generated/build noise while preserving real rules.

Recommended config shape:

```jsonc
{
  "$schema": "https://react.doctor/schema/config.json",
  "ignore": {
    "files": [
      "**/api-gen/**",
      "**/routeTree.gen.ts",
      "**/*.tsbuildinfo",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/coverage/**",
      "apps/server/openapi.json",
      "apps/web/i18n-hardcoded-report.json",
      "apps/web/i18n-missing-report.json",
      "apps/web/i18n-unused-keys-report.json",
      "documentations/.source/**"
    ]
  }
}
```

Expected benefit:

- Removes `apps/web/src/api-gen/**` noise, currently `403` diagnostics across `12` files.
- Aligns React Doctor with existing repository intent from ESLint, TypeScript, Knip, and `.gitignore`.

Risk:

- `ignore.files` excludes files from scanning entirely. If generated code is shipped as runtime code and contains security-sensitive issues, those findings disappear. For `apps/web/src/api-gen/**`, this is acceptable only if ownership remains with the OpenAPI generator and fixes happen at the generator/schema layer.

### Option 3: Use `rootDir` only for a single-owner root config

React Doctor supports:

```jsonc
{
  "rootDir": "apps/web"
}
```

This should not be the default for Cradle's monorepo root unless the team intentionally decides that root `react-doctor` means `@cradle/web` only.

Expected benefit:

- Eliminates workspace aggregate duplication by redirecting scans to `apps/web`.

Risk:

- Hides React Doctor findings from `packages/tabs-next`, `packages/streamdown`, `apps/landing`, `apps/playground`, and plugin web surfaces during root scans.
- Conflicts with the current ExecPlan's broader full-workspace baseline goal.

## Recommended Path Forward

Use Option 1 now and Option 2 after the main agent is ready to edit config:

1. For implementation agents working on `@cradle/web`, run:

```bash
npx -y react-doctor@latest apps/web --verbose --diff
```

2. For full governance scans, run root scans but interpret bare paths as package-local paths until duplication is fixed:

```bash
npx -y react-doctor@latest . --verbose
```

3. Add `doctor.config.json` only with generated/build `ignore.files`, not rule-level suppressions.

4. After adding config, rerun:

```bash
npx -y react-doctor@latest . --verbose --json
```

Then compare:

- total diagnostics
- unique file paths
- `src/*` bare path count
- `api-gen` count
- `@cradle/web` score

The desired result is fewer duplicate/generated findings without a drop in visibility for React semantics, accessibility, and compiler-purity diagnostics.

## Uncertainties

- The exact internal reason for duplicate aggregate paths was inferred from diagnostics and React Doctor CLI/type behavior, not confirmed by stepping through React Doctor source at runtime.
- `--project @cradle/web` should be validated by the main agent before adding a script, because React Doctor's workspace project name matching may use package names, directory names, or both.
- The `npx -y` token is both npm's yes flag and similar to React Doctor's `--yes` flag in CLI help. The baseline command shape may have caused React Doctor to auto-select all workspace projects, but the duplicate report exists regardless of whether the workspace selection prompt was skipped by npm, by React Doctor, or by noninteractive execution.
