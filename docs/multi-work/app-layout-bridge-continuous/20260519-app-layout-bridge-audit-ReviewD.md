# App Layout Browser Bridge Audit - ReviewD

## Finding

`react-doctor` 在 `apps/web/src/components/layout/app-layout.tsx` 的 Electron browser-use bridge 附近给出的 `no-cascading-set-state` 告警，按当前实现判断更接近一个已处理的低风险 DX hygiene 项，而不是仍然存在的实质级联渲染问题。

当前工作树里，bridge 逻辑已经被提取到组件外的 `installBrowserUseBridge(openBrowserPanel)`。`AppLayoutContent` 的 `useEffect` 只在 Electron 环境下安装 bridge：

```ts
return installBrowserUseBridge(() => setBrowserPanelOpen(true))
```

实际状态更新发生在 Electron IPC 或全局 bridge 函数被调用时，而不是 effect 安装期间同步触发。`setBrowserPanelOpen(true)`、`useBrowserPanelStore.getState().requestTab(...)`、`createTab(...)`、`setActiveTab(...)` 都是用户/插件事件路径中的 Zustand store 更新。这里没有看到 render phase setState，也没有看到 effect 每次 commit 后无条件写入状态导致的循环。

## Risk Assessment

- 真实运行风险：低。bridge 安装 effect 依赖 `setBrowserPanelOpen`，该 setter 来自 Zustand store，通常稳定；即便 effect 重跑，cleanup 会删除 window bridge 并取消 IPC 订阅。
- DX/静态分析风险：中低。`installBrowserUseBridge` 仍接收名为 `openBrowserPanel` 的回调，并在内部事件 handler 中调用它。某些静态规则可能只看到 effect 闭包间接持有 setter，无法证明它只在事件触发时运行。
- 行为风险：低。提取 helper 后保留了原 bridge 行为，并扩展了 `createTab` 返回 tab id、`activateTab` 返回 boolean、`getActiveTab` 返回当前 tab id。
- Ownership 风险：中。`app-layout.tsx` 作为 layout shell 直接安装 `browser-use` bridge，短期可接受，但长期仍是 host layout 持有 plugin-specific bridge 的耦合点。后续 plugin system 收敛时应迁出到 browser-use owned web integration。

## Recommended Next Action

接受当前提取 helper 的修复方向，不需要继续为 `no-cascading-set-state` 做更大源码调整。

如果 `react-doctor` 仍在当前版本报同一处告警，建议把它记录为静态分析 false positive 或工具局限，并在后续插件化迁移时一起消除耦合；不要为了压告警把 bridge 行为改成异步 timer 或额外 React state，那会增加不必要复杂度。

最低验证建议：

```bash
npx -y react-doctor@latest . --verbose --diff
pnpm --filter @cradle/web typecheck
```

可选人工验证：在 Electron Chat tab 中打开 browser panel，通过 browser-use 创建 tab、激活 tab、读取 active tab，确认 panel 自动打开且 tab id 与 UI active tab 一致。

## Files Inspected

- `apps/web/src/components/layout/app-layout.tsx`
- `apps/web/src/components/layout/README.md`
- `apps/web/src/env.d.ts`
- `apps/web/src/store/browser-panel.ts`
- `apps/web/src/store/layout.ts`
- `.agents/skills/react-doctor/SKILL.md`

