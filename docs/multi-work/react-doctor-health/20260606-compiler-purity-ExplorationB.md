# Exploration B: React Compiler Purity And Bailout Diagnostics

本文是 `20260606-02-react-doctor-health` 的 compiler purity / React Compiler bailout 交接文件。范围只覆盖基线目录：

```text
/var/folders/vx/5kj6zs2n1zsb9k23r5gm9qbh0000gn/T/react-doctor-71b76d8b-ebae-43d0-ab94-c97104efd92f
```

重点诊断文件：

```text
react-hooks-js--purity.txt
react-hooks-js--incompatible-library.txt
react-doctor--rendering-hydration-mismatch-time.txt
react-doctor--rerender-lazy-ref-init.txt
```

注意：基线输出里 `apps/web/src/...` 与 `src/...` 多数是同一 web package 的重复扫描根。实际源码修复应落在 repo 内真实 owner 路径，例如 `apps/web/src/...`。`packages/streamdown/src/...` 与 `src/...` 也是 package-local scan root 的重复输出。

## 直接结论

最值得先修的是 `apps/web/src/features/onboarding/onboarding-page.tsx:345-347` 的 render-phase `Math.random()`。这是 React purity 的真实 correctness 问题，不只是性能提示。

第二批建议修 `packages/streamdown/src/hooks/use-smooth-content.ts:68`、`apps/web/src/features/session-await/await-panel.tsx:995`、`packages/streamdown/src/streamdown-render.tsx:90` 这类 ref initializer。它们大多不是用户可见 bug，但会让 render path 做被丢弃的 work，并且会扩大 React Compiler bailout 面。

`apps/web/src/features/kanban/kanban-table.tsx:665` 的 `useReactTable` incompatible-library 应 defer。这里已经有 `eslint-disable-next-line react-hooks/incompatible-library`，TanStack Table hook 返回 imperative table helpers，本轮不应该为了分数重写 table ownership。

## Risk-Sorted Diagnostics

### 1. High: render-phase randomness in onboarding

基线诊断：

```text
Rule: react-hooks-js/purity
Severity: error
Files:
  apps/web/src/features/onboarding/onboarding-page.tsx:345
  apps/web/src/features/onboarding/onboarding-page.tsx:346
  apps/web/src/features/onboarding/onboarding-page.tsx:347
  src/features/onboarding/onboarding-page.tsx:345
  src/features/onboarding/onboarding-page.tsx:346
  src/features/onboarding/onboarding-page.tsx:347
```

当前源码定位：

```tsx
// apps/web/src/features/onboarding/onboarding-page.tsx:342-348
const particles = useMemo(() =>
  Array.from({ length: 12 }, (_, i) => ({
    id: i,
    startX: (Math.random() - 0.5) * 120,
    startY: (Math.random() - 0.5) * 120,
    delay: Math.random() * 0.3,
  })), [])
```

真实风险：

- `useMemo` callback 仍属于 render phase；React 允许丢弃或重跑 memo work。
- `Math.random()` 让同一 props/state 的 render 非幂等。Strict Mode、React Compiler、并发 render 或 remount 都可能得到不同初始动画布局。
- 这是 UI animation 随机性，不是业务状态，但它直接违反 React Compiler purity。

推荐改法：

- 把粒子数据改成 module-scope deterministic constant。
- 不要用 `Math.random()`。可用固定数组，或基于 `id` 的 deterministic pseudo-random helper。
- 如果仍希望每个 mount 都随机，改为 `useState(() => createParticles())` 可以避免每次 render 重算，但仍会在 Strict Mode dev remount 下变化；compiler purity 仍更偏向 deterministic source。

建议 patch 形状：

