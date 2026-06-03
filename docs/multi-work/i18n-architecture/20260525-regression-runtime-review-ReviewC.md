# ReviewC: i18n Regression / Runtime Review

## Verdict

Fail.

Round 2 的主要 runtime 与资源一致性问题已经修复：locale bootstrap 会跳过不支持的 cookie、语言切换会同步 i18next/cookie/html attributes，默认与生成 JSON locale 资源一致，硬编码扫描与目标 i18n 测试通过。

但当前实现仍有 1 个 blocker：Agent Management 的 thinking key map 仍被拓宽为 `string`，导致 i18next typed key safety 在真实调用点失效，并且 `tsc` 已经给出明确的 i18n 类型错误。这不是已知的 `api-gen`、Node typings 或 `streamdown` 缺依赖噪音。

## Findings

### B1. Agent Management thinking key maps lose typed i18next safety

- Severity: blocker
- Files:
  - `apps/web/src/features/agent-management/agent-detail.tsx:105`
  - `apps/web/src/features/agent-management/agent-detail.tsx:412`
  - `apps/web/src/features/agent-management/agent-list.tsx:64`
  - `apps/web/src/features/agent-management/agent-list.tsx:269`

Impact:

这些 key map 以 `Record<..., string>` 声明，`thinkingLabelKeys[value]` / `thinkingDescriptionKeys[value]` 在传给 `t(...)` 时变成普通 `string`。这绕开了本轮 i18next typed key 目标：typo 不再由 compiler 捕获，并且 typed `t` 当前已经拒绝这些调用。若后续有人改错 key，风险是运行时显示 raw i18n key 或 fallback 行为，而不是编译期失败。

Evidence:

- `agent-detail.tsx:105` 到 `agent-detail.tsx:117` 将 `thinkingLabelKeys` / `thinkingDescriptionKeys` 声明为 `Record<ThinkingEffort, string>`。
- `agent-detail.tsx:412` 到 `agent-detail.tsx:413` 调用 `t(thinkingLabelKeys[value])` 和 `t(thinkingDescriptionKeys[value])`。
- `agent-list.tsx:64` 到 `agent-list.tsx:76` 对 batch thinking key map 使用同样的 `Record<AgentBatchThinkingEffort, string>`。
- `agent-list.tsx:269` 到 `agent-list.tsx:270` 调用同样的 widened string key。
- `pnpm --filter @cradle/web exec tsc --noEmit --pretty false` 明确报出这些位置的 `TS2345: Argument of type '[string]' is not assignable...`，不同于已知缺失 `~/api-gen/*`、Node typings、`streamdown` 依赖错误。

Suggested fix:

使用和 composer/settings 修复相同的 typed key map 模式，不要让 key 拓宽为 `string`。例如在 `agent-detail.tsx` 和 `agent-list.tsx` 中引入 namespace key 类型：

```typescript
type AgentManagementKey = keyof typeof import('~/locales/default').default.agentManagement

const thinkingLabelKeys = {
  auto: 'detail.thinking.auto.label',
  low: 'detail.thinking.low.label',
  medium: 'detail.thinking.medium.label',
  high: 'detail.thinking.high.label',
} satisfies Record<ThinkingEffort, AgentManagementKey>
```

同样处理 description map 和 batch map。修复后再跑 filtered `tsc`，确认这些 `t(...)` 错误消失，只剩已知环境 blocker。

### N1. ProviderModelPicker still has English default labels

- Severity: non-blocker
- File: `apps/web/src/features/composer-toolbar/provider-model-picker.tsx:51`

Impact:

`ProviderModelPicker` 的默认参数仍包含 user-facing 英文文案：`loadingLabel = 'Loading…'` 和 `emptySelectionLabel = 'Model'`。`modelLabel` 在 `provider-model-picker.tsx:84` 使用 `emptySelectionLabel ?? t('model.emptySelection')`，但默认值已经是非空字符串，所以 `t('model.emptySelection')` 默认不可达。Composer toolbar 没有传入 `emptySelectionLabel`，非英语 locale 下仍可能看到英文 `Model`；loading 分支也会显示英文 `Loading…`。

Evidence:

- `provider-model-picker.tsx:51` 到 `provider-model-picker.tsx:52` 定义 raw default labels。
- `provider-model-picker.tsx:84` fallback 使用这些 default labels。
- `provider-model-selector.tsx:70` 到 `provider-model-selector.tsx:81` 调用 composer picker 时没有传入 `loadingLabel` 或 `emptySelectionLabel`。

Suggested fix:

把 props default 改为 `undefined`，在 render 内用 `t('status.loading')` 和 `t('model.emptySelection')` 作为默认值；保留 props override 供 settings/Jarvis 传 feature-owned copy。

## Commands Run

- `git branch --show-current && git status --short`
  - Result: branch is `feature/i18n-architecture`; review stayed in `/Users/wibus/dev/Cradle-i18n-architecture`.
- `git diff --stat`
  - Result: reviewed the i18n/web touched surface; no production code was edited.
- `pnpm --filter @cradle/web i18n:check`
  - Result: passed.
- `pnpm --filter @cradle/web i18n:check-hardcoded`
  - Result: passed.
- `pnpm --filter @cradle/web i18n:check-baseline`
  - Result: passed.
- `pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/i18n src/features/settings/settings-overlay-store.test.ts`
  - Result: passed, 5 files / 15 tests.
- `pnpm --filter @cradle/web exec tsc --noEmit --pretty false`
  - Result: failed. Expected blockers are present for `~/api-gen/*`, Node typings, and `streamdown` deps. New i18n-relevant typed key errors are also present at `agent-detail.tsx:412`, `agent-detail.tsx:413`, `agent-list.tsx:269`, and `agent-list.tsx:270`.
- `npx -y react-doctor@latest . --verbose --diff`
  - Result: failed with known crash: `Cannot read properties of undefined (reading 'length')`.
- `git diff --check`
  - Result: passed.

## Residual Risks

- The hardcoded-text scanner still cannot prove absence of all expression/fallback strings; targeted grep found the `ProviderModelPicker` default-label gap above.
- Full typecheck remains noisy until generated API files, Node typings, and `streamdown` deps are available, so i18n type regressions must be separated from those known blockers.
- Runtime language switching tests cover provider switching and browser bootstrap ordering, but not an end-to-end rendered app screenshot across locales.
