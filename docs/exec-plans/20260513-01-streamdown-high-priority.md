# Exec Plan: Streamdown High-Priority Gaps

## Scope
Implement all 13 high-priority gaps in `packages/streamdown`.

## Work Batches (parallel where possible)

### Batch 1 — Core Infra (parallel)
- A: Fence State Detection + HTML Bypass → `src/core/fence-state.ts`, modify smoother
- B: Birth Timestamp Chain → rewrite `rehype-stream-animate.ts`
- C: Sync Block Promotion + charDelay Freeze → fix `use-block-queue.ts`

### Batch 2 — Scroll Layer (parallel)
- D: Conversation Spacer → `src/scroll/conversation-spacer.tsx`
- E: Spring Physics Scroll → `src/scroll/spring-scroll.ts`
- F: User Scroll Intent Detection → `src/scroll/scroll-intent.ts`
- G: AutoScroll Component → `src/scroll/auto-scroll.tsx`

### Batch 3 — Observability (parallel)
- H: Stream Profiler → `src/profiler/profiler.ts`
- I: Stream Debug Store → `src/profiler/debug-store.ts`
- J: Integrate profiler into smoother

### Batch 4 — Polish (parallel)
- K: CSS 3-stage animation upgrade → update `animations.css`
- L: prefers-reduced-motion full coverage
- M: Intl.Segmenter in smoother for CJK

### Batch 5 — Tests
- N: Test suite for fence-state, profiler, smoother, block-queue

## Exports update
- Add scroll components + profiler + debug store to `src/index.ts`
