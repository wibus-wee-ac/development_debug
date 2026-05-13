# Exec Plan: @cradle/streamdown → apps/web 集成

## 概览

将 `apps/web` 中使用的 npm `streamdown` v2.5.0 包替换为我们的 workspace `@cradle/streamdown` 包，并添加一个 Zustand store 管理流式渲染偏好设置（动画预设、粒度、光标开关等）。

## 现状分析

### 当前使用方式（npm streamdown v2.5.0）
```tsx
import { Streamdown } from 'streamdown'

// children-based API:
<Streamdown animated isAnimating={isStreaming}>
  {part.text}
</Streamdown>
```

使用位置：
- `features/chat/message-bubble.tsx` — 主消息渲染 + subagent 渲染
- `features/chat/reasoning-block.tsx` — 思考链折叠内容

CSS 导入：
- `styles.css` → `@import "streamdown/styles.css"`

### 目标 API（@cradle/streamdown）
```tsx
import { Streamdown } from '@cradle/streamdown'

// props-based API:
<Streamdown
  content={part.text}
  streaming={isStreaming}
  preset={preset}
  animationPreset={animationPreset}
  animateMode={animateMode}
  showCursor={showCursor}
/>
```

## 执行步骤

### Phase 1: 依赖替换

1. **移除旧依赖**
   - 从 `package.json`（root）删除 `"streamdown": "^2.5.0"`
   - 从 `apps/web/package.json` 删除 `"@streamdown/code": "^1.1.1"`
   - 添加 `"@cradle/streamdown": "workspace:*"` 到 `apps/web/package.json` dependencies

2. **更新 CSS 导入**
   - `apps/web/src/styles.css`: `@import "streamdown/styles.css"` → `@import "@cradle/streamdown/styles"`

### Phase 2: Zustand Store — 流式渲染设置

3. **创建 `apps/web/src/store/streamdown.ts`**
   ```ts
   interface StreamdownState {
     animationPreset: AnimationPresetName
     animateMode: 'char' | 'word'
     showCursor: boolean
     setAnimationPreset: (p: AnimationPresetName) => void
     setAnimateMode: (m: 'char' | 'word') => void
     setShowCursor: (v: boolean) => void
   }
   ```
   - Persist with key `cradle:streamdown:v1`
   - Defaults: `balanced`, `word`, `true`

### Phase 3: 组件替换

4. **重写 `message-bubble.tsx` 的 Streamdown 调用**
   - Import 从 `'streamdown'` → `'@cradle/streamdown'`
   - 消费 `useStreamdownStore` 获取 preset/mode/cursor 设置
   - 从 children API → props API：
     ```tsx
     <Streamdown content={part.text} streaming={isStreaming} {...streamdownSettings} />
     ```

5. **重写 `reasoning-block.tsx` 的 Streamdown 调用**
   - 同样的 import 替换 + API 迁移
   - reasoning 块可以使用 `showCursor={false}`（思考链不需要光标）

### Phase 4: Settings UI

6. **在 `appearance-settings.tsx` 中添加流式动画设置区**
   - 动画预设选择（minimal/balanced/dramatic）— 卡片式选择器
   - 动画粒度（word/char）— 二选一开关
   - 光标显示开关 — toggle

### Phase 5: 清理

7. **移除旧 npm 包的相关代码/配置**
   - 确认不再有任何 `from 'streamdown'` 导入
   - pnpm install 刷新 lockfile

## 影响分析

| 文件 | 变更类型 |
|------|----------|
| `package.json` (root) | 删除 streamdown dep |
| `apps/web/package.json` | 替换依赖 |
| `apps/web/src/styles.css` | CSS import path |
| `apps/web/src/store/streamdown.ts` | 新建 |
| `apps/web/src/store/README.md` | 更新说明 |
| `apps/web/src/features/chat/message-bubble.tsx` | API 迁移 |
| `apps/web/src/features/chat/reasoning-block.tsx` | API 迁移 |
| `apps/web/src/features/settings/appearance-settings.tsx` | 添加设置 UI |

## 设计决策

1. **为什么用 Zustand store 而不是 prop drilling** — 设置是全局的，多处消费（message-bubble、reasoning-block、可能的 future 组件），store 保证一致性且自动 persist
2. **Smooth preset 不暴露到 UI** — `preset`（CPS smoother 参数）对用户太技术，保留 `'balanced'` 默认值即可
3. **AnimationPreset 不允许自定义对象** — 只暴露三个命名预设供选择，足够满足不同用户偏好
