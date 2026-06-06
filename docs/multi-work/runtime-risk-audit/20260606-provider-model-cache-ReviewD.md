# Provider/model async cache selection ReviewD

审查范围：当前 worktree 中的 provider/model 选择路径，重点检查冷缓存时是否仍会把 `modelId: null`、旧 `modelId`、缺失 `model`，或不兼容的 `thinkingEffort` 持久化。

结论：我不能 100% confident。`chat-settings` 的 title generation 和 `agent-detail` 主 picker 已经有 pending/backfill 语义，冷缓存下不会立即写入 null model；但 chat session、Chronicle、agent batch、automation、Jarvis 仍存在同步读冷缓存后提前持久化 provider-only、旧 model、null model 或 stale thinking 的窗口。

## Findings

### High: chat session provider 切换会在冷缓存时持久化 provider-only，并保留旧 model

证据：

- `ProviderTargetGroup` 在点击 provider 行时先触发 `onRequestProviderTargetModels`，随后立即触发 `onSelectProviderTarget`，没有等待 query success：`apps/web/src/features/composer-toolbar/provider-model-menu.tsx:188-194`。
- `useProviderTargetModelMap` 的 `requestProviderTargetModels` 只把 id 加进 requested set；本轮 render 的 `modelsByProviderTargetId` 仍为空：`apps/web/src/features/agent-runtime/use-agent-models.ts:280-299`。
- `ProviderModelSelector` 在冷缓存时只调用 `onSelectProfile(id)`，不会选择模型，也不会修正 thinking：`apps/web/src/features/composer-toolbar/provider-model-selector.tsx:83-89`。
- `ChatRuntimeView` 覆盖 `setProfileId` 后同步读取 `composerState.modelsByProfileId[id]`，冷缓存时只 PATCH `{ providerTargetId: id }`：`apps/web/src/features/chat/chat-runtime-view.tsx:120-128`。
- `useComposerState` 的 `setProfileId` 会重置手动 model，但 chat context 的 `modelId` resolution 会在 `boundModelId` 不在当前 models 时仍返回 `boundModelId`：`apps/web/src/features/composer-toolbar/use-composer-state.ts:238-247` 和 `apps/web/src/features/composer-toolbar/use-composer-state.ts:195-201`。

影响：

- session 可能被持久化为新 `providerTargetId` + 旧 `modelId`，或者 provider-only patch 后让服务端继续保留旧 model preference。
- `sendOverridesRef` 后续可能携带新 provider + 旧 model，冷缓存加载后也没有一个 effect 把 session patch 成 provider + first model 的原子状态。
- thinking 在 provider 点击时也只在缓存命中时才按第一模型修正；冷缓存路径会沿用旧 thinking，直到 effective model resolve 时仅本地派生，不会持久化 session model。

建议修复：

- 在 chat session 层引入 pending provider selection：冷缓存时只更新本地 pending UI，不 PATCH session；等目标 provider models query success 后一次性调用 `persistSessionProviderModel({ providerTargetId, modelId: firstModel.id })`，并按该 model 推导 thinking。
- 或者把 `ProviderModelPicker` 的 provider selection contract 改为异步 resolved selection：caller 只接收已经解析过的 `{ providerTargetId, modelId, model }`，明确禁止冷缓存 provider-only selection。
- chat session 持久化必须保持 provider/model 原子性；只有 explicit model clearing 场景才允许 `modelId: null`。

建议验证：

```bash
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/chat/chat-runtime-view.test.tsx
pnpm typecheck:apps-web
```

测试应 mock delayed model cache：点击 chat toolbar 中的新 provider 后，断言 `patchSessionsById` 在 models 未返回前不调用；models 返回后只调用一次，body 同时包含新 `providerTargetId` 和 first `modelId`，且不会发送旧 model。

### High: Chronicle provider 选择冷缓存时会保存新 profile + 旧或空 model，且没有 backfill

证据：

- Chronicle 只根据 `config.profileId` 请求初始 models，没有 pending profile state：`apps/web/src/features/chronicle/chronicle-settings.tsx:304-309`。
- `canEnable` 依赖 `config.profileId && config.modelId`，如果旧 model 保留，则新 profile + 旧 model 仍可能被视为可启用：`apps/web/src/features/chronicle/chronicle-settings.tsx:323-324`。
- provider selection 冷缓存时执行 `onUpdateConfig({ profileId })`，没有清空旧 `modelId`，也没有等待 first model：`apps/web/src/features/chronicle/chronicle-settings.tsx:981-988`。
- `useChronicleConfig.updateConfig` 会把 patch 与当前 config shallow merge 后 `putChronicleConfig`，因此 `{ profileId }` 会保留当前 `modelId`：`apps/web/src/features/chronicle/use-chronicle.ts:989-997`。
- 本文件未发现 `profileId && !modelId && models.length > 0` 的 backfill effect。

