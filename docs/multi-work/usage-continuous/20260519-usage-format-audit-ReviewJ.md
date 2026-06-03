# ReviewJ: Usage Format Audit

Date: 2026-05-19
Scope: code review only for:

- `apps/web/src/features/usage/usage-dashboard.tsx`
- `apps/web/src/features/usage/usage-format.ts`
- `apps/web/src/features/usage/usage-format.test.ts`
- `apps/web/src/features/usage/README.md`

No source files were changed by this review. This handoff is the only artifact written.

## Direct Conclusion

Status: **Pass with one non-blocking QA gap**.

The formatting helper extraction preserves the existing dashboard behavior, the new helper/test files have English file headers, and the dashboard no longer uses the reviewed dynamic Tailwind `className` construction. The targeted usage-format Vitest file passes.

The only notable gap is test coverage around compact-format rounding rollover boundaries, where the current helper can display near-threshold values such as `999_950` as `1000.0K` instead of switching to `1.0M`. That is a display-policy edge, not a regression introduced by the extraction itself.

## Findings

### Low: compact token tests miss rounding rollover boundaries

- File: `apps/web/src/features/usage/usage-format.ts:5`
- Test file: `apps/web/src/features/usage/usage-format.test.ts:10`

`formatTokens` formats the suffix after choosing the threshold bucket. Because the `K` bucket uses one decimal place, values close to the next bucket can round up inside the old bucket:

```ts
formatTokens(999_950) // "1000.0K"
```

The current tests cover `999`, `1_000`, `12_340`, and `1_500_000`, but they do not cover the upper edge below `1_000_000`. If the intended product display is monotonic and compact at bucket boundaries, add cases such as `999_949`, `999_950`, `999_999`, and `1_000_000`, then decide whether the expected label should remain `1000.0K` or promote to `1.0M`.

Severity is low because this is an existing formatting policy edge and not a dashboard correctness failure.

## Acceptance Audit

- Format helper extraction: **Pass**.
  - `usage-dashboard.tsx` imports `formatTokens` and `formatUsd` from `./usage-format`.
  - The extracted helper body matches the previous local dashboard behavior.
  - Helper ownership is correctly scoped to the usage feature.

- Tests for key display boundaries: **Mostly pass, with the low gap above**.
  - Covered: zero token, raw token below `K`, exact `1_000`, representative `K`, representative `M`.
  - Covered: zero USD, tiny non-zero USD, exact `$0.01`, ordinary rounding.
  - Missing: upper rollover boundaries where `toFixed(1)` can produce `1000.0K`.

- Dynamic Tailwind className cleanup: **Pass**.
  - The reviewed conditional dashboard styles use `cn()` with static class strings.
  - A targeted search for template-literal or concatenated `className` patterns in the requested files found no matches.
  - Dynamic inline width styles for bar charts remain data-driven styles, not Tailwind class construction.

- AGENTS compliance: **Pass for the reviewed changes**.
  - New source/test files include English header comments.
  - Code comments, identifiers, and test text are English.
  - README inventory was updated for the new helper and test files.
  - Markdown README contains Chinese prose, which is allowed by the repo-level response/documentation convention.

- React/render/perf: **Pass**.
  - The helper extraction is pure and module-local.
  - The dashboard change does not add new state, effects, subscriptions, or render loops.
  - `cn()` calls are small conditional class merges on already-rendered components; no obvious render or bundle regression was found.

## Verification Performed

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/usage/usage-format.test.ts
```

Observed result:

- 1 test file passed.
- 2 tests passed.

I also inspected the scoped diff and ran a targeted static search for dynamic Tailwind-style `className` construction in the four requested files.

## Recommendation

No blocking fix is required before merging this batch.

For stronger QA, add a small table-driven `formatTokens` test for values immediately below and at `1_000_000`, then encode the intended product behavior explicitly. If the desired display is to avoid `1000.0K`, adjust `formatTokens` after the test expectation is chosen.
