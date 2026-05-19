<!--
Input: Current usage formatting diff after ReviewJ QA gap fix, usage dashboard className cleanup, and usage format tests.
Output: Independent ReviewK rereview handoff for the usage formatting rollover fix.
Position: Multi-work rereview artifact for the usage-continuous stream.
-->

# ReviewK: Usage Format Rereview

Date: 2026-05-19
Scope: code review only for:

- `apps/web/src/features/usage/usage-dashboard.tsx`
- `apps/web/src/features/usage/usage-format.ts`
- `apps/web/src/features/usage/usage-format.test.ts`
- `apps/web/src/features/usage/README.md`

No source files were changed by this rereview. This handoff is the only artifact written.

## Direct Conclusion

Status: **Pass**.

The ReviewJ QA gap is addressed. `formatTokens` now promotes values whose one-decimal `K` label would round to `1000.0K` into the `M` bucket, so `999_950` and nearby upper-bound values display as `1.0M` instead of `1000.0K`.

The new regression test covers both sides of the rollover boundary:

- `999_949` -> `999.9K`
- `999_950` -> `1.0M`

Dashboard conditional classes still use `cn()` with static Tailwind class strings, and the targeted static search found no dynamic Tailwind `className` construction in the reviewed files.

## Rollover Fix Audit

- File: `apps/web/src/features/usage/usage-format.ts:5`

The implementation keeps the simple threshold structure:

- Values `>= 1_000_000` format directly as `M`.
- Values `>= 1_000` first compute the `K` value.
- If the rounded one-decimal `K` value reaches `1000`, the function formats the original value as `M`.

This is reasonable for the existing display policy because the rendered precision is one decimal place. It avoids showing an impossible-looking `1000.0K` label while preserving the lower-side value `999_949` as `999.9K`.

Manual boundary check:

```text
999      -> 999
1_000    -> 1.0K
12_340   -> 12.3K
999_949  -> 999.9K
999_950  -> 1.0M
999_999  -> 1.0M
1_000_000 -> 1.0M
1_500_000 -> 1.5M
```

## Test Coverage Audit

- File: `apps/web/src/features/usage/usage-format.test.ts:10`

The previous missing rollover boundary is now covered by assertions for `999_949` and `999_950`. That is enough to prevent the exact regression called out in ReviewJ.

Optional future hardening: add explicit expectations for `999_999` and `1_000_000` if the team wants a fuller table of bucket edges. This is not blocking because the current test already proves the lower and promoted sides of the one-decimal rollover threshold.

## Dashboard Static Tailwind Audit

- File: `apps/web/src/features/usage/usage-dashboard.tsx:188`
- File: `apps/web/src/features/usage/usage-dashboard.tsx:267`

The reviewed dashboard changes remain compliant:

- Conditional total-token text sizing uses `cn()` with static class strings.
- `Pill` container and value color variants use `cn()` with static class strings.
- A targeted search for template-literal or concatenated dynamic Tailwind `className` construction in the reviewed files found no matches.
- Inline bar widths remain data-driven `style` values, not Tailwind class generation.

## Verification Performed

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/usage/usage-format.test.ts
```

Observed result:

- 1 test file passed.
- 2 tests passed.

Static className search:

```sh
rg -n 'className=\{`|className=\{[^\n}]*\+|text-\$\{|bg-\$\{|border-\$\{' apps/web/src/features/usage/usage-dashboard.tsx apps/web/src/features/usage/usage-format.ts apps/web/src/features/usage/usage-format.test.ts apps/web/src/features/usage/README.md
```

Observed result:

- No matches.

## Final Assessment

Pass. The rollover display behavior is reasonable, the specific ReviewJ test gap is closed, and the dashboard Tailwind cleanup remains compliant.