```tsx
interface WelcomeParticle {
  id: number
  startX: number
  startY: number
  delay: number
}

const WELCOME_PARTICLES: WelcomeParticle[] = [
  { id: 0, startX: -46, startY: 18, delay: 0.03 },
  { id: 1, startX: 38, startY: -52, delay: 0.08 },
  { id: 2, startX: -14, startY: -44, delay: 0.14 },
  { id: 3, startX: 57, startY: 22, delay: 0.19 },
  { id: 4, startX: -58, startY: -9, delay: 0.24 },
  { id: 5, startX: 19, startY: 53, delay: 0.11 },
  { id: 6, startX: -33, startY: 47, delay: 0.27 },
  { id: 7, startX: 49, startY: -15, delay: 0.05 },
  { id: 8, startX: -8, startY: 59, delay: 0.21 },
  { id: 9, startX: 7, startY: -58, delay: 0.16 },
  { id: 10, startX: -51, startY: -36, delay: 0.10 },
  { id: 11, startX: 44, startY: 41, delay: 0.29 },
]
```

Then in `StepWelcome`:

```tsx
{WELCOME_PARTICLES.map(particle => (
  <m.div
    key={particle.id}
    initial={{ x: particle.startX, y: particle.startY, opacity: 0, scale: 0 }}
    transition={{
      duration: 1.2,
      delay: particle.delay,
      ease: [0.16, 1, 0.3, 1],
    }}
  />
))}
```

### 2. Medium: stream smoother ref initializer re-scans content

基线诊断：

```text
Rule: react-doctor/rerender-lazy-ref-init
Severity: warning
Files:
  packages/streamdown/src/hooks/use-smooth-content.ts:68
  src/hooks/use-smooth-content.ts:68
```

当前源码定位：

```tsx
// packages/streamdown/src/hooks/use-smooth-content.ts:67-69
const fullTextRef = useRef(content)
const bypassSmootherRef = useRef(shouldBypassSmoother(content))
useEffect(() => {
```

相关写入：

```tsx
// packages/streamdown/src/hooks/use-smooth-content.ts:315-320
useEffect(() => {
  const s = stateRef.current
  const now = performance.now()
  const appendLen = content.length - s.prevContentLen
  const bypassSmoother = shouldBypassSmoother(content)
  bypassSmootherRef.current = bypassSmoother
```

真实风险：

- `useRef(shouldBypassSmoother(content))` 的 argument 每次 render 都会执行，但 React 只采用首次值。这里会反复扫描 streaming content 并丢弃结果。
- 当前 effect 会在 content change 后更新 `bypassSmootherRef.current`，所以主要风险是 performance 和时序可读性，不是已确认的 stale UI bug。
- 由于 hook 是 stream rendering hot path，长文本 streaming 时这个 warning 比普通 `new Set()` allocation 更值得修。

推荐改法：

- 用 `useRef<boolean | null>(null)` 或 `useRef(false)`，通过一个 pure local `bypassSmoother` 在 render/effect 中共享。
- 如果 tick 只需要 effect 后的值，则初始化为 `false`，在 content effect 中唯一写入。
- 更清晰的改法是让 `bypassSmoother` 成为 `useMemo(() => shouldBypassSmoother(content), [content])`，然后 effect 写入 ref。这里 `shouldBypassSmoother` 是 pure parser，不违反 purity。

建议 patch 形状：

```tsx
const bypassSmoother = useMemo(() => shouldBypassSmoother(content), [content])
const bypassSmootherRef = useRef(bypassSmoother)

useEffect(() => {
  bypassSmootherRef.current = bypassSmoother
}, [bypassSmoother])
```

如果不想新增 `useMemo` import churn，可以用 lazy null guard，但不要在 `useRef(...)` argument 里调用 parser。

### 3. Medium: streamdown render birth map allocation and render-time ref pattern

基线诊断：

```text
Rule: react-doctor/rerender-lazy-ref-init
Severity: warning
Files:
  packages/streamdown/src/streamdown-render.tsx:90
  src/streamdown-render.tsx:90
```

当前源码定位：

```tsx
// packages/streamdown/src/streamdown-render.tsx:85-90
// Each char gets a birth timestamp assigned ONCE and it never changes.
// We use a ref to persist across renders. Reading ref.current during render
// is intentional here (same pattern as Lobe) — births are append-only data
// that doesn't trigger re-renders.
const blockBirthsRef = useRef<Map<number, number[]>>(new Map())
```

