# Review Round 1: i18n Runtime And Workflow

Reviewer: ReviewA
Date: 2026-05-25
Scope:

- `docs/draft-solutions/i18n.md`
- `apps/web/src/i18n/**`
- `apps/web/src/locales/**`
- `apps/web/scripts/i18n-workflow/**`
- `apps/web/package.json`
- `apps/web/src/main.tsx`
- i18n runtime / wiring README updates

## Verdict

当前实现大体符合 `docs/draft-solutions/i18n.md` 的核心方向：默认文案以 `src/locales/default/*.ts` 为 source of truth，`en-US` JSON 作为 baseline，runtime 使用 provider-scoped i18next instance，`keySeparator: false` 已设置，locale JSON 校验覆盖 missing / extra / non-string / placeholder / tag / plural mismatch。

但还有 1 个 blocker：浏览器端 locale resolution 会让 unsupported cookie 压过 browser language，并且不会修正 cookie。这会破坏 spec 要求的 resolution priority 与 cookie/html/i18next 收敛语义。

只读验证：

- `en-US` baseline drift：未发现 drift。
- `collectCheckReport()` summary：`missingKeys: 0`, `extraKeys: 0`, `invalidEntries: 0`。
- 未运行会写入 report timestamp 的 workflow 命令。

## Blockers

### B1. Unsupported cookie blocks browser language fallback and remains stale

Evidence:

- `apps/web/src/i18n/browser-locale.ts:47` reads `?hl`.
- `apps/web/src/i18n/browser-locale.ts:48` reads `cradle-locale`.
- `apps/web/src/i18n/browser-locale.ts:49` resolves browser languages.
- `apps/web/src/i18n/browser-locale.ts:51` resolves with `normalizeLocale(queryLocale ?? cookieLocale ?? browserLocale ?? DEFAULT_LOCALE)`.
- `apps/web/src/i18n/browser-locale.ts:53` only rewrites cookie when `queryLocale || !cookieLocale`.

Risk:

If `document.cookie` contains `cradle-locale=fr-FR` and `navigator.languages` is `['zh-CN']`, current code chooses the cookie branch, normalizes `fr-FR` to `en-US`, applies `html lang="en-US"`, initializes i18next with `en-US`, and does not rewrite the stale cookie because `cookieLocale` exists.

This violates the intended priority of supported locale sources: `?hl` first, then valid cookie, then browser language/default. It also leaves cookie/html/i18next convergence dependent on a stale unsupported cookie forever.

Required fix:

- Treat query and cookie candidates as usable only when they normalize to a supported explicit match, not when they merely normalize unknown input to default.
- If a cookie is present but unsupported, either clear it or overwrite it with the resolved supported locale.
- Add tests for:
  - `?hl=zh-CN` overrides `cradle-locale=en-US`.
  - valid cookie overrides browser language.
  - unsupported cookie falls through to browser language and is rewritten.
  - unsupported query writes only a supported normalized locale.

## Non-Blockers

### N1. Baseline drift gate is not encoded as a package script

Evidence:

- `apps/web/package.json:12` defines `i18n` as `diff -> gen-default` via `apps/web/scripts/i18n-workflow/index.ts`.
- `apps/web/package.json:15` defines `i18n:check` as `check-translations.ts`.
- `apps/web/scripts/i18n-workflow/check-translations.ts:7` only collects locale parity and format errors.
- `docs/draft-solutions/i18n.md` requires CI to block baseline drift and recommends `i18n:gen-default` plus `git diff --exit-code`.

Risk:

The implementation can satisfy this if CI explicitly runs `i18n:gen-default` and a `git diff` check, but there is no package-level script that captures that invariant. Developers running only `pnpm --filter @cradle/web i18n:check` will not catch `src/locales/default` to `src/locales/en-US` drift.

Recommendation:

Add a named script such as `i18n:check-baseline` or `i18n:ci` that runs generation plus a diff check, then document it in `src/i18n/README.md`.

### N2. New workflow directory has no README coverage

Evidence:

