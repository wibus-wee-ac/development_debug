# ReviewB: UI Copy / L10n Completeness Review

## Scope

- Repository: `/Users/wibus/dev/Cradle-i18n-architecture`
- Review focus: `git diff` touched files under `apps/web/src`, especially `features/**`, `components/**`, `tabs/**`, plus `apps/web/src/locales/default/**` and locale JSON files.
- Out of scope: Round 1 runtime/workflow architecture, unless it directly affects user-visible UI copy.
- Reviewer stance: find user-visible hardcoded copy that `check-hardcoded-text` misses, especially constants, expression strings, aria/title/placeholder, template strings, formatter fallbacks, and dynamic translation-key risks.

## Verification Notes

- `pnpm --filter @cradle/web i18n:check-hardcoded`
  - Result: passed.
  - Important: this only covers JSX text plus literal `aria-label`, `title`, and `placeholder` in `.tsx`; it does not cover many expression strings, constants, default props, menu item children from variables, or non-TSX locale completeness.
- `pnpm --filter @cradle/web i18n:check`
  - Result: failed.
  - Summary: `missingKeys=63`, `extraKeys=0`, `invalidEntries=0`.

## Blockers

### B1. Non-default locales are missing all new `common` provider/model/thinking/runtime keys

- Severity: blocker
- Files:
  - `apps/web/src/locales/default/common.ts:24`
  - `apps/web/src/locales/zh-CN/common.json:1`
  - `apps/web/src/locales/ja-JP/common.json`
  - `apps/web/src/locales/es-ES/common.json`
- Evidence:
  - `apps/web/src/locales/default/common.ts` added 21 keys:
    - `model.emptySelection`
    - `model.noMatchingModels`
    - `model.noModelsAvailable`
    - `model.noProviderTargets`
    - `model.searchPlaceholder`
    - `runtime.*`
    - `thinking.*`
  - `zh-CN`, `ja-JP`, and `es-ES` each miss the same 21 keys, for 63 missing keys total.
- User impact:
  - Provider/model picker and thinking menu copy can fall back to raw keys or English-like fallback behavior when the active locale is not `en-US`.
  - This is a shipped-locale completeness break, not just a hardcoded-text issue.
- Suggested fix:
  - Add the 21 `common` keys to every non-default locale JSON.
  - Re-run `pnpm --filter @cradle/web i18n:check`.

### B2. `ProviderModelMenu` still ships hardcoded model-search and empty-state copy

- Severity: blocker
- File: `apps/web/src/features/composer-toolbar/provider-model-menu.tsx`
- Evidence:
  - `provider-model-menu.tsx:124` uses `placeholder="Search models..."`.
  - `provider-model-menu.tsx:155` renders `No matching models`.
  - `provider-model-menu.tsx:158` renders `No models available`.
  - `provider-model-menu.tsx:244` uses `title="Fuzzy models.dev match"`.
- Why scanner missed it:
  - The current scanner only reports literal `placeholder` when it sees it, but the run passed; menu children and title strings in shared generic menu flows are not sufficient as a completeness gate here.
- User impact:
  - Composer toolbar/provider model menu remains English in non-English locales.
- Suggested fix:
  - Use `common:model.searchPlaceholder`, `common:model.noMatchingModels`, `common:model.noModelsAvailable`.
  - Add a `common` key for the fuzzy match title if the tooltip/title is intended to remain user-facing.

### B3. Jarvis popover has multiple untranslated controls, placeholders, and error fallbacks

- Severity: blocker
- File: `apps/web/src/features/system-agent/jarvis-popover.tsx`
- Evidence:
  - `jarvis-popover.tsx:169` fallback: `Session creation failed`.
  - `jarvis-popover.tsx:180` fallback: `Failed to create session`.
  - `jarvis-popover.tsx:333` `aria-label="Stop"`.
  - `jarvis-popover.tsx:343` `aria-label="Send"`.
  - `jarvis-popover.tsx:395` `aria-label={jarvisExpanded ? 'Collapse' : 'Expand'}`.
  - `jarvis-popover.tsx:406` `aria-label="Close"`.
  - `jarvis-popover.tsx:424` `aria-label="Jarvis message"`.
  - `jarvis-popover.tsx:433` placeholder: `Configure a profile in Settings → Jarvis` / `Ask Jarvis...`.
  - `jarvis-popover.tsx:452` label: `Include context`.
