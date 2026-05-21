# Web/frontend anti-pattern scan

## Scope

Assigned node: web/frontend anti-pattern scan.

Reviewed repository surfaces:

- `apps/web/**`
- `packages/tabs-next/**`
- `packages/streamdown/**`

Focus areas requested by the spawn prompt:

- dynamic Tailwind classes
- design-system violations
- feature/component ownership
- duplicated UI helpers
- large components with mixed responsibilities
- Zustand/data-flow issues
- generated API type drift
- accessibility regressions
- DRY/SOLID concerns

Repository state note: the working tree was already dirty before this scan. I inspected current files and wrote only this report.

## Findings

### High - Automation feature bypasses generated API hooks/types after generation exists

Evidence:

- `apps/web/src/features/automation/api-client.ts:1` says the file depends on `fetch`, server URL, and endpoint assumptions.
- `apps/web/src/features/automation/api-client.ts:3` says it should be replaced once automation OpenAPI output exists.
- `apps/web/src/features/automation/api-client.ts:18` implements a hand-written `readJson` wrapper over `fetch`.
- `apps/web/src/features/automation/api-client.ts:36` accepts multiple guessed collection envelopes (`automations`, `definitions`, `items`, `data`) instead of the real contract.
- `apps/web/src/features/automation/use-automations.ts:7` imports all automation data functions from that local hand-written client.
- `apps/web/src/features/automation/types.ts:1` and `apps/web/src/features/automation/types.ts:3` state the feature uses local UI-facing contracts until generated types exist.
- Generated automation client functions now exist in `apps/web/src/api-gen/sdk.gen.ts:677`, `apps/web/src/api-gen/sdk.gen.ts:776`, `apps/web/src/api-gen/sdk.gen.ts:793`, and `apps/web/src/api-gen/sdk.gen.ts:832`.
- Generated TanStack Query options now exist in `apps/web/src/api-gen/@tanstack/react-query.gen.ts:823`, `apps/web/src/api-gen/@tanstack/react-query.gen.ts:947`, `apps/web/src/api-gen/@tanstack/react-query.gen.ts:961`, and `apps/web/src/api-gen/@tanstack/react-query.gen.ts:1015`.
- Generated response types show the list endpoint returns an array at `apps/web/src/api-gen/types.gen.ts:1393` to `apps/web/src/api-gen/types.gen.ts:1444`.
- The server route contract also returns arrays directly at `apps/server/src/modules/automation/index.ts:25` to `apps/server/src/modules/automation/index.ts:31`, `apps/server/src/modules/automation/index.ts:86` to `apps/server/src/modules/automation/index.ts:92`, and `apps/server/src/modules/automation/index.ts:110` to `apps/server/src/modules/automation/index.ts:116`.

Why it matters:

This is now confirmed type drift, not a temporary gap. The feature has two parallel API contracts: generated OpenAPI output and local permissive types. The local types allow stale fields such as `triggerJson`, `recipeJson`, `automationId`, `definitionId`, `runId`, `title`, and `mediaType` in `apps/web/src/features/automation/types.ts:42` to `apps/web/src/features/automation/types.ts:79`, while generated types use `trigger`, `recipe`, `automationDefinitionId`, `automationRunId`, `name`, and `mimeType`. That hides breakage from TypeScript and forces UI code to support shapes the current server does not promise.

Recommended fix direction:

- Delete the hand-written automation `api-client.ts` boundary once callers migrate.
- Import generated query options and mutation helpers from `~/api-gen/@tanstack/react-query.gen`.
- Import generated response types from `~/api-gen/types.gen` or derive them from generated query options.
- Keep only feature-owned view-model adapters for display-only concerns such as `latestRun`, date formatting, and dashboard projections.
- Remove compatibility handling for non-contract envelopes unless a migration requirement is explicitly documented.

Verification:

- Run `pnpm --filter @cradle/web typecheck`.
- Run `pnpm --filter @cradle/web test -- src/features/automation`.
- Add or update a focused test proving the automation dashboard consumes generated array responses without `triggerJson` / `recipeJson` fallback paths.

