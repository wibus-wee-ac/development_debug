# Cradle Layout & Tab Router System — 核心架构解析

> 本文档于 2026-04-29 生成，覆盖旧版 Tab 系统、Layout 系统、LayoutSlots 注入机制的历史设计。
> 旧版 `packages/tabs/` 已迁移到 `packages/tabs-next/`；当前实现见 `apps/web/src/tabs/` 与 `apps/web/src/components/layout/`。

---

## 1. Tab 系统核心（legacy）

### 1.1 `defineTab()` / `TabDefinition`

```typescript
// legacy packages/tabs/src/define-tab.ts
interface TabDefinition<TType, TParams, TLoaderData> {
  type: TType                         // 唯一字符串 key
  label: string | ((params) => string)
  icon?: ComponentType
  pinned?: boolean                    // true → 全局唯一实例，不可关闭
  component: ComponentType<{ params, loaderData? }>
  loader?: (params) => Promise<TLoaderData>    // 异步预取数据
  loaderFallback?: ReactNode
  serialize?: (params) => string      // 用于 URL hash 序列化
  deserialize?: (path) => TParams | null
}
```

`defineTab()` 本质是 identity 函数，仅提供类型推断（zero-runtime cost）。

---

### 1.2 `TabInstance` — 运行时 Tab 数据结构

```typescript
interface TabInstance {
  id: string          // crypto.randomUUID().slice(0,8)
  type: string        // 对应 TabDefinition.type
  params: Record<string, string | undefined>
  label: string       // 已 resolve 的字符串
  pinned: boolean
}
```

---

### 1.3 `TabStoreState` — Zustand 状态

```typescript
interface TabStoreState {
  tabs: TabInstance[]
  activeTabId: string | null
  openTab(type, params?, options?) => string   // 返回 tabId；pinned tab 去重
  closeTab(id) => void                         // pinned tab 不可关闭
  setActiveTab(id) => void
  updateTabParams(id, partial) => void
  updateTabLabel(id, label) => void
  reorderTabs(orderedIds[]) => void
}
```

**`openTab` 去重逻辑：**
- pinned tab：同 type 全局唯一，已存在 → 仅切换 active
- 带 params 的 tab：所有 param 值完全匹配才复用
- 无 params 非 pinned：每次新建

**持久化：** `createTabStore(registry, { persistKey })` 内部用 `zustand/persist`，
将 `tabs[]` + `activeTabId` 写入 localStorage，默认 key `'cradle-tab-store'`。

---

### 1.4 `TabRenderer` — 渲染引擎

```tsx
<TabRenderer fallback={...} wrapper={Wrapper} className={...} />
```

- 遍历 `store.tabs`，每个 tab 用 **React 19 `<Activity>`** 包裹
  - `mode="visible"` → 活跃 tab，完整渲染
  - `mode="hidden"` → 后台 tab，DOM 保活但 effects 暂停
- 若 `TabDefinition.loader` 存在：进入 `TabLoaderBoundary`，用 `useEffect` 侦测 params 变化触发加载，完成后将 `loaderData` 传入组件
- 有 `wrapper` prop 时，每个 tab 内容被 `Wrapper` 包裹（app.tsx 不使用 wrapper）

> **注：** 关键组件带 `'use no memo'` 指令，禁止 React Compiler 自动 memo 化。
> 原因：Zustand `useSyncExternalStore` 在 React Compiler 的自动 memo 下，深层嵌套组件可能不触发重渲染。

---

### 1.5 `TabBar` — 标签栏 UI

```tsx
<TabBar cn={cn} onNewTab={cb} onTabActivated={cb}
  renderCloseIcon={...} renderNewTabIcon={...} />
```

- 用 `@dnd-kit`（`MouseSensor`，激活距离 5px）实现拖拽排序
- drag end → `store.reorderTabs()`
- pinned tab 不显示关闭按钮

---

### 1.6 `useTabNavigation` — 底层导航钩子

```typescript
const { navigateTo, openInNewTab, navigateInTab } = useTabNavigation()
// navigateTo:      复用已有 tab（exact params match），否则创建新的
// openInNewTab:    强制创建新 tab（忽略复用）
// navigateInTab:   将当前 active tab 替换为新 type（pinned tab 有保护 → 开新 tab）
```

---

### 1.7 URL 同步（`url-sync.ts`）

```typescript
createUrlSync(store, registry, options?) => cleanupFn
```

双向同步（**当前已激活**，hash `#/{type}/{serialized-params}`）：
- Tab → Hash：store subscribe → `serialize()` → `window.location.hash`
- Hash → Tab：`hashchange` → `deserialize()` → `openTab()` 或 `setActiveTab()`