- Why scanner missed it:
  - Most are expression strings, conditional placeholder expressions, or runtime fallback strings.
- User impact:
  - Settings/Jarvis support flow remains visibly English and screen-reader copy remains English.
- Suggested fix:
  - Move these to `system-agent` namespace or shared `common` action keys where appropriate.
  - Keep `Jarvis` itself as a brand/product name; translate surrounding action words only.

### B4. Chat main view still has untranslated empty/error/thinking copy

- Severity: blocker
- File: `apps/web/src/features/chat/chat-view.tsx`
- Evidence:
  - `chat-view.tsx:132` renders `Send a message to start the conversation`.
  - `chat-view.tsx:160` fallback renders `Failed to load messages. (Unknown error)`.
  - `chat-view.tsx:178` renders `Thinking...`.
  - `chat-view.tsx:213` fallback `source` is hardcoded as `event`.
- Why scanner missed it:
  - These are expression/fallback strings, not necessarily plain JSX literals caught by the current CI report.
- User impact:
  - Core chat surface remains partially English in every non-English locale.
- Suggested fix:
  - Add keys under `chat`, for example empty conversation, load failure fallback, thinking indicator, and await source fallback.

### B5. Kanban issue detail assignee picker has hardcoded user-visible labels

- Severity: blocker
- File: `apps/web/src/features/kanban/issue-detail/properties-sidebar.tsx`
- Evidence:
  - `properties-sidebar.tsx:66` current-user fallback name: `Me`.
  - `properties-sidebar.tsx:207` unknown-user fallback: `Unknown user`.
  - `properties-sidebar.tsx:266` trigger fallback: `Unassigned`.
  - `properties-sidebar.tsx:273` menu option: `Unassigned`.
  - `properties-sidebar.tsx:276` menu label: `Team members`.
  - `properties-sidebar.tsx:284` menu label: `AI Agents`.
  - `properties-sidebar.tsx:289` empty state: `No agents configured`.
- Why scanner missed it:
  - Constants and expression fallback strings are outside its effective coverage.
- User impact:
  - Kanban issue detail sidebar remains English while the context menu path already uses translated assignee labels. This creates inconsistent l10n inside the same feature.
- Suggested fix:
  - Reuse existing `kanban` assignee keys where possible, and add missing keys for team/AI agent group labels and no-agent empty state.

### B6. Skill import dialog header/close aria still has untranslated copy

- Severity: blocker
- File: `apps/web/src/features/skills/skill-import-dialog.tsx`
- Evidence:
  - `skill-import-dialog.tsx:635` renders `Import Skills`.
  - `skill-import-dialog.tsx:641` uses `aria-label="Close"`.
- Why scanner missed it:
  - The hardcoded-text gate passed despite these visible strings, so this is currently not protected.
- User impact:
  - The skills import modal has a translated body but untranslated chrome/header controls.
- Suggested fix:
  - Use `skills:import.title` or a dedicated `skills:import.header`, and `common:action.close` for the close aria.

## Non-Blockers

### N1. Devtool plugin details and plugin graph still contain many hardcoded diagnostic labels

