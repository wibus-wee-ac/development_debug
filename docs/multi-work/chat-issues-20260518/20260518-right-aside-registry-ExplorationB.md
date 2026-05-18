# Right Aside Panel 闪烁问题 — Exploration Report

## 架构全图

```
App (app.tsx)
├── activeSlotId = activeTab.type === 'chat' ? activeTab.params.sessionId : null
├── LayoutSlotsProvider { activeSlotId }
│   ├── state.map: Record<sessionId, LayoutSlots>  ← slot 注册表
│   └── render-time sync: if (activeSlotId in map) → 更新 activeId
├── TabsProvider + TabRenderer
│   └── RouteLoaderBoundary → ChatTabContent → ChatTabLayoutSlots
│       └── useRegisterLayoutSlots(sessionId, slots)  ← useEffect (异步！)
└── AppLayout
    └── {resolvedAside !== undefined && <m.aside>...}  ← 条件挂载 DOM
```

## 根因：三重叠加

### 1. useEffect 异步注册
`useRegisterLayoutSlots` 通过 `useEffect` 注册 slot，而 `activeSlotId` 同步推导。首次挂载时永远存在 1+ 帧的 "未注册" 窗口期。

### 2. Loader 放大延迟
chat tab 有阻塞式 loader（fetch messages），loader 阶段渲染 spinner，`ChatTabContent` 不存在 → slot 不注册。

### 3. 条件挂载 = DOM 抖动
`{resolvedAside !== undefined && ...}` 导致 aside DOM 完全卸载/重新挂载。motion.div 的 spring 动画使 "弹入" 非常明显。

### 切换时序（首次打开新 Chat Tab）

```
T0: activeSlotId = B.sessionId
T1: B.sessionId NOT in state.map → activeId 不更新
T2: resolvedAside = undefined → aside DOM 卸载 ← 消失！
T3: loader 运行中 → spinner → 无 slot 注册
T4: loader 完成 → ChatTabContent 渲染 → useEffect 注册 slot
T5: activeId = B.sessionId → resolvedAside 有值 → aside DOM 重新挂载 ← 重新出现！
```

## 修复方案

### 方案 A：同步注册 + Always-mount（推荐）
- `useRegisterLayoutSlots` 改为 render-time 注册（useMemo 内同步 register）
- AppLayout aside 始终挂载 DOM，用 `width: 0 / opacity: 0` 控制显隐
- 消除 DOM 抖动

### 方案 B：声明式 Slot Registry（最彻底）
- Tab 定义声明 `slots: { hasAside: true }`
- LayoutSlotsProvider 用 tab 类型声明决定 "有没有 aside"
- aside 内容由组件 useEffect 填充（允许短暂空白但不会消失/重现）

### 方案权衡

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 改动范围 | 小（2-3 文件） | 大（tab 定义层 + 布局层） |
| 根除闪烁 | ✓ | ✓ |
| 可扩展性 | 中 | 高（新 tab 类型自动受益） |
| 推荐度 | ★★★★ | ★★★★★ |

## 影响面
仅 `chat.tab.tsx` 使用 `useRegisterLayoutSlots`，其他 tab 都不注册 aside/panel。
