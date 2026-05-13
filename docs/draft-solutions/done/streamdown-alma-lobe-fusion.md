# Streamdown: Alma + Lobe Fusion Architecture

> Combining Lobe's correctness guarantees with Alma's visual richness into a configurable, extensible streaming animation system.

## 1. Comparative Analysis

### 1.1 What Lobe Provides (our current base)

| Feature | How it works |
|---------|-------------|
| Persistent birth timestamps | Each char assigned a birth ts once; never mutates. Re-renders don't restart animations |
| Block-level state machine | `queued → animating → streaming → revealed` with synchronous promotion during render |
| Char-delay chaining | `prevBirth + charDelay`, capped at `renderNow + fadeDuration` to prevent invisible backlog |
| Queue acceleration | `charDelay` shrinks as queue depth grows, so buffered content drains faster |
| Settled optimization | Once all births pass fade window, block uses `stream-char-revealed` class (zero animation overhead) |
| Content smoothing | Buffer-based CPS smoother with presets (`balanced`/`realtime`/`silky`) |

**Animation style**: Simple opacity fade or `opacity + translateY(2px)` for words. Single-stage keyframe.

### 1.2 What Alma Adds BEYOND Lobe

| Feature | Implementation | Visual effect |
|---------|---------------|---------------|
| **3-stage keyframe** | `blur(2px) + translateY(4px) + opacity:0` → `blur(0.5px) + opacity:0.7` → `clear` | Text materializes through blur like mist dissolving |
| **Word-level `Intl.Segmenter`** | Uses `zh` locale segmenter for CJK; wraps non-whitespace in `.alma-fade-word` | Natural word boundaries for all scripts |
| **Streaming cursor with trail** | `▎` cursor + gradient `.streaming-cursor-trail` element with clip-path animation | Cursor leaves a colored comet tail as it moves |
| **Block glow** | `--streaming-glow-color: color-mix(in srgb, var(--primary) 15%, transparent)` | Active streaming blocks have subtle ambient glow |
| **Delayed animated wrapper** | `useDelayedAnimated` keeps CSS gate active 1s after stream ends | Graceful fade-out of all streaming effects |
| **SKIP_TAGS fence** | Code/pre/math/svg get no animation at all | Technical content renders instantly |
| **Dark mode adaptation** | `.dark .streaming-cursor-trail` uses different oklch mix | Cursor trail works in both themes |
| **CSS variables** | `--streaming-fade-duration`, `--streaming-fade-curve`, `--streaming-glow-color` | Configurable at runtime via CSS |
| **List-specific animation** | `streamingListReveal` — opacity only, no blur/transform | Lists don't look janky with per-char blur |

### 1.3 What Neither Has (innovation opportunities)

| Idea | Description |
|------|-------------|
| **Spring physics timing** | Replace `ease-out` with spring-based curve (CSS `linear()` approximation) for organic feel |
| **Stagger patterns** | Instead of uniform delay between chars/words, use wave patterns (sine-modulated delays) |
| **Block entrance animation** | When a new block appears, slide/scale it in as a unit before char-level reveal starts |
| **Adaptive fidelity** | Detect frame drops and auto-downgrade from `char` → `word` → `block` animation |
| **GPU layer promotion** | Use `will-change: opacity, transform` only on actively animating elements, remove when settled |
| **CSS `@starting-style`** | Modern CSS entry animations without JS, for block-level entrances |

---

## 2. Fusion Architecture

### 2.1 Core Principle

```
Lobe correctness layer (birth timestamps, state machine, queue acceleration)
  + Alma visual layer (keyframes, cursor trail, glow, CSS vars)
  + Cradle innovation (presets, adaptive fidelity, spring curves)
  = @cradle/streamdown
```

The correctness layer is NEVER touched by visual customization. Animation style is purely CSS-driven, controlled by class names and CSS variables injected by the rehype plugin.

### 2.2 Layer Separation

