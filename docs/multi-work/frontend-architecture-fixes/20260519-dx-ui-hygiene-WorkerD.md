# DX/UI Hygiene WorkerD Handoff

## Scope

Milestone 4 was implemented within the requested write ownership:

- `apps/web/package.json`
- `apps/web/src/components/ui/README.md`
- Low-risk UI hygiene files outside chat, layout, and `packages/tabs-next`

No chat files, layout files, `packages/tabs-next`, root `package.json`, or `pnpm-lock.yaml` were edited by this worker.

## Changed Files

- `apps/web/package.json`
  - Added package-local `test` script for `@cradle/web`:
    - `vitest run --config vite.config.ts --environment jsdom src`
  - Preserved existing concurrent dependency edits in this file. This worker only owns the script addition.
- `apps/web/src/components/ui/README.md`
  - Added directory ownership and placement boundaries for `components/ui`, `components/common`, and `features/{domain}`.
  - Documented static Tailwind and concrete transition guidance.
  - Flagged existing app-specific candidates for future review without moving them.
- `apps/web/src/components/ui/button.tsx`
  - Replaced `transition-all` with explicit transition properties.
- `apps/web/src/components/ui/badge.tsx`
  - Replaced `transition-all` with explicit transition properties.
- `apps/web/src/components/ui/tabs.tsx`
  - Replaced `transition-all` on `TabsTrigger` with explicit transition properties.
- `apps/web/src/components/ui/switch.tsx`
  - Replaced `transition-all` with explicit transition properties.
- `apps/web/src/components/ui/progress.tsx`
  - Replaced `transition-all` with `transition-transform`, matching the transform-based indicator update.
- `apps/web/src/components/ui/meter.tsx`
  - Replaced `transition-all` with `transition-[width,transform]`.
- `apps/web/src/components/editor/editor-bubble-menu.tsx`
  - Replaced a template-literal `className` with `cn()` and static Tailwind branches.
- `apps/web/src/features/browser/browser-panel.tsx`
  - Added `aria-label` to icon-only browser controls:
    - New browser tab
    - Go back
    - Go forward
    - Reload page

## Behavior Fixed

- `@cradle/web` now has a package-local test command, so reviewers can run web-owned tests through `pnpm --filter @cradle/web test`.
- `components/ui` now has a local README documenting primitive ownership and placement boundaries.
- Core UI primitives no longer use broad `transition-all` for the touched controls.
- The editor bubble menu no longer uses a Tailwind class template literal for active state styling.
- Browser panel icon-only navigation buttons now expose accessible names.

## Validation

Ran:

```bash
git diff --check -- apps/web/package.json apps/web/src/components/ui/README.md apps/web/src/components/ui/button.tsx apps/web/src/components/ui/badge.tsx apps/web/src/components/ui/tabs.tsx apps/web/src/components/ui/switch.tsx apps/web/src/components/ui/progress.tsx apps/web/src/components/ui/meter.tsx apps/web/src/components/editor/editor-bubble-menu.tsx apps/web/src/features/browser/browser-panel.tsx
```

Result: passed with no whitespace errors.

Ran:

```bash
pnpm --filter @cradle/web test
```

Result: failed in the current dirty tree, but the package-local script is invoked correctly.

Latest failure details:

- `apps/web/src/features/chat/chat-render-plan.test.ts` has a syntax parse failure at end-of-file. This file is untracked and outside WorkerD ownership.
- `apps/web/src/features/workspace/workspace-sidebar.test.tsx` has three failures because `@cradle/tabs-next` `Link` calls `useTabsContext` outside a `TabsProvider`. This is outside WorkerD ownership.

Earlier run before adding `--environment jsdom` also failed on `window is not defined` from `apps/web/src/lib/electron.ts`. The final script now uses `jsdom`, so that specific environment mismatch was removed.

Ran:

```bash
pnpm --filter @cradle/web exec tsc --noEmit
```

Result: failed before typechecking WorkerD changes because `apps/web/src/components/editor/code-block-view.tsx` imports `react-icons`, `react-icons/fa`, and `react-icons/si`, while the current install does not resolve those modules. `apps/web/package.json` and `pnpm-lock.yaml` already contain `react-icons`, so this appears to be an install-state or concurrent dependency update issue. WorkerD did not run install and did not edit the lockfile.

Ran:

```bash
npx -y react-doctor@latest . --verbose --diff
```

Result: completed with findings. Relevant `@cradle/web` score: `93 / 100`.

Findings touching WorkerD-edited files:

- `apps/web/src/features/browser/browser-panel.tsx` reports `react/no-unknown-property` for Electron `<webview>` attributes `partition` and `webpreferences`. These lines pre-existed this worker's changes. A real fix may require changing how Electron-specific attributes are applied, so WorkerD did not patch around it with a local suppression.

Other findings were in chat, layout, tabs-next, streamdown, playground, workspace-detail, devtool, and agent-management files outside WorkerD ownership.

## Risks

- `apps/web/package.json` had concurrent or pre-existing dependency edits while this worker ran. WorkerD preserved them and only owns the new `test` script.
- `@cradle/web test` currently runs more tests than WorkerD owns. The command is useful as an ownership entrypoint, but it will stay red until the chat syntax error and workspace sidebar provider setup are fixed by their owners.
- The browser `<webview>` React Doctor warning remains. Fixing it safely should be handled as an Electron/browser-panel follow-up because it touches custom element semantics.
- `components/ui` README documents that `canvas-art.tsx`, `route-loading-fallback.tsx`, `icon-picker.tsx`, and `preview-card.tsx` may be app-specific shared UI. WorkerD intentionally did not move files because import churn is outside low-risk hygiene scope.

## Architecture Escalation Report

API generation ownership remains unresolved and was not changed.

Evidence from the prior hygiene review:

- `apps/web/src/api-gen/` is ignored by `apps/web/.gitignore`.
- Frontend source imports generated modules such as `~/api-gen/sdk.gen`.
- The generator depends on `apps/web/openapi-ts.config.ts` reading `http://localhost:21423/openapi.json`.
- Committing generated files or changing CI/bootstrap policy would require editing ownership outside WorkerD's scope.

Recommendation:

- Decide whether `apps/web/src/api-gen` is a committed artifact or a local generated artifact.
- If committed, remove the ignore rule and include generated output in review.
- If local generated, CI/bootstrap should run generation before web typecheck/build and should not require an already-running local server without an explicit schema artifact.

WorkerD made no CI, generated-code, root package, or lockfile changes.