---

## 2. Tab 注册系统 (`src/renderer/src/tabs/`)

### 2.1 `cradleRegistry` + `useCradleTabStore`

```typescript
// registry.ts
export const cradleRegistry = {
  'home':             homeTab,
  'chat':             chatTab,
  'new-chat':         newChatTab,
  'kanban-board':     kanbanBoardTab,
  'workspace-detail': workspaceDetailTab,
  'usage':            usageTab,
} as const

export const useCradleTabStore = createTabStore(cradleRegistry)
```

### 2.2 各 Tab 类型规格

| type | params | pinned | loader | serialize |
|------|--------|--------|--------|-----------|
| `home` | 无 | ✅ | 无 | 无 |
| `chat` | `{ sessionId }` | ❌ | `ipc.chat.getMessages(sessionId)` → `ChatMessageRow[]` | `path = sessionId` |
| `new-chat` | 无 | ❌ | 无 | 无 |
| `kanban-board` | `{ boardId?, issue? }` | ❌ | 无 | `/{boardId}?issue={issue}` |
| `workspace-detail` | `{ workspaceId }` | ❌ | 无 | `path = workspaceId` |
| `usage` | 无 | ❌ | 无 | 无 |

### 2.3 `useCradleNavigation`

```typescript
// src/renderer/src/tabs/use-cradle-navigation.ts
const { openTab, openNewTab } = useCradleNavigation()
// openTab    = navigateTo（复用已有 tab 优先）
// openNewTab = openInNewTab（强制新建）

// 辅助：
useIsActiveTab(type, params?) → boolean
```

---

## 3. Layout 系统 (`src/renderer/src/components/layout/`)

### 3.1 `AppLayout` — 整体布局结构

```
┌───────────────────────────────────────────────────────┐
│  AppHeader (bg-sidebar, 窗口拖拽区)                    │
├──────────────────────────────────┬────────────────────┤
│  Center Column                   │  Right Aside        │
│  (bg-background, rounded-xl)     │  (motion.aside,     │
│  ┌────────────────────────────┐  │   bg-sidebar)       │
│  │  children (TabRenderer)    │  │  resolvedAside      │
│  ├────────────────────────────┤  │  可折叠 + resize    │
│  │  ResizeHandle (vertical)   │  │  [200, 560]px       │
│  ├────────────────────────────┤  │                     │
│  │  Bottom Panel (motion.div) │  │                     │
│  │  [80, 480]px               │  │                     │
│  └────────────────────────────┘  │                     │
├──────────────────────────────────┴────────────────────┤
│  AppFooter                                             │
└───────────────────────────────────────────────────────┘
```

> `AppSidebar` 不在 `AppLayout` 内，而是在 `app.tsx` flex row 中与 `AppLayout` 并列。

**Slot 覆盖规则：** `context.slots.xxx ?? prop.xxx`
- Per-tab 注入的 slots 优先于 `AppLayout` 直接传入的 props
- 当没有 tab 注册 slots 时（如 home tab），layout 退回 props 传入的默认值

**动画：**
- 弹簧：`stiffness: 600, damping: 40`（aside/panel 开合）
- 拖拽 resize 时切换为 `duration: 0`（消除 resize 抖动）

---

### 3.2 `AppHeader` — 顶部栏

```
[sidebar toggle] [──────── TabBar (flex-1, @dnd-kit) ────────] [▼panel] [▶aside]
```

- macOS 窗口拖拽区（`WebkitAppRegion: 'drag'`），交互元素设置 `no-drag`
- `hasPanel` / `hasAside` toggle 按钮的显示，由 `LayoutSlotsContext` 的 slots 传入
- **drill-in 模式**：active tab 为 `kanban-board` 或 `isSettings=true` 时，隐藏 sidebar toggle

---

### 3.3 `AppSidebar` — 侧边栏（三模式）

```typescript
const mode = isSettings ? 'settings' : isKanban ? 'kanban' : 'main'
```

| 模式 | 内容 | 宽度控制 |
|------|------|---------|
| `main` | WorkspaceSidebar（会话列表）| 可折叠，`sidebarCollapsed` 控制 |
| `kanban` | KanbanSidebar（看板列表）| 强制展开，drill-in |
| `settings` | SettingsSidebar（设置导航）| 强制展开，drill-in |

- 折叠宽度固定 `48px`，展开宽度由 `sidebarWidth`（默认 260px，持久化）控制
- 模式切换用 `AnimatePresence` + `motion.div`，blur + x 位移动画
- 快捷键：`⌘,`（settings）、`Escape`（退出 settings）、`⌘B`（切换折叠）