```
┌─────────────────────────────────────────────────────────────────────┐
│  StreamdownRender (orchestrator)                                     │
│  ├─ useSmoothContent() → content smoothing                          │
│  ├─ tokenizeBlocks() → block splitting                              │
│  ├─ useStreamQueue() → block state machine (queued/anim/stream/rev) │
│  ├─ births computation (persistent timestamps)                       │
│  └─ Block rendering with theme context                              │
├─────────────────────────────────────────────────────────────────────┤
│  rehype-stream-animate (DOM transformation)                          │
│  ├─ Wraps text in <span> with birth-derived animation-delay          │
│  ├─ Injects data-attributes for CSS targeting                       │
│  └─ Mode: char | word | block                                       │
├─────────────────────────────────────────────────────────────────────┤
│  CSS Animation Layer (pure CSS, fully swappable)                     │
│  ├─ Keyframe definitions (presets: minimal / balanced / dramatic)    │
│  ├─ CSS variables (timing, curves, colors)                          │
│  ├─ Cursor styles                                                   │
│  └─ Block glow / entrance effects                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.3 Animation Preset System

```typescript
// packages/streamdown/src/presets/types.ts

export interface AnimationPreset {
  /** Unique preset identifier */
  name: string

  /** CSS class applied to the streaming container */
  containerClass: string

  /** Keyframe name for char/word reveal */
  revealKeyframe: string

  /** Duration of the reveal animation in ms */
  fadeDuration: number

  /** CSS timing function */
  timingFunction: string

  /** Whether to apply blur in the reveal */
  useBlur: boolean

  /** Whether to apply translateY in the reveal */
  useTranslateY: boolean

  /** TranslateY distance (e.g., '4px', '2px') */
  translateDistance: string

  /** Whether blocks get entrance animation */
  blockEntrance: boolean

  /** Whether cursor has trail effect */
  cursorTrail: boolean

  /** Whether active block has glow */
  blockGlow: boolean
}

export const PRESETS: Record<string, AnimationPreset> = {
  minimal: {
    name: 'minimal',
    containerClass: 'stream-preset-minimal',
    revealKeyframe: 'stream-reveal-minimal',
    fadeDuration: 200,
    timingFunction: 'ease-out',
    useBlur: false,
    useTranslateY: false,
    translateDistance: '0',
    blockEntrance: false,
    cursorTrail: false,
    blockGlow: false,
  },
  balanced: {
    name: 'balanced',
    containerClass: 'stream-preset-balanced',
    revealKeyframe: 'stream-reveal-balanced',
    fadeDuration: 280,
    timingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    useBlur: false,
    useTranslateY: true,
    translateDistance: '2px',
    blockEntrance: false,
    cursorTrail: false,
    blockGlow: true,
  },
  dramatic: {
    name: 'dramatic',
    containerClass: 'stream-preset-dramatic',
    revealKeyframe: 'stream-reveal-dramatic',
    fadeDuration: 350,
    timingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
    useBlur: true,
    useTranslateY: true,
    translateDistance: '4px',
    blockEntrance: true,
    cursorTrail: true,
    blockGlow: true,
  },
}
```

### 2.4 CSS Variable System

```css
/* packages/streamdown/src/styles/variables.css */

.streamdown-root {
  /* Timing */
  --stream-fade-duration: 280ms;
  --stream-fade-curve: cubic-bezier(0.22, 1, 0.36, 1);
  --stream-char-delay: 18ms; /* overridden by JS at runtime */

  /* Reveal transform */
  --stream-reveal-blur: 0px;
  --stream-reveal-translate-y: 2px;
  --stream-reveal-opacity-start: 0;

  /* Cursor */
  --stream-cursor-color: currentColor;
  --stream-cursor-width: 2px;
  --stream-cursor-pulse-duration: 1000ms;

  /* Trail */
  --stream-trail-color: color-mix(in srgb, var(--stream-cursor-color) 50%, transparent);
  --stream-trail-width: 28px;

  /* Block glow */
  --stream-glow-color: color-mix(in srgb, var(--stream-cursor-color) 12%, transparent);
  --stream-glow-radius: 12px;

  /* Block entrance */
  --stream-block-entrance-translate: 8px;
  --stream-block-entrance-duration: 200ms;
}