- `apps/web/scripts/i18n-workflow/**` is a new workflow surface.
- `apps/web/src/i18n/README.md` and `apps/web/src/locales/README.md` were added.
- No `README.md` exists under `apps/web/scripts` or `apps/web/scripts/i18n-workflow`.

Risk:

This misses the repository documentation convention for modified directories and leaves workflow ownership, command ordering, report policy, and mutation semantics discoverable only from script source and the draft solution.

Recommendation:

Add `apps/web/scripts/i18n-workflow/README.md` covering command responsibilities, default working directory, mutation behavior, and report-file policy.

### N3. Generated report files have ambiguous version-control policy

Evidence:

- `apps/web/i18n-missing-report.json`, `apps/web/i18n-unused-keys-report.json`, and `apps/web/i18n-hardcoded-report.json` are currently untracked.
- Scripts write timestamped reports to `apps/web`.
- The spec lists report files as workflow artifacts and translation-agent handoff inputs.

Risk:

Tracking timestamped reports creates churn. Not tracking them means translation agents cannot rely on repository state unless the report is regenerated in the same handoff. The current implementation does not document either policy.

Recommendation:

Do not treat timestamped reports as stable source artifacts. Prefer generating them in CI / review handoff, adding them to `.gitignore`, and committing only curated handoff markdown. If reports must be committed for translation agents, remove volatile timestamps or explicitly scope commits to translation handoff rounds.

### N4. Hardcoded text gate is useful but incomplete for architecture constraints

Evidence:

- `apps/web/scripts/i18n-workflow/check-hardcoded-text.ts` scans JSX text and literal `aria-label`, `title`, `placeholder`.
- It does not check general string literals used as user-facing text, `defaultValue` passed to `t`, dynamic `t(dynamicKey)` without protected patterns, or hand-written date/relative-time helpers.

Risk:

This is acceptable as a first gate, but it does not fully enforce spec anti-patterns. For example, hardcoded formatter strings and some dynamic-key risks still need code review or additional static checks.

Recommendation:

Keep this as a non-blocking gate, then add targeted checks for `defaultValue` in translation calls, dynamic `t()` keys outside protected patterns, and user-facing formatter helpers over time.

## Suggestions

### S1. Add direct bootstrap tests for `resolveInitialLocale`

The current tests cover `normalizeLocale`, `resolveAcceptLanguage`, and `switchLang`, but not browser bootstrap ordering. Add a jsdom test around `resolveInitialLocale()` with controlled `window.location`, `document.cookie`, and `navigator.languages`.

### S2. Clarify `localeOptions` ownership

`apps/web/src/i18n/options.ts` currently exposes only `{ value }`, while labels live in the `settings` namespace through `LOCALE_LABEL_KEYS`. This is reasonable because language names are UI copy, but it should be documented as a deliberate Cradle adaptation from the spec sample where `localeOptions` includes labels.

### S3. Add workflow fixture tests for `gen-diff` and `init-locale`

`validateNamespace` has useful fixture coverage. The mutation commands are more fragile because they depend on order and preservation semantics. Add temp-directory tests for:

- `gen-diff` deletes stale non-default translations when default English value changes.
- `init-locale` creates missing namespace files and preserves existing translations.
- `analyze-unused` respects `protectedKeyPatterns`.

## Positive Findings

- `apps/web/src/i18n/settings.ts:15` correctly sets `keySeparator: false`.
- `apps/web/src/i18n/settings.ts:12` sets `fallbackLng` to `DEFAULT_LOCALE`.
- `apps/web/src/i18n/client.tsx:28` creates provider-scoped i18next instances instead of a module singleton.
- `apps/web/src/i18n/client.tsx:99` to `apps/web/src/i18n/client.tsx:103` switches i18next, cookie, and HTML attributes together.
- `apps/web/scripts/i18n-workflow/utils.ts:151` to `apps/web/scripts/i18n-workflow/utils.ts:255` validates missing keys, extra keys, non-string values, placeholders, tags, and plural families.
- New TypeScript files in the reviewed i18n surfaces include header comments.