相关风险：

- `new Map()` 每次 render 都会 allocate and discard。
- 更重要的是同一 component 在 render 中读取 `blockBirthsRef.current`，然后 effect 中提交 `birthsForRender`。这不是本文件指定诊断之一，但它会触发 React Compiler `refs` 类 bailout；当前 worktree diff 显示原来的 `eslint-disable react-hooks/refs` 被移除过，需谨慎。
- 这段逻辑在 streaming animation 中刻意用 ref 避免 birth timestamps 触发 render。它是性能工程代码，不应简单改成 state。

推荐改法：

- 最小修复 lazy initializer：

```tsx
const blockBirthsRef = useRef<Map<number, number[]> | null>(null)
if (blockBirthsRef.current === null) {
  blockBirthsRef.current = new Map()
}
```

- 但这仍会读 ref during render；如果目标是 React Compiler compatibility，需要更大的设计：把 birth computation 放入 `useMemo` with previous committed snapshot passed from state/external store，或保留 compiler suppression 并接受 bailout。
- 本轮建议只修 `new Map()` allocation；不要在没有 visual regression check 的情况下重构 birth timestamp ownership。

### 4. Medium-Low: default expanded CI nodes Set allocation

基线诊断：

```text
Rule: react-doctor/rerender-lazy-ref-init
Severity: warning
Files:
  apps/web/src/features/session-await/await-panel.tsx:995
  src/features/session-await/await-panel.tsx:995
```

当前源码定位：

```tsx
// apps/web/src/features/session-await/await-panel.tsx:992-996
function GitHubCICard({ ci, awaitId, sessionId }: { ci: LiveCIStatus, awaitId: string, sessionId: string | null }) {
  const tree = useMemo(() => buildRunTree(ci.checkRuns, ci.workflowRuns), [ci.checkRuns, ci.workflowRuns])
  const defaultExpandedNodeIds = useMemo(() => collectExpandableNodeIds(tree), [tree])
  const initializedExpandedNodeIdsRef = useRef(new Set(defaultExpandedNodeIds))
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set(defaultExpandedNodeIds))
```

真实风险：

- `new Set(defaultExpandedNodeIds)` 每次 render allocate and discard。
- Initial ref semantics are intentional: it tracks node IDs already auto-expanded so later arrivals can be merged without resetting user toggles.
- Correctness risk is low if fixed with lazy ref guard; high if rewritten to recompute from props each render.

推荐改法：

```tsx
const initializedExpandedNodeIdsRef = useRef<Set<string> | null>(null)
if (initializedExpandedNodeIdsRef.current === null) {
  initializedExpandedNodeIdsRef.current = new Set(defaultExpandedNodeIds)
}
```

Keep the existing effect that adds unseen IDs. Do not derive `initializedExpandedNodeIdsRef` directly from `defaultExpandedNodeIds` after mount.

### 5. Medium-Low: profile signature ref repeats JSON work

基线诊断：

```text
Rule: react-doctor/rerender-lazy-ref-init
Severity: warning
Files:
  apps/web/src/features/agent-management/profile-detail-panel.tsx:273
  src/features/agent-management/profile-detail-panel.tsx:273
```

当前源码定位：

```tsx
// apps/web/src/features/agent-management/profile-detail-panel.tsx:215-222
function createProfileSignature(values: ProfileDetailFormValues): string {
  return JSON.stringify({
    name: values.name,
    apiKey: values.apiKey,
    baseUrl: values.baseUrl,
    model: values.model,
    api: values.api,
    enabledModels: values.enabledModels,
```

```tsx
// apps/web/src/features/agent-management/profile-detail-panel.tsx:269-273
const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const savedClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const modelsRequestRef = useRef(0)
const saveRequestRef = useRef(0)
const savedSignatureRef = useRef(createProfileSignature(getProfileFormValues(profile)))
```

真实风险：

