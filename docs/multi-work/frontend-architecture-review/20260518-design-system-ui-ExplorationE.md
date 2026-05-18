# Design System UI ExplorationE

## Scope

本次审查聚焦 `apps/web` 的 design-system 使用一致性、Tailwind class 纪律、组件放置边界、可访问性与视觉最佳实践。审查范围是只读代码检查；未修改业务代码。唯一写入产物是本 handoff 文件。

关键约束来自 `AGENTS.md` 与执行计划：

- UI 必须遵循 `design-system` conventions。
- Tailwind class 必须静态定义，并优先使用 `cn()` 组合。
- `components/ui/` 只承载可复用基础 UI primitive；业务组件应放在 `features/{domain}/`。
- 本次架构 review 不落地修复，只输出可验证建议。

## Files Inspected

- `AGENTS.md`
- `docs/exec-plans/20260518-05-frontend-architecture-review.md`
- `apps/web/src/styles.css`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/tabs.tsx`
- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/menu.tsx`
- `apps/web/src/components/ui/progress.tsx`
- `apps/web/src/components/layout/README.md`
- `apps/web/src/components/layout/app-header.tsx`
- `packages/tabs-next/src/components/tab-bar.tsx`
- `apps/web/src/features/chat/README.md`
- `apps/web/src/features/chat/tool-call-block.tsx`
- `apps/web/src/features/chat/blocks/tool-call-block.tsx`
- `apps/web/src/features/chat/blocks/edit-file-block.tsx`
- `apps/web/src/features/chat/blocks/read-files-block.tsx`
- `apps/web/src/features/chat/blocks/reasoning-block.tsx`
- `apps/web/src/components/editor/editor-bubble-menu.tsx`
- `apps/web/src/features/home/home-dashboard.tsx`
- `apps/web/src/features/usage/usage-dashboard.tsx`
- `apps/web/src/features/browser/browser-panel.tsx`
- `apps/web/src/features/workspace/workspace-sidebar.tsx`
- `apps/web/src/features/settings/appearance-settings.tsx`
- `apps/web/src/features/skills/skill-import-dialog.tsx`
- `apps/web/src/features/kanban/kanban-sidebar.tsx`
- `apps/web/src/features/agent-management/profile-detail-panel.tsx`

辅助搜索：