/* Preset overrides via container class */
.stream-preset-minimal {
  --stream-fade-duration: 200ms;
  --stream-fade-curve: ease-out;
  --stream-reveal-blur: 0px;
  --stream-reveal-translate-y: 0px;
}

.stream-preset-dramatic {
  --stream-fade-duration: 350ms;
  --stream-fade-curve: cubic-bezier(0.16, 1, 0.3, 1);
  --stream-reveal-blur: 2px;
  --stream-reveal-translate-y: 4px;
}
```

### 2.5 Unified Keyframe Architecture

```css
/* packages/streamdown/src/styles/keyframes.css */

/* Universal reveal — driven entirely by CSS variables */
@keyframes stream-reveal {
  0% {
    opacity: var(--stream-reveal-opacity-start, 0);
    filter: blur(var(--stream-reveal-blur, 0px));
    transform: translateY(var(--stream-reveal-translate-y, 0px));
  }
  100% {
    opacity: 1;
    filter: blur(0px);
    transform: translateY(0);
  }
}

/* Block entrance (when enabled) */
@keyframes stream-block-enter {
  from {
    opacity: 0;
    transform: translateY(var(--stream-block-entrance-translate, 8px));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Cursor pulse (Alma-inspired) */
@keyframes stream-cursor-pulse {
  0%, 100% {
    opacity: 0.4;
    transform: scaleY(1);
  }
  50% {
    opacity: 0.9;
    transform: scaleY(1.05);
  }
}

/* Cursor trail clip-path animation */
@keyframes stream-trail-fade-right {
  0% { opacity: 0.4; clip-path: inset(0); }
  100% { opacity: 0; clip-path: inset(0 0 0 100%); }
}

@keyframes stream-trail-fade-left {
  0% { opacity: 0.4; clip-path: inset(0); }
  100% { opacity: 0; clip-path: inset(0 100% 0 0); }
}
```

---

## 3. Component & Hook Changes

### 3.1 New: `StreamdownThemeProvider`

```typescript
// packages/streamdown/src/context/theme-context.tsx

import { createContext, useContext, type ReactNode } from 'react'
import { type AnimationPreset, PRESETS } from '../presets/types'

interface StreamdownThemeContext {
  preset: AnimationPreset
  /** Override individual CSS variables at runtime */
  cssOverrides?: Record<string, string>
}

const ThemeCtx = createContext<StreamdownThemeContext>({
  preset: PRESETS.balanced,
})

export function StreamdownThemeProvider({
  preset = 'balanced',
  cssOverrides,
  children,
}: {
  preset?: keyof typeof PRESETS | AnimationPreset
  cssOverrides?: Record<string, string>
  children: ReactNode
}) {
  const resolved = typeof preset === 'string' ? PRESETS[preset] : preset

  return (
    <ThemeCtx.Provider value={{ preset: resolved, cssOverrides }}>
      {children}
    </ThemeCtx.Provider>
  )
}

export const useStreamdownTheme = () => useContext(ThemeCtx)
```

### 3.2 Modified: `StreamdownRender`

Changes:
1. Accept `preset` as a prop (or read from context)
2. Apply container class from preset
3. Pass `fadeDuration` from preset (not hardcoded 280)
4. Inject CSS variable overrides as inline style on root div
5. Conditionally render cursor trail element

```diff
 interface StreamdownRenderProps {
   content: string
   streaming: boolean
-  preset?: SmoothPreset
+  smoothPreset?: SmoothPreset
+  animationPreset?: 'minimal' | 'balanced' | 'dramatic' | AnimationPreset
   animateMode?: 'char' | 'word'
   className?: string
   animatedTailMs?: number
 }
```

The container div changes to:

```tsx
<div
  className={cn(
    preset.containerClass,
    showStreamingClass && 'streaming-response',
    className,
  )}
  style={cssOverrides ? Object.entries(cssOverrides).reduce(
    (acc, [k, v]) => ({ ...acc, [k]: v }), {}
  ) : undefined}
>
```

### 3.3 Modified: `rehype-stream-animate`

Add a `data-stream-state` attribute to each animated span for CSS targeting:

```diff
 const createWordSpan = (word: string, wordStartIndex: number): Element => {
+  // Compute state for CSS targeting
+  const state = computeCharState(wordStartIndex)
+
   return {
     type: 'element',
     tagName: 'span',
     properties: {
       className: state === 'revealed' ? 'stream-word stream-word-revealed' : 'stream-word',
       style: delay !== 0 ? `animation-delay:${delay}ms` : undefined,
+      'data-stream-state': state, // 'active' | 'revealed'
     },
     children: [{ type: 'text', value: word }],
   }
 }
```

### 3.4 New: Cursor Trail Component

```typescript
// packages/streamdown/src/components/cursor-trail.tsx

import { memo, useEffect, useRef } from 'react'
import { useStreamdownTheme } from '../context/theme-context'

interface CursorTrailProps {
  streaming: boolean
}

/**
 * Alma-style cursor with gradient trail.
 * Only rendered when preset.cursorTrail is true.
 *
 * The trail is a short gradient div that animates via clip-path
 * as the cursor "moves" to new content positions.
 */
export const CursorTrail = memo<CursorTrailProps>(({ streaming }) => {
  const { preset } = useStreamdownTheme()
  if (!preset.cursorTrail || !streaming) return null

  return (
    <span className="stream-cursor-container">
      <span className="stream-cursor" />
      <span className="stream-cursor-trail" aria-hidden="true" />
    </span>
  )
})
```

### 3.5 Modified: CSS Animations

Replace the current `animations.css` with a variable-driven system:

```css
/* Active char/word animation uses the universal keyframe */
.streaming-response .stream-char,
.streaming-response .stream-word {
  display: inline;
  opacity: 0;
  animation: stream-reveal var(--stream-fade-duration) var(--stream-fade-curve) both;
}

/* Revealed = no animation */
.stream-char-revealed,
.stream-word-revealed {
  opacity: 1 !important;
  filter: none !important;
  transform: none !important;
  animation: none !important;
}

/* Block entrance (only in presets that enable it) */
.stream-preset-dramatic .streaming-response > div[data-birth] {
  animation: stream-block-enter var(--stream-block-entrance-duration) var(--stream-fade-curve) both;
}

/* Block glow (only in presets that enable it) */
.stream-preset-balanced .streaming-response > div[data-birth],
.stream-preset-dramatic .streaming-response > div[data-birth] {
  box-shadow: 0 0 var(--stream-glow-radius) var(--stream-glow-color);
  transition: box-shadow 300ms ease-out;
}

/* Remove glow when block is settled */
.streaming-response > div:not([data-birth]) {
  box-shadow: none;
}
```

### 3.6 New: Adaptive Fidelity Hook

```typescript
// packages/streamdown/src/hooks/use-adaptive-fidelity.ts

import { useEffect, useRef, useState } from 'react'

type Fidelity = 'char' | 'word' | 'block'

const FRAME_BUDGET_MS = 16.67 // 60fps target
const DOWNGRADE_THRESHOLD = 3 // consecutive frames over budget
const UPGRADE_THRESHOLD = 30 // consecutive frames under budget

/**
 * Monitors render performance and auto-downgrades animation fidelity
 * when frame drops are detected.
 */
export function useAdaptiveFidelity(
  preferredMode: 'char' | 'word',
  enabled = true,
): Fidelity {
  const [fidelity, setFidelity] = useState<Fidelity>(preferredMode)
  const overBudgetCount = useRef(0)
  const underBudgetCount = useRef(0)
  const rafRef = useRef<number>(0)
  const lastFrameTime = useRef(0)

  useEffect(() => {
    if (!enabled) {
      setFidelity(preferredMode)
      return
    }

    const measure = (now: number) => {
      if (lastFrameTime.current > 0) {
        const delta = now - lastFrameTime.current
        if (delta > FRAME_BUDGET_MS * 1.5) {
          overBudgetCount.current++
          underBudgetCount.current = 0
          if (overBudgetCount.current >= DOWNGRADE_THRESHOLD) {
            setFidelity(prev =>
              prev === 'char' ? 'word' : prev === 'word' ? 'block' : 'block'
            )
            overBudgetCount.current = 0
          }
        } else {
          underBudgetCount.current++
          overBudgetCount.current = 0
          if (underBudgetCount.current >= UPGRADE_THRESHOLD) {
            setFidelity(preferredMode)
            underBudgetCount.current = 0
          }
        }
      }
      lastFrameTime.current = now
      rafRef.current = requestAnimationFrame(measure)
    }

    rafRef.current = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(rafRef.current)
  }, [enabled, preferredMode])

  return fidelity
}
```

---

## 4. Integration Plan: How Alma Features Map to Our Architecture

### 4.1 3-Stage Blur Keyframe

**What**: Alma's `streamingTextReveal` uses `blur(2px) + translateY(4px)` → mid-point blur → clear.

**Integration**: The `--stream-reveal-blur` CSS variable controls this. In `dramatic` preset, it's `2px`. The keyframe `stream-reveal` is already parameterized:

```css
@keyframes stream-reveal {
  0% {
    opacity: 0;
    filter: blur(var(--stream-reveal-blur));
    transform: translateY(var(--stream-reveal-translate-y));
  }
  100% { opacity: 1; filter: blur(0); transform: translateY(0); }
}
```

**Why not 3-stage in CSS**: A 3-stage keyframe with a mid-point (`50% { opacity: 0.7; blur: 0.5px }`) produces subtler results but is harder to parameterize via variables. We use a **2-stage approach** that visually approximates the 3-stage feel because `blur` naturally creates a perceptual mid-point as it dissolves. The `cubic-bezier(0.16, 1, 0.3, 1)` timing function creates the acceleration that mimics Alma's mid-point pause.

If users want literal 3-stage, they can provide a custom keyframe name in a custom preset.

### 4.2 Cursor Trail

**What**: Alma's cursor leaves a gradient trail using `clip-path` animation and `oklch()` color mixing.

**Integration**:
- New `CursorTrail` component (see §3.4)
- Only rendered when `preset.cursorTrail === true` (i.e., `dramatic` preset)
- CSS handles the gradient and clip-path animations
- Dark mode variant uses `:where(.dark) .stream-cursor-trail` selector
- No JS position tracking needed — the trail is purely CSS adjacent to the cursor span

### 4.3 Block Glow

**What**: Active streaming blocks have ambient box-shadow using `color-mix()`.

**Integration**:
- The existing `data-birth` attribute on block wrapper divs provides the CSS hook
- `balanced` and `dramatic` presets enable glow via `--stream-glow-color`
- When block becomes settled, `data-birth` is removed → CSS transition fades glow out

### 4.4 List-Specific Animation

**What**: Alma uses `streamingListReveal` (opacity-only) for `ol`/`ul` instead of per-word blur.

**Integration**:
- The rehype plugin already has `SKIP_TAGS` logic
- Add a mode where list items use `word` mode but with `--stream-reveal-blur: 0` override
- Achieved by adding a CSS rule: `.streaming-response li .stream-word { --stream-reveal-blur: 0px; }`

### 4.5 `useDelayedAnimated`

**What**: Keeps `streaming-response` class active for 1s after stream ends.

**Already implemented**: Our `useDelayedAnimated` hook is identical to Alma's. ✅

---

## 5. Correctness Guarantees (Non-Negotiable)

These must NEVER be broken by visual customization:

1. **Birth timestamps are append-only** — a char's birth is assigned once and never changes
2. **`animation-delay` is relative to birth** — negative = already elapsed, positive = future. Re-renders don't restart
3. **Synchronous promotion** — when new block appears, previous streaming block instantly becomes `revealed` in the same render frame (no intermediate `animating` state)
4. **Settled blocks get `revealed` class** — zero animation overhead, no DOM churn
5. **Content smoothing is upstream of animation** — smoother controls WHEN chars appear, animation controls HOW they look

CSS variables and class changes CANNOT break these because:
- The rehype plugin computes `animation-delay` from birth timestamps regardless of CSS
- CSS variables only affect the VISUAL properties (duration, blur, translate)
- Block state machine is JS-only, CSS is downstream

---

## 6. API Surface

### 6.1 Public Props

```typescript
interface StreamdownProps {
  content: string
  streaming: boolean

  // Smoothing control (how fast chars are revealed)
  smoothPreset?: 'balanced' | 'realtime' | 'silky'

  // Visual animation control (how chars LOOK when revealed)
  animationPreset?: 'minimal' | 'balanced' | 'dramatic' | AnimationPreset

  // Granularity
  animateMode?: 'char' | 'word'

  // Auto-downgrade on frame drops
  adaptiveFidelity?: boolean

  // How long streaming CSS effects linger after stream ends
  animatedTailMs?: number

  // Override any CSS variable
  style?: Record<string, string>

  className?: string
}
```

### 6.2 Theming via CSS

Users can override any variable at the container level:

```css
.my-chat .streamdown-root {
  --stream-fade-duration: 400ms;
  --stream-reveal-blur: 3px;
  --stream-cursor-color: #7c3aed;
}
```

### 6.3 Custom Presets

```typescript
import { Streamdown, type AnimationPreset } from '@cradle/streamdown'

const myPreset: AnimationPreset = {
  name: 'spring',
  containerClass: 'stream-preset-spring',
  revealKeyframe: 'stream-reveal', // reuses default
  fadeDuration: 320,
  timingFunction: 'linear(0, 0.006, 0.025, 0.058, 0.104, 0.162, 0.232, 0.312, 0.402, 0.5, 0.598, 0.688, 0.768, 0.838, 0.896, 0.942, 0.975, 0.994, 1)',
  useBlur: true,
  useTranslateY: true,
  translateDistance: '6px',
  blockEntrance: true,
  cursorTrail: true,
  blockGlow: true,
}

<Streamdown animationPreset={myPreset} ... />
```

---

## 7. Specific Code Changes Required

### Phase 1: CSS Variable Foundation (no behavior change)

| File | Change |
|------|--------|
| `src/styles/animations.css` | Replace hardcoded values with CSS variables; add variable declarations |
| `src/styles/keyframes.css` | **(new)** Extract keyframe definitions into separate file |
| `src/styles/variables.css` | **(new)** Define all CSS custom properties with defaults |
| `src/styles/cursor.css` | **(new)** Cursor + trail styles extracted from animations.css |
| `src/styles/index.css` | **(new)** Barrel import for all style files |

### Phase 2: Preset System

| File | Change |
|------|--------|
| `src/presets/types.ts` | **(new)** `AnimationPreset` interface + built-in presets |
| `src/presets/index.ts` | **(new)** Barrel export |
| `src/context/theme-context.tsx` | **(new)** Theme provider + hook |
| `src/streamdown-render.tsx` | Read preset from props/context; apply container class; pass `fadeDuration` from preset |
| `src/blocks/block.tsx` | Pass `fadeDuration` from parent (already done, just confirm it's not hardcoded) |

### Phase 3: Alma Visual Features

| File | Change |
|------|--------|
| `src/styles/keyframes.css` | Add `stream-block-enter`, `stream-trail-*` keyframes |
| `src/styles/cursor.css` | Add trail gradient styles with dark mode variant |
| `src/styles/presets/` | **(new dir)** Per-preset CSS overrides (`minimal.css`, `balanced.css`, `dramatic.css`) |
| `src/components/cursor-trail.tsx` | **(new)** Cursor trail component |
| `src/streamdown-render.tsx` | Conditionally render `CursorTrail` based on preset |
| `src/plugins/rehype-stream-animate.ts` | Add `data-stream-state` attribute to spans |

### Phase 4: Adaptive Fidelity

| File | Change |
|------|--------|
| `src/hooks/use-adaptive-fidelity.ts` | **(new)** Frame-drop detection + auto-downgrade |
| `src/streamdown-render.tsx` | Use adaptive fidelity to override `animateMode` when enabled |

### Phase 5: Polish & Extras

| File | Change |
|------|--------|
| `src/styles/animations.css` | Add `@media (prefers-reduced-motion)` that forces all vars to zero |
| `src/styles/animations.css` | Add list-item blur override (`.streaming-response li .stream-word`) |
| `src/plugins/rehype-stream-animate.ts` | Add `will-change: opacity, transform, filter` to active spans; remove on revealed |

---

## 8. Migration Path

1. **Phase 1 is backward-compatible** — existing behavior is preserved, just refactored into variables
2. **Phase 2 adds new props** — defaults match current behavior (`balanced` preset)
3. **Phase 3 adds opt-in features** — only active with `dramatic` preset
4. **Phase 4 is opt-in** — `adaptiveFidelity={true}` flag

No breaking changes. The default experience stays the same. Users opt into richer effects via preset selection.

---

## 9. Performance Considerations

| Concern | Mitigation |
|---------|-----------|
| `filter: blur()` triggers repaint | Only in `dramatic` preset; GPU-composited via `will-change` |
| Per-char spans = many DOM nodes | Word mode is default; char mode opt-in. Adaptive fidelity downgrades |
| CSS variables on every span | Variables are inherited from container, not set per-span |
| `clip-path` animation (trail) | Only one element at a time; hardware-accelerated |
| `box-shadow` (glow) | One per block, transitions out; not painted every frame |
| `Intl.Segmenter` cost | Already memoized in rehype plugin; runs once per text node |

---

## 10. Summary of "Beyond Both" Innovations

1. **Preset system with CSS variable inheritance** — neither Alma nor Lobe has this. Full theming without touching JS
2. **Adaptive fidelity** — auto-degrade animation granularity on slow devices. No one else does this
3. **Spring timing via `linear()` CSS function** — organic motion without JS spring libraries
4. **Block entrance animations** — `@starting-style`-inspired entry for new blocks as units
5. **Unified keyframe architecture** — one keyframe driven by variables, not N hardcoded keyframes per preset
6. **Data attributes for CSS targeting** — `data-stream-state` enables community CSS themes without forking

The result: Lobe's correctness, Alma's visual richness, and Cradle's configurability — all in one system.

---

## 11. Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: CSS Variable Foundation | ✅ Done | `animations.css` fully rewritten with CSS vars on `.streamdown-root` |
| Phase 2: Preset System | ✅ Done | `presets/types.ts` + wired into `StreamdownRender` + `Streamdown` |
| Phase 3: Alma Visual Features | ✅ Done | Block glow, cursor trail (dramatic), cursor inline positioning |
| Phase 4: Adaptive Fidelity | ❌ Not started | Low priority; can be added later |
| Phase 5: Polish | ⚠️ Partial | `prefers-reduced-motion` done; list blur override + `will-change` pending |

### Deviations from Original Design

1. **No `StreamdownThemeProvider` context** — Props-based approach chosen (simpler, no provider nesting needed). Preset is passed directly as `animationPreset` prop.
2. **Simplified `AnimationPreset` interface** — Removed `revealKeyframe`, `useBlur`, `useTranslateY`, `translateDistance` in favor of direct CSS strings (`revealBlur`, `revealTranslateY`). CSS variables handle the rest.
3. **No separate CSS files** — All styles in a single `animations.css` for simpler import. CSS variables + preset class overrides make splitting unnecessary.
4. **Cursor rendered inside last Block** — Instead of a separate `CursorTrail` component, cursor + trail are rendered as children of the last active Block. CSS `:has(+ .stream-cursor)` makes the preceding element inline for proper flow.
5. **Playground uses Tweakpane v4** — Full parameter tweaking panel instead of custom control panel.

### Files Modified/Created

| File | Action |
|------|--------|
| `packages/streamdown/src/presets/types.ts` | Created |
| `packages/streamdown/src/presets/index.ts` | Created |
| `packages/streamdown/src/styles/animations.css` | Rewritten |
| `packages/streamdown/src/streamdown-render.tsx` | Modified (preset wiring) |
| `packages/streamdown/src/streamdown.tsx` | Modified (forward `animationPreset` prop) |
| `packages/streamdown/src/blocks/block.tsx` | Modified (cursor inside block) |
| `packages/streamdown/src/index.ts` | Modified (export presets) |
| `packages/streamdown/src/profiler/profiler-provider.tsx` | Modified (move to bottom-left) |
| `apps/playground/src/components/control-panel.tsx` | Rewritten (Tweakpane) |
| `apps/playground/src/app.tsx` | Modified (animationPreset state) |