---

### 3.4 `LayoutSlotsContext` — per-tab 布局注入系统

```typescript
// layout-slots-context.tsx
interface LayoutSlots {
  aside?: ReactNode       // RightAside（Files/Git/Issue 标签面板）
  panel?: ReactNode       // ShellView（xterm 终端）
  hasAside?: boolean      // 是否显示 aside toggle 按钮
  hasPanel?: boolean      // 是否显示 panel toggle 按钮
  title?: ReactNode       // 会话标题（面包屑）
  workspace?: ReactNode   // 工作区名称（面包屑）
  gitBranch?: ReactNode   // GitBranchControl
}
```

`LayoutSlotsProvider` 内部维护 `map: Record<id, LayoutSlots>` + `activeId`，
computed `slots = map[activeId] ?? {}`。

**状态更新策略：**
- 同一 `(id, slots-ref)` 对不触发 dispatch（bail-out 优化）
- 所有操作（register/unregister）通过 `setState` 做纯 immutable 更新，不用 ref 读取

---

### 3.5 `useRegisterLayoutSlots` — 注册时序

```typescript
// use-layout-slots.ts
useRegisterLayoutSlots(id: string, slots: LayoutSlots)
// useEffect(() => { register(id, slots); return () => unregister(id) }, [id, slots, ...])
```

**完整生命周期（以 ChatTabContent 为例）：**

```
1. TabRenderer 将 Activity mode 设为 "visible"
2. ChatTabContent 组件挂载
3. useQuery 开始查询 session → workspaceId → workspacePath
4. useMemo 计算 aside / panel / gitBranch（依赖 workspacePath，初始为 undefined）
5. useRegisterLayoutSlots(sessionId, slots) → useEffect 触发
   → register(sessionId, slots)
   → LayoutSlotsProvider.setState: map[sessionId] = slots, activeId = sessionId
   → AppLayout.slots 更新 → Header 显示 hasAside=true toggle
   （此时 hasPanel=false，因为 workspacePath 还未加载）

6. workspacePath 加载完成 → useMemo 返回新的 panel ReactNode
   → useRegisterLayoutSlots useEffect 再次触发
   → register(sessionId, newSlots)
   → slots.hasPanel = true → Header 显示 panel toggle
   → slots.panel = <ShellView ... /> → 底部面板就绪

7. 用户切换到其他 tab：Activity mode = "hidden"
   → React 19 暂停 effects，组件不 unmount（DOM 保活）
   → slots 依然注册（activeId 仍为该 sessionId，因为没有其他 tab 注册）
   → 但如果其他 tab 调用 register()，activeId 切换过去，slots 清空

8. closeTab → Activity 节点被移除 → 组件 unmount
   → useEffect cleanup: unregister(sessionId)
   → map 删除该 entry
```

---

### 3.6 `useLayoutStore` — 持久化状态

```typescript
// store/layout.ts  (persistKey: 'cradle-layout')
// 持久化
sidebarWidth: number        // 默认 260
sidebarCollapsed: boolean   // 默认 false
asideWidth: number          // 默认 280，范围 [200, 560]
bottomPanelHeight: number   // 默认 200，范围 [80, 480]
asideOpen: boolean          // 默认 false
bottomPanelOpen: boolean    // 默认 false

// 不持久化（session-only）
isSettings: boolean
settingsSection: string
```

---

## 4. 应用启动入口

### 4.1 `main.tsx`

```
window.location.hash === '#/devtool'
  → <IpcDevtoolPage />（调试窗口，独立 BrowserWindow）
否则
  → <QueryClientProvider><App /></QueryClientProvider>
```

### 4.2 Provider 层次树（`app.tsx`）

```
<QueryClientProvider>                      ← TanStack Query
  <ToastProvider>
    <AnchoredToastProvider>
      <TooltipProvider>
        <ShortcutProvider>                 ← 全局快捷键
          <LayoutSlotsProvider>            ← 布局 slot 注入上下文
            <TabsProvider store registry>  ← Tab store + registry
              <div.flex.h-screen>
                <AppSidebar />             ← 独立侧边栏
                <AppLayout>                ← 主内容区
                  <TabRenderer />          ← Activity 容器
                </AppLayout>
              </div>
            </TabsProvider>
          </LayoutSlotsProvider>
        </ShortcutProvider>
      </TooltipProvider>
    </AnchoredToastProvider>
  </ToastProvider>
</QueryClientProvider>
```