影响：

- 从 provider A/model A 切到 provider B 时，如果 provider B models 尚未加载，Chronicle 会先持久化 provider B + model A。
- 如果当前没有 model，则会持久化 provider-only config，且没有后续 effect 自动补 first model。
- 这条路径直接影响 Chronicle capture enablement 和服务端 model context resolution。

建议修复：

- Chronicle model picker 应采用与 `TitleGenerationSettings` 类似的 `pendingProviderTargetId`，冷缓存时不写 config。
- models 返回后一次性保存 `{ profileId, modelId: firstModel.id }`。
- 如果 provider 无可用模型，应保留旧 config 或显式进入 invalid local pending state，不要持久化新 provider + 旧 model。

建议验证：

```bash
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/chronicle/chronicle-settings.test.tsx
pnpm typecheck:apps-web
```

测试应覆盖从已配置 provider/model 切到冷缓存 provider：断言 `putChronicleConfig` 不会收到新 `profileId` + 旧 `modelId`，最终保存体必须包含新 provider 的 first model。

### Medium: agent batch provider apply 可在 backfill 前写入 `modelId: null`

证据：

- batch provider 选择冷缓存时同步读空 `modelsByProviderTargetId`，生成 `selectionOverride.modelId: null`，thinking 沿用旧值：`apps/web/src/features/agent-management/agent-list.tsx:342-354`。
- backfill effect 会在 models 到达后补 first model：`apps/web/src/features/agent-management/agent-list.tsx:371-381`。
- 但 Apply 按钮只判断 `busy || !selection || providerAgents.length === 0`，不等待 selected models loading，也不要求 `selection.modelId` 非空：`apps/web/src/features/agent-management/agent-list.tsx:433-440`。
- `buildAgentProviderBatchPatches` 会把 `selection.modelId` 原样写入 patch：`apps/web/src/features/agent-management/agent-batch-configuration.ts:35-48`。
- 现有测试甚至显式允许 provider-backed batch selection 的 `modelId: null`：`apps/web/src/features/agent-management/agent-batch-configuration.test.ts:79-83`。

影响：

- 用户点击 provider 后立即点击 Apply，会把多个 provider-backed agents 批量写成新 provider + `modelId: null`。
- thinking 在 cold cache path 中沿用旧 selection，可能与 first model 的 supported thinking 不兼容。

建议修复：

- provider-backed batch apply 前必须有 resolved model；`selection.modelId === null` 且 selected provider models 正在加载时禁用 Apply。
- `buildAgentProviderBatchPatches` 的 contract 应该拒绝 provider-backed null model，除非新增明确的 “clear model” action。
- backfill effect 成功后再启用 Apply，并用 first model 重新计算 thinking。

建议验证：

```bash
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/agent-management/agent-batch-configuration.test.ts
pnpm typecheck:apps-web
```

建议补 UI 或 helper 测试：冷缓存 selection 不应产生可提交 patch；models 到达后 patch 包含 first model 和兼容 thinking。

### Medium: automation create draft 可在模型回填前提交 provider + no model/no thinking

证据：

- automation provider selection 冷缓存时写入 draft `{ providerTargetId, modelId: null, thinkingEffort: draft.thinkingEffort }`：`apps/web/src/features/automation/automation-dashboard.tsx:742-752`。
- backfill effect 会在 `draft.modelId === null && models.length > 0` 时补 first model：`apps/web/src/features/automation/automation-dashboard.tsx:712-722`。
- 但 create input 会把 `draft.modelId ?? undefined` 和 `draft.thinkingEffort ?? undefined` 直接发送：`apps/web/src/features/automation/automation-dashboard.tsx:194-197`。
- `saveDraft` 没有等待 selected provider models resolved：`apps/web/src/features/automation/automation-dashboard.tsx:1015-1022`。

影响：

- 用户切 provider 后立即创建 automation，会得到 provider target 已设置、但 recipe 没有 model override 和 thinking override 的 automation。
- 如果旧 `draft.thinkingEffort` 被保留，可能对新 provider first model 不兼容。

建议修复：

- create button 应在 selected provider models loading 或 pending first model 时禁用。
- 更干净的做法是为 automation runtime section 引入 pending provider state：冷缓存不写 draft；models 到达后一次性写 provider/model/thinking。

建议验证：