### High - Browser panel mixes privileged Electron webview control, script injection, state orchestration, and UI chrome in one component

Evidence:

- `apps/web/src/features/browser/browser-panel.tsx:14` to `apps/web/src/features/browser/browser-panel.tsx:29` declares an Electron `webview` imperative surface, including `executeJavaScript`.
- `apps/web/src/features/browser/browser-panel.tsx:31` to `apps/web/src/features/browser/browser-panel.tsx:38` hard-codes a remote script injection preset loaded from `https://unpkg.com/react-scan/dist/auto.global.js`.
- `apps/web/src/features/browser/browser-panel.tsx:50` to `apps/web/src/features/browser/browser-panel.tsx:64` creates the `webview` element directly with a persistent partition and `contextIsolation=yes`.
- `apps/web/src/features/browser/browser-panel.tsx:88` to `apps/web/src/features/browser/browser-panel.tsx:131` wires title, navigation, loading, and favicon events directly inside the UI component.
- `apps/web/src/features/browser/browser-panel.tsx:169` to `apps/web/src/features/browser/browser-panel.tsx:174` executes arbitrary preset JavaScript against the active webview.
- `apps/web/src/features/browser/browser-panel.tsx:209`, `apps/web/src/features/browser/browser-panel.tsx:234`, `apps/web/src/features/browser/browser-panel.tsx:256`, `apps/web/src/features/browser/browser-panel.tsx:270`, `apps/web/src/features/browser/browser-panel.tsx:273`, `apps/web/src/features/browser/browser-panel.tsx:276`, and `apps/web/src/features/browser/browser-panel.tsx:292` render raw `<button>` controls instead of the app design-system `Button`.
- `apps/web/src/features/browser/browser-panel.tsx:282` renders a raw `<input>` instead of the app design-system `Input`.

Why it matters:

This component is simultaneously a privileged browser host, a script-injection tool, a webview event adapter, a Zustand consumer, and visual chrome. That raises review cost and security risk. It also bypasses design-system button/input behavior, so future accessibility and interaction fixes in `apps/web/src/components/ui/button.tsx:44` to `apps/web/src/components/ui/button.tsx:67` will not reach this surface.

Recommended fix direction:

- Split a feature-owned `useBrowserWebviews` or `BrowserWebviewHost` boundary from visual chrome.
- Put script injection presets behind an explicit dev-only or allowlisted capability boundary. Do not let remote script URLs live as ordinary UI constants.
- Replace local button/input chrome with design-system primitives where possible.
- Add tests around listener cleanup, URL normalization, tab closing, and disabled navigation controls.

Verification:

- Run `pnpm --filter @cradle/web test -- src/features/browser` after adding tests.
- Run `pnpm --filter @cradle/web typecheck`.
- Manually verify Electron browser panel navigation, close, new tab, reload, and injection controls because `webview` behavior is not fully covered by jsdom.

### Medium - App layout owns feature-specific Browser and Jarvis wiring

Evidence:

- `apps/web/src/components/layout/app-layout.tsx:16` imports `BrowserPanel` from `~/features/browser`.
- `apps/web/src/components/layout/app-layout.tsx:17` and `apps/web/src/components/layout/app-layout.tsx:18` import settings and Jarvis feature stores directly.
- `apps/web/src/components/layout/app-layout.tsx:39` to `apps/web/src/components/layout/app-layout.tsx:75` installs a browser-use bridge and writes browser helper functions onto `window`.
- `apps/web/src/components/layout/app-layout.tsx:122` reads Jarvis expansion state and uses it to transform the center column at `apps/web/src/components/layout/app-layout.tsx:160`.
- `apps/web/src/components/layout/app-layout.tsx:168` to `apps/web/src/components/layout/app-layout.tsx:196` renders BrowserPanel only when the active tab is chat.
- `apps/web/src/components/layout/app-footer.tsx:9` and `apps/web/src/components/layout/app-footer.tsx:10` import Jarvis popover and Jarvis UI store directly.
- `apps/web/src/components/layout/app-footer.tsx:20` to `apps/web/src/components/layout/app-footer.tsx:23` read and mutate Jarvis sessions from global layout chrome.

