# Frontend Runtime Autosave Rereview G

结论：我不是 100% confident。最近修复已经覆盖了一些显性 pending-provider 场景，但当前策略仍有跨 surface 的保存顺序、旧 query snapshot 合并、以及 pending selection 被异步结果误提交的漏洞。

## High

### 1. Chat session provider/model queue can drop in-flight session saves on navigation

证据：
- [chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:95) 在 `persistSessionProviderModel` 内把每次 patch 串到 `providerModelSaveQueueRef.current`。
- [chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:146) 的 `sessionId` effect 把 queue 重置为 `Promise.resolve()`，同时 revision `+1`。
- 旧 session 的 request 仍会继续完成；成功路径在 [chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:125) 只检查 revision 是否匹配，重置后旧 request 的 revision 不匹配，因此不会写回 query cache/list。失败路径也同样不会 rollback。

风险：
- 用户切换 session 前刚选 provider/model，HTTP patch 可能成功，但本地 cache/list 因 revision 被新 session 重置而不更新；如果后续没有 refetch，侧边栏和当前 session binding 可长期显示旧 provider/model。
- 更严重的是同一组 refs 被跨 session 复用，语义上把不同 session 的保存流混在一个 owner 里；当前逻辑靠 revision 偶然屏蔽旧响应，不能保证每个 session 的保存完成后有一致的本地状态。

建议修复：
- 把 provider/model save owner 按 `sessionId` 隔离，或在 `sessionId` 切换前保留旧 promise 的 cache/list reconcile。
- 成功响应应按 request 自带的 `targetSessionId` 写对应 query key/list，而不是依赖当前 active session refs。

验证：
- 在 session A 选择新 provider/model 后立即切到 session B，让 A 的 patch 延迟返回；确认 A 的 detail query 和 session list 最终更新到服务器返回值。
- 同时验证 A patch 失败时只回滚 A，不影响 B。

### 2. Agent detail autosave can regress provider/model/thinking after edits during an in-flight save

证据：
- 保存 payload 来自 `form.getValues()`，提交签名在 [agent-detail.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-detail.tsx:1320) 生成。
- 若保存过程中用户继续编辑，成功后只把状态标为 pending 并 `return`，见 [agent-detail.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-detail.tsx:1363)。
- autosave effect 在 `saveState === 'saving'` 时直接 return，见 [agent-detail.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-detail.tsx:1384)。保存完成后虽然 state 变 pending，但 `isDirty` 可能仍为 true 且 effect 会重新跑；这依赖 React Hook Form dirty 状态没有被其他 reset/invalidated agent data 干扰。
- `updateAgent` 成功只 invalidate agents query，见 [use-agents.ts](/Users/wibus/dev/Cradle/apps/web/src/features/agent-runtime/use-agents.ts:84)。而 owner 在 [agent-detail.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/agent-management/agent-detail.tsx:1258) 对 `agent` 或 `providerOptions` 变化执行 `form.reset(getAgentDetailFormValues(...))`。

风险：
- 第一次保存成功后 query invalidation 可能把旧提交响应投回 `agent` prop，并触发 form reset，覆盖用户在 in-flight 期间的 provider/model/thinking 后续编辑。
- 当前“保存中编辑 -> pending -> 再保存”的策略没有显式队列，也没有保存 revision，容易被 invalidate/reset 时序打断。

建议修复：
- Agent detail autosave 使用单独 save queue/revision；成功后仅当提交签名仍等于当前 form 签名才 reset。
- 当 form dirty 时，外部 `agent` query 刷新不应 reset 表单；只在 agent id 变化或 pristine 时同步服务器数据。

验证：
- 延迟 `patchAgentsById`：选择 provider A/model A，autosave 开始后立刻选择 provider B/model B/thinking low；确认最终 form、agents query、后端均为 B/low。

## Medium

### 3. Jarvis and Chronicle config saves merge from stale query data and are not scoped/queued