**注意：** `LayoutSlotsProvider` 在 `TabsProvider` **外层**，
因为 AppLayout 需要读取 slots，而它在 TabsProvider 之外。
Tab 内容（TabRenderer 内部）在 TabsProvider 内，可正常访问 LayoutSlotsContext。

---

## 5. 完整数据流

### 5.1 打开 Chat Tab

```
用户点击 session
  → useCradleNavigation().openTab('chat', { sessionId })
    → store.openTab('chat', { sessionId })
      → 创建新 TabInstance，localStorage 持久化
      → TabLoaderBoundary: loader = ipc.chat.getMessages(sessionId) 开始执行
      → 显示 loaderFallback（spinner）
    → loader 完成
      → <ChatTabContent params loaderData={messages} />
        → useQuery('chat-session', sessionId) → workspaceId
        → useQuery('workspace-detail', workspaceId) → workspacePath
        → useMemo: aside=<RightAside>, panel=<ShellView>, gitBranch=<GitBranchControl>
        → useRegisterLayoutSlots(sessionId, slots)
          → LayoutSlotsProvider: activeId = sessionId
            → AppLayout.resolvedAside = <RightAside>
            → AppLayout.resolvedPanel = <ShellView>
            → AppHeader.hasAside = true → ▶ toggle 出现
            → AppHeader.hasPanel = true → ▼ toggle 出现
```

### 5.2 Tab 切换时的 Slot 联动

```
用户点击 TabBar home pill
  → store.setActiveTab(homeTabId)
  → TabRenderer:
    - chat tab: Activity mode="hidden"（DOM 保活，effects 暂停）
    - home tab: Activity mode="visible"
  → home tab 未调用 useRegisterLayoutSlots
    → activeId 切换后 map[homeTabId] 不存在
    → slots = {}
    → AppLayout.resolvedAside = undefined → aside 不渲染
    → AppHeader.hasAside = undefined → toggle 消失
```

---

## 6. 关键依赖关系图

```
legacy packages/tabs/
  define-tab.ts        ←── 类型定义
  store.ts             ←── createTabStore (zustand+persist)
  context.ts           ←── TabsContext
  provider.tsx         ←── TabsProvider
  components/tab-renderer.tsx  ←── Activity per-tab
  components/tab-bar.tsx       ←── DnD pill bar
  hooks/use-tab-navigation.ts  ←── navigateTo/openInNewTab
  url-sync.ts          ←── hash 同步

src/renderer/src/tabs/
  registry.ts          ←── cradleRegistry + useCradleTabStore
  *.tab.tsx            ←── 各 tab 类型定义（包含 useRegisterLayoutSlots）
  use-cradle-navigation.ts ←── app-level 导航 API

src/renderer/src/components/layout/
  layout-slots-context.tsx  ←── LayoutSlotsProvider + Context
  use-layout-slots.ts       ←── useRegisterLayoutSlots hook
  app-layout.tsx       ←── 消费 slots，主布局
  app-header.tsx       ←── TabBar + hasAside/hasPanel toggles
  app-sidebar.tsx      ←── 三模式侧边栏
  right-aside.tsx      ←── Files/Git/Issue 标签面板
  resize-handle.tsx    ←── 拖拽 resize

src/renderer/src/store/layout.ts  ←── useLayoutStore (持久化)
src/renderer/src/app.tsx          ←── Provider 树
src/renderer/src/main.tsx         ←── 入口
```

---

## 7. 架构要点总结

| 关键设计 | 说明 |
|---------|------|
| **Tab 是 source of truth** | tab store（localStorage 持久化）是唯一状态来源，URL hash 同步是衍生行为 |
| **Activity 保活** | React 19 `<Activity mode="hidden">` 保留 DOM 和 state，xterm.js 终端不重建 |
| **Slot 系统解耦** | tab 内容通过 `LayoutSlotsContext` 向父级布局注入内容，无需 prop drilling |
| **`'use no memo'`** | 关键组件禁用 React Compiler 自动 memo，规避 Zustand `useSyncExternalStore` 订阅失效 |
| **pinned tab** | home tab 全局唯一、不可关闭、不可被 `navigateInTab` 替换 |
| **drill-in 模式** | settings/kanban 时 sidebar 强制展开切换内容，隐藏 sidebar toggle |
| **Layout Slots 时序** | slots 随 tab content mount/params 变化动态更新，不等待 "切换完成" 才渲染 |
| **持久化隔离** | Tabs 状态（`'cradle-tab-store'`）与 Layout 状态（`'cradle-layout'`）独立持久化 |