Why it matters:

`components/layout` should own layout geometry and slots. It currently also owns browser bridge lifecycle, BrowserPanel mounting policy, settings suppression, and Jarvis session tabs. That makes the shell a cross-feature coordination point and undermines the repository ownership rule: feature semantics and lifecycle should remain in the owning feature namespace.

Recommended fix direction:

- Keep geometry in layout, but move feature-specific orchestration into slot providers or feature bridges owned under `features/browser` and `features/system-agent`.
- Let chat tabs register browser panel availability through the existing slot mechanism rather than hard-coding `activeTab?.type === 'chat'` in layout.
- Move Jarvis footer tab composition into a feature-owned footer contribution, leaving layout/footer as a host.

Verification:

- Run `pnpm --filter @cradle/web test -- src/components/layout src/features/system-agent src/features/browser`.
- Add regression tests proving settings tabs still suppress aside/panel content and chat tabs still reveal browser/Jarvis affordances after ownership is separated.

### Medium - Home dashboard ships mock operational data alongside live data

Evidence:

- `apps/web/src/features/home/home-dashboard.tsx:32` marks backend-unsupported mock data.
- `apps/web/src/features/home/home-dashboard.tsx:64` to `apps/web/src/features/home/home-dashboard.tsx:79` defines fixed pending runs with Chinese titles and `Date.now()` timestamps.
- `apps/web/src/features/home/home-dashboard.tsx:81` to `apps/web/src/features/home/home-dashboard.tsx:85` defines fixed artifacts with `Date.now()` timestamps.
- `apps/web/src/features/home/home-dashboard.tsx:384` to `apps/web/src/features/home/home-dashboard.tsx:396` merges live workspaces and sessions with mock artifacts into one activity stream.
- `apps/web/src/features/home/home-dashboard.tsx:426` to `apps/web/src/features/home/home-dashboard.tsx:436` renders the mock pending runs as attention-needed work.
- `apps/web/src/features/home/home-dashboard.tsx:511` to `apps/web/src/features/home/home-dashboard.tsx:518` renders mock artifacts as a normal dashboard section.

Why it matters:

This makes the dashboard display non-existent work as if it were live operational data. It also makes tests and screenshots time-dependent because mock timestamps are computed at module evaluation. The anti-pattern is not just mock data; it is mock state mixed with real query results in the same user-facing surface without a clear demo/dev boundary.

Recommended fix direction:

- Move demo data behind an explicit dev/demo flag or delete it from production dashboard rendering.
- Introduce feature-owned data hooks for pending runs and artifacts when backend support exists.
- Keep dashboard composition data-shaped, but require each section to declare whether it is live, unavailable, or demo-only.

Verification:

- Run `pnpm --filter @cradle/web test -- src/features/home`.
- Add a dashboard test that renders with no workspaces, no sessions, and no automation definitions, and asserts no fake pending runs or artifacts appear in the default production path.

### Medium - `streamdown` smoother can run an unnecessary RAF loop while bypassing open HTML/SVG/XML fences

Evidence:

- `packages/streamdown/src/core/fence-state.ts:81` to `packages/streamdown/src/core/fence-state.ts:84` defines bypass languages for HTML/SVG/XML/HTM fences.
- `packages/streamdown/src/hooks/use-smooth-content.ts:110` to `packages/streamdown/src/hooks/use-smooth-content.ts:117` detects bypass content, syncs the full text, then immediately schedules another `requestAnimationFrame(tick)`.
- That bypass branch does not check whether `streamingRef.current` is still true or whether content length changed before scheduling the next frame.
- The hook already has a lower-frequency wake timer path for the caught-up streaming case at `packages/streamdown/src/hooks/use-smooth-content.ts:119` to `packages/streamdown/src/hooks/use-smooth-content.ts:135`, but the bypass branch returns before reaching it.
- Existing fence tests cover bypass detection at `packages/streamdown/src/core/fence-state.test.ts:32` to `packages/streamdown/src/core/fence-state.test.ts:48`; they do not cover smoother scheduling behavior.