证据：
- Jarvis mutation 每次从 query cache 读 `current` 后 shallow merge updates，见 [use-jarvis-preferences.ts](/Users/wibus/dev/Cradle/apps/web/src/features/system-agent/use-jarvis-preferences.ts:27)。
- Chronicle mutation 同样从 query cache 读 `current` 后 shallow merge updates，见 [use-chronicle.ts](/Users/wibus/dev/Cradle/apps/web/src/features/chronicle/use-chronicle.ts:989)。
- Jarvis UI 可以发多种 partial saves：runtime/provider/model at [jarvis-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/jarvis-settings.tsx:156)，model at [jarvis-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/jarvis-settings.tsx:197)，thinking at [jarvis-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/jarvis-settings.tsx:207)。
- Chronicle switches and model picker all call `onUpdateConfig` partial saves, e.g. [chronicle-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chronicle/chronicle-settings.tsx:916) and [chronicle-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chronicle/chronicle-settings.tsx:1005)。

风险：
- 如果 two mutations overlap, later user action can build `next` from old cache before earlier mutation updates it. Last response can overwrite unrelated fields with stale values.
- `disabled={saving}` reduces but does not eliminate this because React state updates are not synchronous, keyboard/menu events can be queued, and effects can also call saves.

建议修复：
- Add mutation `scope` for Jarvis and Chronicle config, or centralize updates in a queued updater that merges against the latest locally optimistic draft.
- Optimistically update cache before awaiting PUT, or use a local draft owner for settings panels.

验证：
- Fire Chronicle `enabled` toggle and provider/model save with delayed network responses in reversed order; final config must include both changes.
- Fire Jarvis model change and thinking change back-to-back; final preferences must keep selected model and thinking.

### 4. Pending provider selection effects can commit an older provider after a newer click is suppressed by saving

证据：
- Title generation stores a single `pendingProviderTargetId` and later saves first model when models load, see [chat-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/chat-settings.tsx:360)。
- Jarvis stores `pendingSelection` and later saves when models load, see [jarvis-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/jarvis-settings.tsx:88)。
- Chronicle stores `pendingProfileId` and later saves when models load, see [chronicle-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chronicle/chronicle-settings.tsx:889)。
- The picker is disabled during saving in those panels, e.g. [chat-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/chat-settings.tsx:395), [jarvis-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/settings/jarvis-settings.tsx:186), [chronicle-settings.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chronicle/chronicle-settings.tsx:1003)。

风险：
- User selects provider A with unloaded models, then tries to select B while save/loading transitions are active. If B action is blocked or not persisted, A's async model load can still commit A as soon as models arrive.
- This is especially visible when provider list/model list loading is slow: UI displays pending selection, but no user-confirmed latest-selection token is checked before committing.

建议修复：
- Track a monotonically increasing selection token per pending provider. Commit only if token still matches the latest user intent.
- Do not use global `saving` as the only guard; keep a local selectable draft even while a previous save is in flight.

验证：
- Delay model fetch for provider A, select A, immediately select B, then let A resolve last. Final preferences/config must be B, never A.

## Low

### 5. Chat send overrides intentionally omit pending provider, but that can surprise users during model loading

证据：
- `sendOverridesRef` suppresses `providerTargetId` when the selected provider is pending and no model is resolved, see [chat-runtime-view.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/chat/chat-runtime-view.tsx:84)。
- Send reads the ref immediately before submit, see [use-chat-composer-runtime.ts](/Users/wibus/dev/Cradle/apps/web/src/features/chat/use-chat-composer-runtime.ts:223)。

风险：
- If the user changes provider and sends before models load, message goes with the old session binding/default rather than the visible pending provider. This avoids invalid provider/model pairs, but it is a behavior regression risk unless the UI clearly blocks send or indicates pending model resolution.

建议修复：
- Disable send while `pendingProviderTargetId` is active, or surface the pending state in the composer.

验证：
- Select unloaded provider, send immediately, inspect `startChatResponse` body and user-visible toolbar state.

### 6. Automation create draft auto-selects first model without explicit pending selection state

证据：
- `selectedModelId` falls back to `models[0]?.id` for display, see [automation-dashboard.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/automation/automation-dashboard.tsx:688)。
- A later effect writes first model into draft when models arrive, see [automation-dashboard.tsx](/Users/wibus/dev/Cradle/apps/web/src/features/automation/automation-dashboard.tsx:717)。

风险：
- This is create-only and local, so no autosave loss. But display state and draft state can briefly diverge; if validation/save logic changes later, this can become another stale model source.

建议修复：
- Keep explicit pending provider/model draft state, or only display `draft.modelId` until the effect commits it.

验证：
- Create automation with slow model fetch; confirm save remains disabled until draft has an actual model.