```bash
rg -n 'className=\{`|`[^`]*\$\{' apps/web/src packages/tabs-next/src
rg -n 'transition-all|will-change|letter-spacing:\s*-|scrollbar-width:\s*none|display:\s*none|transition:\s*all' apps/web/src packages/tabs-next/src
rg -n '<button|<a\s|role=|aria-label|sr-only|Tooltip|title=|disabled=|onClick=' apps/web/src/features apps/web/src/components/layout apps/web/src/tabs packages/tabs-next/src/components/tab-bar.tsx
rg -n '#|rgb\(|rgba\(|oklch\(|bg-(red|blue|green|yellow|amber|emerald|purple|slate|gray|zinc|neutral)-|text-(red|blue|green|yellow|amber|emerald|purple|slate|gray|zinc|neutral)-|border-(red|blue|green|yellow|amber|emerald|purple|slate|gray|zinc|neutral)-' apps/web/src/features apps/web/src/components/layout apps/web/src/tabs packages/tabs-next/src/components/tab-bar.tsx
```

## Findings

### High: `TabBar` package 绕过 web design-system，存在可访问性与 hit area 风险

Evidence:

- `packages/tabs-next/src/components/tab-bar.tsx:72-120` 使用 `div role="tab"` 承载 activation、keyboard handler 与 DnD listener，而不是原生 `button` 或 web app 的 `Button` primitive。
- `packages/tabs-next/src/components/tab-bar.tsx:108-118` close control 是 `size-3.5` 的裸 `<button>`，没有 `aria-label`，也没有可见或隐藏文本。
- `packages/tabs-next/src/components/tab-bar.tsx:250-259` new tab control 是 `size-5` 的裸 `<button>`，没有 `aria-label`。
- `apps/web/src/components/layout/app-header.tsx:97-106` 直接消费 package `TabBar`，因此这些交互控件位于主 app chrome 的高频路径。

Impact:

- 屏幕阅读器无法辨认 close/new tab 动作；close button 只渲染图标或 `×`。
- `size-3.5`/`size-5` 显著低于常规 32-40px hit area，鼠标与触控可用性差。
- `packages/tabs-next` 无法直接 import `~/components/ui/button`，但现在也没有把 accessibility/hit-area contract 暴露给 host app，导致 package UI 与 app design-system 分叉。

Severity: High。原因是这是 app chrome 的核心控件，影响键盘/辅助技术/高频点击路径。

### Medium: 动态 Tailwind class 仍出现在业务 UI 中，削弱 purge 与 review 纪律

Evidence:

- `apps/web/src/components/editor/editor-bubble-menu.tsx:131-137` 使用 template literal 拼接 `className`。
- `apps/web/src/features/home/home-dashboard.tsx:131-150` 将 Tailwind class 存入 theme object，并在 `apps/web/src/features/home/home-dashboard.tsx:169` 通过 template literal 注入。
- `apps/web/src/features/usage/usage-dashboard.tsx:203`、`apps/web/src/features/usage/usage-dashboard.tsx:276-278` 使用 template literal 拼接条件 class。

Impact:

- 这些 class 当前大多是静态字符串片段，运行时可能仍可工作；但它违背 `AGENTS.md` 的明确规则，后续很容易演化成真正动态的 `bg-${color}`/`text-${size}`。
- 代码审查很难区分“静态 map”与“动态 Tailwind token”，设计系统约束无法通过简单 grep 或 lint 稳定执行。

Severity: Medium。不是已知视觉 bug，但属于规则可执行性问题，会长期扩散。

### Medium: 全局隐藏 scrollbar 破坏 overflow affordance

Evidence:

- `apps/web/src/styles.css:29-36` 对 `*` 与 `*::-webkit-scrollbar` 全局隐藏滚动条。
- `apps/web/src/features/home/home-dashboard.tsx:377` 又在局部横向滚动容器使用 `[scrollbar-width:none]`，说明存在需要滚动但不提示的区域。

Impact:

- 用户无法直接判断某个 panel、dialog 或横向列表是否可滚动，尤其影响桌面端长列表、dialog content、code block 和 sidebar。
- 全局规则会覆盖未来所有 feature，违背 component-local ownership；需要隐藏 scrollbar 的场景应由具体容器显式选择。

Severity: Medium。主要是可发现性与可维护性风险，且影响面全局。

### Medium: `transition-all` 被基础组件和业务 UI 广泛使用

Evidence:

- `apps/web/src/components/ui/button.tsx:8`、`apps/web/src/components/ui/badge.tsx:8`、`apps/web/src/components/ui/tabs.tsx:66`、`apps/web/src/components/ui/switch.tsx:20` 等基础组件使用 `transition-all`。
- `packages/tabs-next/src/components/tab-bar.tsx:95`、`apps/web/src/features/settings/appearance-settings.tsx:112,180`、`apps/web/src/features/chat/composer.tsx:208`、`apps/web/src/features/skills/skill-import-dialog.tsx:148,309,433,441`、`apps/web/src/features/kanban/kanban-sidebar.tsx:251` 等业务 UI 也使用 `transition-all`。

Impact:

- `transition-all` 会把尺寸、阴影、边框等意外属性纳入动画，增加 layout/repaint 风险。
- 基础组件使用后会把模式扩散给业务侧，和 UI review skill 中“只指定具体 transition properties”的建议冲突。

Severity: Medium。它通常不是功能 bug，但会累积成 polish 与性能问题。

### Medium: `components/ui` 缺少目录 README，且已有 app-specific primitive 趋势

Evidence:

- `apps/web/src/components/ui/README.md` 不存在。
- `apps/web/src/components/ui/canvas-art.tsx`、`apps/web/src/components/ui/route-loading-fallback.tsx`、`apps/web/src/components/ui/icon-picker.tsx`、`apps/web/src/components/ui/preview-card.tsx` 看起来更偏 Cradle app-specific shared UI，而不是“可用于任何 React app”的基础 primitive。
- `AGENTS.md` 明确要求 `components/ui/` 是 universal base UI components；`components/common/` 才是 app-specific shared components。

Impact:

- 新 contributor 无法判断 `components/ui` 的准入标准，feature-specific 或 app-specific 组件容易继续进入基础层。
- 基础层一旦混入业务语义，后续 design-system token、文档和测试的 ownership 会变模糊。

Severity: Medium。不是立即破坏运行，但会影响长期设计系统边界。

### Low: Markdown typography 使用负 letter spacing，与项目视觉约束不一致

Evidence:

- `apps/web/src/styles.css:415` 在 `.streamdown-root` / `[data-pre-mounted]` 上设置 `letter-spacing: -0.01em`。
- `apps/web/src/styles.css:442`、`apps/web/src/styles.css:448` 在 Markdown `h1`/`h2` 上设置负字距。

Impact:

- 本会话 UI 指令要求 letter spacing 为 `0`，不要使用负字距。
- Markdown 渲染是聊天核心内容路径；负字距可能降低长文本和代码相邻内容的可读性，尤其在 CJK/混合文本中更明显。

Severity: Low。视觉细节问题，但路径高频。

### Low: 多处 icon-only 或极小裸按钮没有统一 Button semantics

Evidence:

- `apps/web/src/features/browser/browser-panel.tsx:257-264` navigation icon buttons 使用 `p-1` 裸 `<button>`，未提供 `aria-label`。
- `apps/web/src/features/workspace/workspace-sidebar.tsx:255-260` menu trigger 的 `<button>` 本身为空，icon 作为 `MenuTrigger` children 出现在外层；语义依赖 library render 行为，较脆弱。
- `apps/web/src/features/chat/tool-call-block.tsx:91-141` 与 `apps/web/src/features/chat/blocks/tool-call-block.tsx:92-109` 的 collapsible button 没有 `aria-expanded`/`aria-controls`。

Impact:

- 使用者与测试无法稳定判断 collapsed/expanded 状态。
- 裸按钮样式分散，hover/focus/active/hit-area 体验不一致。

Severity: Low to Medium。单点风险较小，但模式重复出现。

## Recommended Changes

1. 为 `packages/tabs-next` 定义 host-renderable action contract

建议让 `TabBar` 暴露 `renderTabCloseButton`、`renderNewTabButton` 或更小的 `getActionProps` contract，让 `apps/web` 用本地 `Button`、`Tooltip` 和 icon 实现视觉与 a11y。package 自身保留无样式 fallback，但必须提供：

- `aria-label`，例如 `Close ${tab.label}`、`New tab`
- `type="button"`
- `aria-selected` 与 `role="tab"` 的一致 contract
- close/new tab 的最小 hit area，至少 `size-7`，更推荐靠 invisible hit area 达到 32-40px
- `transition-colors` / `transition-opacity` / `transition-transform` 替代 `transition-all`

2. 把动态 class 改为 `cn()` + 静态 map

优先修正代表性文件：

- `apps/web/src/components/editor/editor-bubble-menu.tsx`
- `apps/web/src/features/home/home-dashboard.tsx`
- `apps/web/src/features/usage/usage-dashboard.tsx`

目标不是删除配置 map，而是把 map 中的 class 作为静态 value，并通过 `cn(theme.bg, ...)` 组合，避免 template literal 拼 class。

3. 收窄 scrollbar hiding 的 ownership

建议删除 `apps/web/src/styles.css` 的全局 `* { scrollbar-width: none }` 与 `*::-webkit-scrollbar { display: none }`，改成 utility class，例如 `.scrollbar-none`，只在明确需要隐藏的横向 card rail 或 chrome container 使用。

4. 在 design-system primitives 中逐步替换 `transition-all`

建议从 `Button`、`TabsTrigger`、`Switch`、`Badge` 开始，因为它们会被大量复用。常见替代：

- `transition-colors`
- `transition-opacity`
- `transition-transform`
- `transition-[background-color,border-color,color,box-shadow]`

5. 增加 `apps/web/src/components/ui/README.md`

建议 README 明确三条边界：

- `components/ui` 只允许 cross-app primitives 和 design-system tokens。
- app-specific shared UI 放 `components/common`。
- domain-specific UI 放 `features/{domain}`。

同时评估 `canvas-art.tsx`、`route-loading-fallback.tsx`、`icon-picker.tsx`、`preview-card.tsx` 是否应移动到 `components/common` 或具体 feature。移动属于后续实施任务，本 review 不建议在无引用审计时直接改路径。

6. 为 collapsible controls 添加 a11y state

在 chat tool/reasoning blocks、browser panel、workspace sidebar 等高频控件中补：

- `aria-label`
- `aria-expanded`
- `aria-controls`
- visible focus ring 或复用 `Button`

## Risks

- `packages/tabs-next` 是 workspace package，直接 import `apps/web` design-system 会造成反向依赖；应通过 render prop / slot contract 让 host app 注入视觉实现。
- 删除全局 scrollbar hiding 可能显著改变当前视觉，需要逐屏检查 sidebar、dialog、chat transcript、home activity rail 和 code block。
- 替换 `transition-all` 可能让部分细节状态不再动画，需要对 hover、focus、active、open/closed state 做截图或人工检查。
- 移动 `components/ui` 中 app-specific 文件会产生 import churn，应独立排期，并同步 README 和 barrel exports。

## Validation

推荐在实施修复后运行：

```bash
pnpm --filter @cradle/web exec tsc --noEmit
pnpm --filter @cradle/web build
pnpm --filter @cradle/web test
pnpm --filter @cradle/web exec eslint .
```

推荐补充人工检查：

- Keyboard-only：用 `Tab`/`Shift+Tab`/`Enter`/`Space` 操作 tab bar、close tab、new tab、browser navigation、chat tool block expand/collapse。
- Screen reader smoke check：确认 close/new tab、browser back/forward/reload、chat details toggle 有可理解名称。
- Visual regression：检查 light/dark 下 app header、tab bar、sidebar、home activity rail、chat markdown、settings appearance cards。
- Scroll affordance：确认长 dialog、chat transcript、sidebar list、horizontal activity card rail 是否仍可发现滚动。
- Reduced motion：确认 `prefers-reduced-motion` 下 shimmer、pulse、collapse animation 不造成持续干扰。

## Uncertainties

- 当前工作区已有未提交改动，本 review 基于 2026-05-18 当时 working tree；其中 `apps/web/src/styles.css`、`apps/web/src/components/layout/app-header.tsx`、`apps/web/src/features/chat/tool-call-block.tsx` 已是 modified 状态。
- 未运行浏览器截图或 axe 扫描；可访问性判断来自静态代码证据。
- 未完整审计 `components/ui/` 每个 primitive 的 Radix/shadcn contract，仅抽查了核心 primitive 与搜索命中的风险点。
- 未确认 `apps/web/src/features/chat/blocks/` 是否会长期替代旧 `apps/web/src/features/chat/tool-call-block.tsx`；两个路径当前都存在相似 UI contract，后续需要由 chat owner 收敛。