Why it matters:

Streaming an open HTML/SVG/XML fence is exactly the path that can contain large generated blocks. While the bypass is semantically correct, the unconditional RAF loop can keep the renderer at frame-rate work even when the display is already caught up. In a chat UI with multiple retained tabs, that becomes a hidden performance cost.

Recommended fix direction:

- In the bypass branch, sync content and then use the same caught-up wake timer behavior as the normal path, or set `rafId = 0` when no new content is pending.
- Add a hook-level test with fake timers / fake RAF that verifies open bypass fences do not continuously schedule frames while content length is unchanged.
- Consider moving the bypass scheduling policy into a small helper so fence-state behavior and render-loop behavior can be tested independently.

Verification:

- Run `pnpm --filter @cradle/streamdown test -- src/core/fence-state.test.ts`.
- Add and run a `useSmoothContent` scheduling test under `packages/streamdown/src/hooks`.
- Profile a streaming HTML fence in the web app and confirm idle frame work drops after the text catches up.

### Medium - `tabs-next` renders tabs without a `tablist` owner and lacks arrow-key roving behavior

Evidence:

- `packages/tabs-next/src/components/tab-bar.tsx:89` to `packages/tabs-next/src/components/tab-bar.tsx:91` render each tab pill with `role="tab"`, `tabIndex={0}`, and `aria-selected`.
- `packages/tabs-next/src/components/tab-bar.tsx:236` to `packages/tabs-next/src/components/tab-bar.tsx:274` wrap those tabs in ordinary `<div>` / DnD containers, but no parent element has `role="tablist"`.
- `packages/tabs-next/src/components/tab-bar.tsx:83` to `packages/tabs-next/src/components/tab-bar.tsx:88` only handle `Enter` and `Space`; arrow-key navigation is not implemented.
- `packages/tabs-next/src/__tests__/tab-bar.test.tsx:83` to `packages/tabs-next/src/__tests__/tab-bar.test.tsx:88` test labels for close and new-tab controls, but no test asserts tablist semantics or keyboard roving.

Why it matters:

ARIA tab semantics are a contract, not decoration. A `role="tab"` element should be owned by a `tablist`, and keyboard navigation should match user expectations for a tabbed interface. Without this, assistive technology users get incomplete structure, and keyboard users have to tab through every tab/close button instead of moving among tabs predictably.

Recommended fix direction:

- Put `role="tablist"` on the tab collection wrapper.
- Use roving tab index: active tab `tabIndex={0}`, inactive tabs `tabIndex={-1}`.
- Add `ArrowLeft`, `ArrowRight`, `Home`, and `End` navigation.
- Consider `aria-controls` only if stable panel IDs are available from `TabRenderer`.

Verification:

- Run `pnpm --filter @cradle/tabs-next test -- src/__tests__/tab-bar.test.tsx`.
- Add tests for `getByRole('tablist')`, active/inactive `tabIndex`, and arrow-key activation.

### Low - Several frontend surfaces bypass design-system primitives for ordinary controls

Evidence:

- `apps/web/src/features/browser/browser-panel.tsx:209`, `apps/web/src/features/browser/browser-panel.tsx:234`, `apps/web/src/features/browser/browser-panel.tsx:256`, `apps/web/src/features/browser/browser-panel.tsx:270`, `apps/web/src/features/browser/browser-panel.tsx:273`, `apps/web/src/features/browser/browser-panel.tsx:276`, and `apps/web/src/features/browser/browser-panel.tsx:292` use raw `<button>` elements for ordinary chrome controls.
- `apps/web/src/features/browser/browser-panel.tsx:282` uses a raw `<input>`.
- `apps/web/src/features/home/home-dashboard.tsx:415`, `apps/web/src/features/home/home-dashboard.tsx:476`, `apps/web/src/features/home/home-dashboard.tsx:554`, and multiple local row components use raw `<button>` controls.
- The design-system `Button` centralizes variant, size, focus, disabled, active, and icon behavior at `apps/web/src/components/ui/button.tsx:7` to `apps/web/src/components/ui/button.tsx:67`.