- Severity: non-blocker
- Files:
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:221`
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:244`
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:267`
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:273`
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:286`
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:301`
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:316`
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:331`
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:343`
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:357`
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:358`
  - `apps/web/src/features/devtool/plugins/plugin-graph.tsx:618`
  - `apps/web/src/features/devtool/plugins/plugin-graph.tsx:678`
- Evidence:
  - Examples include `Descriptor`, `Entry Points`, `Activated:`, `Layers`, `Capabilities`, `Declared Capabilities`, `Declared Permissions`, `Warnings`, `Web Contributions`, `Execute command`, `Runtime Graph`, `No node selected`.
- User impact:
  - This is visible in devtool UI. It is less severe than product surfaces, but the user explicitly called out devtool/plugin graph as a scanner gap.
- Suggested fix:
  - Either localize devtool chrome labels under `devtool.plugins.*` / `devtool.pluginGraph.*`, or declare the devtool inspector as intentionally English technical UI and add an explicit allowlist/policy.
- Not counted as blocker because:
  - Many values in this panel are plugin manifest data, IDs, statuses, layer names, or technical diagnostics. Those should not be blindly translated.

### N2. Devtool time formatting is locale-pinned or manually abbreviated

- Severity: non-blocker
- Files:
  - `apps/web/src/features/devtool/plugins/plugins-panel.tsx:11`
  - `apps/web/src/features/devtool/health/health-panel.tsx:20`
  - `apps/web/src/features/devtool/health/health-panel.tsx:79`
  - `apps/web/src/features/devtool/observability/observability-events-table.tsx:7`
- Evidence:
  - `formatTimeSince` returns `Xs ago`, `Xm ago`, `Xh ago`.
  - `formatUptime` returns `Xh Xm Xs`.
  - time display uses `toLocaleTimeString('en-US', ...)`.
- User impact:
  - Locale switching does not affect these date/time fragments.
- Suggested fix:
  - For user-facing devtools, use `Intl.RelativeTimeFormat` / locale-aware `DateTimeFormat` from i18n language.
  - If devtools intentionally use machine-readable English abbreviations, document that policy.

### N3. App footer Jarvis session tab fallback and close aria are untranslated

- Severity: non-blocker
- File: `apps/web/src/components/layout/app-footer.tsx`
- Evidence:
  - `app-footer.tsx:56` fallback title: `Untitled`.
  - `app-footer.tsx:61` aria: `Close Jarvis session ${sess.title || 'Untitled'}`.
- User impact:
  - Visible only when a Jarvis session title is empty; screen-reader label is always English.
- Suggested fix:
  - Add `chrome.footer.jarvis.untitledSession` and `chrome.footer.jarvis.closeSessionAria`.

## Suggestions

### S1. Expand `check-hardcoded-text` coverage beyond JSX text and literal props

- Current scanner misses the exact classes of issues found in this round:
  - string literals inside conditional expressions;
  - fallback operands in `??` / `||`;
  - constants such as `CURRENT_USER_ASSIGNEE.name`;
  - default prop values;
  - component children such as `<MenuItem disabled>No models available</MenuItem>`;
  - formatter return strings like `` `${diff}s ago` ``;
  - aria/title strings built with template literals.
- Recommended next scanner rules:
  - detect string literals passed as JSX expression values for `aria-label`, `title`, `placeholder`;
  - detect string literals inside JSX expression containers;
  - detect object fields named `label`, `description`, `title`, `placeholder`, `emptyText`, `ariaLabel`;
  - detect default parameter/user-visible prop fallbacks;
  - allowlist technical IDs, routes, schemas, provider names, model IDs, plugin manifest data, test fixtures, and user data.

### S2. Prefer typed key maps over dynamic translation keys where values come from domain enums

- The new code mostly uses explicit maps such as `priorityLabelKeys`, which is good.
- Keep this pattern for status/category/assignee/model state labels instead of constructing keys dynamically from server values.

### S3. Use locale-aware formatters through an i18n-owned helper

- Chronicle already moved relative time strings to `t(...)`, but `formatDateTime` still uses `new Date(time).toLocaleString()` without passing the active locale.
- Devtool panels pin `en-US` or hand-roll abbreviations.
- A small helper that accepts `i18n.language` would make date/time/relative output consistent and easier to review.

## Explicit Non-Issues / Not Reported

- Plugin-provided `panel.title`, `cmd.title`, plugin descriptions, capability labels, warnings, and permission labels are plugin/manifest data, not Cradle-owned copy.
- Model IDs, provider names, route segments, layer/status enum values, file paths, command names, HTTP errors, and API/schema field names are technical identifiers or server data.
- Test fixtures and `README.md` prose were not treated as UI l10n blockers.
- Brand/product names such as `Cradle`, `Jarvis`, `Codex`, `Claude Code`, `models.dev`, and `OpenAI-compatible` were not treated as translation bugs by themselves.

## Summary

- Blockers: 6
- Non-blockers: 3
- The most important fix is to restore locale completeness for `common` keys and then remove the remaining hardcoded copy from the composer model menu, Jarvis popover, chat view, Kanban assignee picker, and skills import modal.