- Each render repeats `getProfileFormValues(profile)` plus `JSON.stringify(...)`; React ignores the value after first mount.
- Correctness looks okay because later profile resets explicitly write `savedSignatureRef.current` around line 349 and save success writes around line 454.

推荐改法：

```tsx
const savedSignatureRef = useRef<string | null>(null)
if (savedSignatureRef.current === null) {
  savedSignatureRef.current = createProfileSignature(getProfileFormValues(profile))
}
```

Do not remove the later explicit assignments that synchronize after profile reset/save.

### 6. Low: container refs initialized with Map/Set/WeakSet

基线诊断：

```text
Rule: react-doctor/rerender-lazy-ref-init
Severity: warning
Files:
  apps/web/src/features/browser/browser-panel.tsx:969
  apps/web/src/features/devtool/plugins/use-plugin-data.ts:40
  apps/web/src/lib/shortcut-provider.tsx:8
  apps/web/src/features/workspace/file-tree.tsx:178
  apps/web/src/features/workspace/file-tree.tsx:179
  packages/streamdown/src/components/citation-popover.tsx:31
```

当前工作树定位有行号漂移，实际源码位置如下：

```text
apps/web/src/features/browser/browser-panel.tsx:1056
apps/web/src/features/devtool/plugins/use-plugin-data.ts:40
apps/web/src/lib/shortcut-provider.tsx:8
apps/web/src/features/workspace/file-tree.tsx:178
apps/web/src/features/workspace/file-tree.tsx:179
packages/streamdown/src/components/citation-popover.tsx:31
```

代表性源码：

```tsx
const addressDraftByTabIdRef = useRef<Map<string, string>>(new Map())
const activatedAtRef = useRef<Map<string, number>>(new Map())
const entriesRef = React.useRef<Map<string, ShortcutEntry>>(new Map())
const loadedDirectoriesRef = useRef<Set<string>>(new Set())
const loadingDirectoriesRef = useRef<Set<string>>(new Set())
const processedRef = useRef(new WeakSet<Text>())
```

真实风险：

- 这些基本是 allocation noise，不是确认的 correctness bug。
- `browser-panel.tsx:969` 的基线行号在当前工作树指向普通 object return，不是 `useRef`; 应以当前 `rg` 结果为准。
- `CitationPopover` 的 `WeakSet<Text>` 与 DOM mutation effect 绑定，语义上应该保持 ref；只需 lazy init，不要改成 state。

推荐改法：

```tsx
const entriesRef = React.useRef<Map<string, ShortcutEntry> | null>(null)
if (entriesRef.current === null) {
  entriesRef.current = new Map()
}
```

但这会让后续 uses 需要 non-null narrowing。为了减少 churn，可以先 defer 这些 low-risk allocation warnings，等高风险 React semantics 清理后统一做 helper-level pattern cleanup。

### 7. Low: design-system showcase year hydration warning

基线诊断：

```text
Rule: react-doctor/rendering-hydration-mismatch-time
Severity: warning
Files:
  packages/design-system/showcase/src/sections/Footer.tsx:36
  showcase/src/sections/Footer.tsx:36
```

当前源码定位：

```tsx
// packages/design-system/showcase/src/sections/Footer.tsx:33-36
<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-5)' }}>
  Cradle Design System ·
  {' '}
  {new Date().getFullYear()}
</span>
```

真实风险：

- 如果 showcase 是 SSR/SSG hydration path，跨年时 server-rendered year 与 client year 可能 mismatch。
- 如果 showcase is Vite client-only static app，这个 warning is effectively low-risk but still cheap to remove.

推荐改法：

- Prefer module constant if build-time year is acceptable:

```tsx
const COPYRIGHT_YEAR = 2026
```

- If year must be client clock, wrap the text node with `suppressHydrationWarning`, but that hides an avoidable mismatch and is less clean for a design-system showcase.

Deferred rationale:

- 低风险，且 `packages/design-system/showcase/src/sections/Footer.tsx` 当前已 dirty with formatting-only changes. 可以等主线程统一整理 formatting 后一起改。