Why it matters:

Raw buttons are sometimes legitimate for highly custom list rows, but here they are also used for normal icon buttons and toolbar actions. This causes focus styling, target size, active states, disabled behavior, and future design-system fixes to drift across feature code.

Recommended fix direction:

- Prioritize toolbar/icon controls and form controls for migration to `Button` / `Input`.
- Keep row-like controls raw only when the design-system primitive cannot express the interaction without semantic damage.
- If row buttons are common, introduce an app-specific shared row-action primitive under `components/common` or feature-local shared UI, not repeated hand styling.

Verification:

- Run `pnpm --filter @cradle/web typecheck`.
- Run focused RTL tests for migrated controls, checking accessible names and disabled/focus-visible behavior.
- Manually verify visual density because dashboard/browser chrome are compact surfaces.

## Checked Without Finding Issues

- Dynamic Tailwind class construction: searched `apps/web`, `packages/tabs-next`, and `packages/streamdown` for template-built Tailwind tokens and `className` string concatenation. I did not find application-level dynamic Tailwind generation. The only dynamic `className` constructions found were package-owned BEM-style classes in `packages/streamdown/src/components/highlighted-code.tsx:230` and `packages/streamdown/src/blocks/block.tsx:76`, which are not Tailwind utility construction.
- Static variant mappings: `apps/web/src/features/automation/automation-dashboard.tsx:30` to `apps/web/src/features/automation/automation-dashboard.tsx:37` and `apps/web/src/features/home/home-dashboard.tsx:177` to `apps/web/src/features/home/home-dashboard.tsx:198` use static class maps rather than building Tailwind tokens dynamically.
- `cn` utility ownership: both `apps/web/src/lib/cn.ts:1` to `apps/web/src/lib/cn.ts:7` and `apps/web/src/lib/utils.ts:1` export the same utility boundary, but `utils.ts` is only a re-export. I did not treat this as duplicated implementation.
- `packages/tabs-next` state sanitation: `packages/tabs-next/src/store.ts:100` to `packages/tabs-next/src/store.ts:190` sanitizes persisted tabs and contexts before restoring them, and `packages/tabs-next/src/store.ts:531` to `packages/tabs-next/src/store.ts:534` applies that sanitizer during persist merge.
- `packages/streamdown` fence detection itself: `packages/streamdown/src/core/fence-state.ts:41` to `packages/streamdown/src/core/fence-state.ts:95` has focused tests at `packages/streamdown/src/core/fence-state.test.ts:5` to `packages/streamdown/src/core/fence-state.test.ts:48`. The finding is about render-loop scheduling, not fence parsing.
- Generated automation API output is present in `apps/web/src/api-gen`; the drift problem is usage, not absence of generation.

## Uncertainties

- I did not run the web app or browser automation, so visual regressions are inferred from code structure and should be confirmed in the app.
- I did not run tests. Verification commands above are recommended next steps.
- The BrowserPanel script injection may be intended as a developer-only tool, but the current code does not gate it behind `import.meta.env.DEV` or an explicit allowlist boundary.
- Some raw row buttons may be intentional for density. I only marked this as low severity because the higher-risk cases are ordinary toolbar/form controls.
- The layout/Jarvis/browser ownership finding depends on the intended long-term shell extension model. The existing slot mechanism suggests a cleaner path, but I did not inspect all historical design decisions.

## Quality Gate

- This file is self-contained and can be read without prior chat context.
- The assigned paths and frontend-owned rendering/state concerns were reviewed.
- Findings include severity, exact file paths and line references, evidence, why it matters, recommended fix direction, and verification.
- Checked-without-issue notes and uncertainties are explicit.
- I did not edit files outside `docs/multi-work/anti-pattern-scan/20260521-web-frontend-ReviewB.md`.
