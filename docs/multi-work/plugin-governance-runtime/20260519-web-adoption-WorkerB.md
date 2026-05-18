# Web Adoption Worker Handoff

日期：2026-05-19
角色：WorkerB
范围：web-side adoption for plugin governance runtime

## 直接结论

已完成 web 侧治理运行时接入。Web host 优先使用 server 提供的 `routeSegment` 加载 web bundle；web plugin context 现在通过 owner 写入 panel/command registration；store 会生成 owner-scoped contribution id，并拒绝同 owner 下的重复 id。Devtool 类型和展示已兼容新的 descriptor 字段，同时保留旧 `hasWeb`、`hasServer`、`hasDesktop`、entry 字段的读取路径。

## Changed Files

- `apps/web/src/lib/plugin-host.ts`
  - 使用 `/api/plugins` 返回的 `routeSegment` 组装 `web.mjs` URL。
  - 移除 web host 内部对 `@cradle/` 的 ad hoc strip 逻辑。
  - 用 canonical owner identity 创建 web plugin context。
  - 兼容 legacy server 响应：缺少 `routeSegment` 时使用 SDK `derivePluginRouteSegment()`。

- `apps/web/src/lib/plugin-store.ts`
  - `panels`、`commands` 改为 owner-aware records，增加 `owner`、`localId`、`registeredAt`。
  - registration id 规范化为 `${owner}:${localId}`。
  - 同一 scoped id 重复注册会抛错，不再静默产生歧义记录。
  - dispose 按 scoped id 清理，避免误删其它 owner 的同名 contribution。

- `apps/web/src/features/devtool/plugins/use-plugin-data.ts`
  - `PluginInfo` 增加 `identity`、`routeSegment`、`source`、`layers`、`capabilities`、`warnings`。
  - activated time 优先读取 descriptor layer 的 `activatedAt`，旧响应仍使用前端观测时间。

- `apps/web/src/features/devtool/plugins/plugins-panel.tsx`
  - Devtool 展示 identity、route segment、source trust、layer states、capability records、warnings。
  - Client registrations 展示 owner 和 local id。
  - 插件展开区只显示该 owner 的 panels/commands。

- `apps/web/src/features/devtool/plugins/plugin-graph.tsx`
  - Graph node/edge 使用 `identity ?? name` 作为 owner。
  - Capability side 连接到实际 owner 的 web contributions 和 descriptor capabilities。

- `apps/web/src/tabs/plugin-panel.tab.tsx`
  - Panel lookup 优先使用 scoped panel id。
  - 对 legacy persisted local panel id 提供单匹配回退；多 owner 同 local id 时不猜测。

## Validation Performed

- `pnpm --filter @cradle/web exec tsc --noEmit --pretty false`
  - 结果：通过。

- `npx -y react-doctor@latest . --verbose --diff` in `apps/web`
  - 结果：通过扫描，score `89 / 100`。
  - 本次 plugin 文件中的 `Loading...` warning 已修复为 `Loading&hellip;`。
  - 剩余 warnings 位于任务范围外的并行/既有改动文件，例如 `workspace-detail-page.tsx`、`browser-panel.tsx`、`composer.tsx`、`chat-view.tsx`、`message-bubble.tsx` 等，未触碰。

## Unresolved Issues

- 本 worker 未修改 server/desktop。若 server 仍返回 legacy plugin list 且不包含 `routeSegment`，web 会走 SDK normalizer 回退；完整验收仍依赖 server worker 将 governed descriptors 投影到 `/api/plugins`。
- 没有新增 store 单元测试。本次用 TypeScript 和 react-doctor 做 focused validation；后续可补 `plugin-store` duplicate registration/dispose 行为测试。