### 8. Deferred: TanStack Table incompatible library bailout

基线诊断：

```text
Rule: react-hooks-js/incompatible-library
Severity: error
Files:
  apps/web/src/features/kanban/kanban-table.tsx:665
  src/features/kanban/kanban-table.tsx:665
```

当前源码定位：

```tsx
// apps/web/src/features/kanban/kanban-table.tsx:663-665
// TanStack Table exposes imperative helpers; keep the instance local to this view.
// eslint-disable-next-line react-hooks/incompatible-library
const table = useReactTable({
```

真实风险：

- This is a React Compiler optimization bailout, not an application correctness bug.
- TanStack Table intentionally returns a rich table instance with imperative helpers and internal memoization.
- Source already documents intent with an eslint suppression. Rewriting this would be a table architecture change, not a health-score fix.

Recommendation:

- Defer. Keep `useReactTable` local to `KanbanTable`.
- If compiler coverage becomes a hard target later, isolate TanStack Table behind a small table-view component boundary rather than replacing the library or wrapping every table helper.

## Warnings To Defer

Defer these in the first implementation pass:

```text
apps/web/src/features/kanban/kanban-table.tsx:665
apps/web/src/features/browser/browser-panel.tsx:1056
apps/web/src/features/devtool/plugins/use-plugin-data.ts:40
apps/web/src/lib/shortcut-provider.tsx:8
apps/web/src/features/workspace/file-tree.tsx:178
apps/web/src/features/workspace/file-tree.tsx:179
packages/streamdown/src/components/citation-popover.tsx:31
packages/design-system/showcase/src/sections/Footer.tsx:36
```

Reason:

- `useReactTable` is a known incompatible library boundary.
- Most `new Map()` / `new Set()` / `new WeakSet()` ref initializers are low-cost allocations and do not change UI correctness.
- The footer year warning is cheap but not central to React Compiler purity, and current file is already dirty.

Do not defer:

```text
apps/web/src/features/onboarding/onboarding-page.tsx:345
apps/web/src/features/onboarding/onboarding-page.tsx:346
apps/web/src/features/onboarding/onboarding-page.tsx:347
packages/streamdown/src/hooks/use-smooth-content.ts:68
packages/streamdown/src/streamdown-render.tsx:90
apps/web/src/features/session-await/await-panel.tsx:995
apps/web/src/features/agent-management/profile-detail-panel.tsx:273
```

## Validation Commands

After source changes, run from repo root:

```bash
npx -y react-doctor@latest . --verbose --diff
```

Focused local checks:

```bash
pnpm --filter @cradle/web lint
pnpm --filter @cradle/web typecheck
pnpm --filter @cradle/streamdown typecheck
```

If package scripts differ, use package-local equivalents from each `package.json`. For final score comparison, run the full scan:

```bash
npx -y react-doctor@latest . --verbose
```

Expected diagnostic deltas for the recommended first fixes:

```text
react-hooks-js/purity: remove 6 baseline entries, counting duplicate scan roots
react-doctor/rerender-lazy-ref-init: remove at least 6 baseline entries, counting duplicate scan roots
react-hooks-js/incompatible-library: unchanged and explicitly deferred
react-doctor/rendering-hydration-mismatch-time: unchanged unless footer is included
```

## Open Notes For Main Agent

- The worktree is already dirty in relevant files, including `apps/web/src/features/onboarding/onboarding-page.tsx`, `packages/design-system/showcase/src/sections/Footer.tsx`, and `packages/streamdown/src/streamdown-render.tsx`. Read current diffs before applying patches.
- Some current formatting in `onboarding-page.tsx` appears mechanically changed and less idiomatic. Do not let compiler-purity fixes accidentally normalize unrelated formatting unless the main task owns that cleanup.
- `packages/streamdown/src/streamdown-render.tsx` has intentional render-time ref reads. Lazy-init cleanup is safe; compiler refs compliance is a larger animation-state ownership decision.