```bash
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/automation/automation-dashboard.test.tsx
pnpm typecheck:apps-web
```

测试应覆盖 delayed model cache：选择 provider 后立即 create 不应调用 create mutation，或最终 create body 必须包含 first model 和 compatible thinking。

### Medium: Jarvis settings 是两阶段持久化，冷缓存窗口仍可落盘 provider-only

证据：

- Jarvis provider selection 冷缓存时立即 `save({ profileId, model: undefined })`：`apps/web/src/features/settings/jarvis-settings.tsx:156-163`。
- runtime 切换也会保存 `profileId: nextProfile?.id ?? null, model: undefined`，随后才 request models：`apps/web/src/features/settings/jarvis-settings.tsx:114-129`。
- 有 backfill effect：当 `prefs.profileId && !prefs.model && selectedModels.length > 0 && !saving` 时保存 first model 和 thinking：`apps/web/src/features/settings/jarvis-settings.tsx:87-93`。
- `useJarvisPreferences` mutation 是 shallow merge + full PUT：`apps/web/src/features/system-agent/use-jarvis-preferences.ts:27-37`。

影响：

- 虽然最终通常会回填，但在保存失败、页面关闭、并发 mutation、或 `saving` 长时间为 true 时，会留下 provider-only preferences。
- `jarvis-popover` 只检查 `prefs.profileId` 即可创建系统 agent turn，因此 provider-only window 可能进入运行时，而不是纯 UI 短暂状态。

建议修复：

- Jarvis 应与 title generation 一样，把冷缓存 provider 选择保存在 local pending state，不立即 PUT。
- models resolve 后一次性保存 `{ profileId, model: firstModel.id, thinkingLevel }`。
- runtime 切换如果自动选择 next profile，也应等待该 profile 的 first model 后原子保存；无模型时保持旧配置或进入 explicit invalid state。

建议验证：

```bash
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/settings/jarvis-settings.test.tsx src/features/system-agent/use-jarvis-preferences.test.ts
pnpm typecheck:apps-web
```

测试应断言冷缓存 provider/runtimes selection 不会先 PUT `model: undefined`；models 到达后 PUT 包含 model 和 compatible thinking。

## Paths that look fixed in this worktree

### Chat title generation settings

- `TitleGenerationSettings` 使用 `pendingProviderTargetId`，冷缓存 provider selection 只设置 pending，不保存 null model：`apps/web/src/features/settings/chat-settings.tsx:311-343` 和 `apps/web/src/features/settings/chat-settings.tsx:376-385`。
- models 到达后保存 `{ providerTargetId, modelId: firstModel.id }`：`apps/web/src/features/settings/chat-settings.tsx:330-342`。
- 这条路径仍受独立的 chat preferences mutation race 影响，但就 provider/model cold cache selection 而言，当前实现不再直接持久化 null model。

### Agent detail main provider/model picker

- `AgentProviderModelPicker` 使用 `pendingProviderTargetId`；冷缓存 provider selection 只设置 pending，不改 form value：`apps/web/src/features/agent-management/agent-detail.tsx:462-497` 和 `apps/web/src/features/agent-management/agent-detail.tsx:526-531`。
- backfill 时先写 provider，再写 first model 和 thinking；autosave body 来自 form values：`apps/web/src/features/agent-management/agent-detail.tsx:483-489`、`apps/web/src/features/agent-management/agent-detail.tsx:1353-1363`、`apps/web/src/features/agent-management/agent-detail.tsx:1418-1426`。
- 这条路径看起来已避开冷缓存下的立即 null model 持久化。

## Recommended overall fix strategy

1. 把 provider selection 分成两种语义：`resolved selection` 和 `pending provider`。只有 resolved selection 可以持久化。
2. `ProviderModelPicker` 或 caller 应统一返回 `{ providerTargetId, modelId, model, thinking }`，而不是让每个 caller 在 `request...Models()` 后同步读 cache。
3. 对所有 provider-backed persisted configs 建立 invariant：provider/model 必须原子更新；除显式清空动作外，不写 provider-only、不写 `modelId: null`。
4. Apply/Create/Enable 这类提交按钮必须在 pending provider model resolution 期间禁用，或者提交前重新从 resolved model state 读取。

## Suggested verification gate

```bash
pnpm typecheck:apps-web
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/agent-management/agent-batch-configuration.test.ts
```

如果落地修复涉及新增组件测试，建议再跑对应新增文件。最低覆盖点：chat session provider switch、Chronicle provider switch、agent batch apply、automation create、Jarvis provider/runtime switch 的 delayed model cache 场景。
