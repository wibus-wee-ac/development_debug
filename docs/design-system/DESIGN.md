---
version: alpha
name: Cradle Design Language
description: >
  Cradle's visual language — a modern, elegant, physics-native desktop AI environment.
  Tonally between Linear and Vercel: precise, high-contrast, unsentimental. But distinctly
  its own: two-tone chrome architecture, surface-texture depth, spring-everywhere animation.

colors:
  # ── Core Surfaces ──────────────────────────────────────────────────────────
  background: "#ffffff"
  background-dark: "#141414"
  foreground: "#262626"
  foreground-dark: "#f5f5f5"

  # ── Chrome (Sidebar / Header / Footer) ────────────────────────────────────
  chrome: "#f5f5f5"
  chrome-dark: "#111111"
  chrome-foreground: "#595959"
  chrome-foreground-dark: "#8a8a8a"
  chrome-border: "rgba(0,0,0,0.06)"
  chrome-border-dark: "rgba(255,255,255,0.05)"

  # ── System Neutrals ───────────────────────────────────────────────────────
  muted: "rgba(0,0,0,0.04)"
  muted-dark: "rgba(255,255,255,0.04)"
  muted-foreground: "#737373"
  border: "rgba(0,0,0,0.08)"
  border-dark: "rgba(255,255,255,0.06)"
  ring: "#a3a3a3"

  # ── Primary (inverted for CTA context) ────────────────────────────────────
  primary: "#262626"
  primary-dark: "#f5f5f5"

  # ── Semantic Category Accents (always paired as bg/10 + text/60~70) ────────
  accent-workspace: "#3b82f6"
  accent-session: "#8b5cf6"
  accent-builtin: "#8b5cf6"
  accent-global: "#0ea5e9"
  accent-workspace-scope: "#10b981"
  accent-doc: "#10b981"
  accent-agent: "#f43f5e"
  accent-legacy: "#f59e0b"
  accent-diff: "#f97316"
  accent-summary: "#ec4899"

  # ── Semantic Status ───────────────────────────────────────────────────────
  status-success: "#10b981"
  status-warning: "#f59e0b"
  status-error: "#ef4444"

# ── Text Hierarchy (pre-resolved, WCAG-guaranteed) ─────────────────────────
# Never add opacity on top of these. Contrast computed vs #ffffff / #141414.
textHierarchy:
  primary-light:    "#262626"  # 15.6:1 AAA
  primary-dark:     "#f5f5f5"  # 17.6:1 AAA
  secondary-light:  "#737373"  # 4.54:1 AA
  secondary-dark:   "#a3a3a3"  # 7.5:1  AAA
  tertiary-light:   "#767676"  # 4.53:1 AA  ← was #a3a3a3 (2.4:1 fail)
  tertiary-dark:    "#8a8a8a"  # 5.3:1  AA
  dim-light:        "#a3a3a3"  # 2.43:1 Exempt (decorative/disabled only)
  dim-dark:         "#525252"  # 1.6:1  Exempt

typography:
  # ── Display / Headings ────────────────────────────────────────────────────
  display:
    fontFamily: Geist Variable
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.02em

  heading:
    fontFamily: Geist Variable
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em

  section-title:
    fontFamily: Geist Variable
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4

  # ── Body ──────────────────────────────────────────────────────────────────
  body-lg:
    fontFamily: Geist Variable
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6

  body-md:
    fontFamily: Geist Variable
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5

  body-sm:
    fontFamily: Geist Variable
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5

  # ── Labels ────────────────────────────────────────────────────────────────
  label-md:
    fontFamily: Geist Variable
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4

  label-sm:
    fontFamily: Geist Variable
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4

  label-xs:
    fontFamily: Geist Variable
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.3

  # ── Meta / Caption ────────────────────────────────────────────────────────
  caption:
    fontFamily: Geist Variable
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.3

  micro:
    fontFamily: Geist Variable
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.0

  micro-mono:
    fontFamily: Geist Mono
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.0

  # ── Mono ──────────────────────────────────────────────────────────────────
  code-sm:
    fontFamily: Geist Mono
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.5

  code-xs:
    fontFamily: Geist Mono
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.0

spacing:
  base: 16px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 64px
  # Layout specific
  sidebar-width: 260px
  sidebar-collapsed: 48px
  aside-width: 280px
  aside-min: 200px
  aside-max: 560px
  content-max-chat: 672px
  content-max-wide: 896px
  header-height: 40px
  footer-height: 36px
  # Insets
  section-pad-x: 16px
  section-pad-y: 8px

rounded:
  sm: 6px
  md: 8px
  base: 10px
  lg: 12px
  xl: 16px
  full: 9999px

components:
  # ── Surface card (main content) ───────────────────────────────────────────
  content-card:
    background: "{colors.background}"
    borderRadius: "{rounded.xl}"
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
    margin: "4px 8px 4px 4px"

  # ── Section label ─────────────────────────────────────────────────────────
  section-label:
    color: "{textHierarchy.tertiary.light}"  # pre-resolved #767676, 4.53:1 AA
    fontSize: "{typography.micro.fontSize}"
    fontWeight: "500"

  # ── Activity card (dashboard) ─────────────────────────────────────────────
  activity-card:
    background: "{colors.background}"
    borderColor: "rgba(0,0,0,0.08)"
    borderRadius: "{rounded.lg}"
    insetShadow: "0 1px 0 rgba(255,255,255,0.10)"
    width: "128px"

  # ── Row item (list entry) ─────────────────────────────────────────────────
  list-row:
    paddingX: "8px"
    paddingY: "6px"
    borderRadius: "{rounded.md}"
    hoverBackground: "rgba(0,0,0,0.04)"
    fontSize: "{typography.body-sm.fontSize}"

  # ── Pill / badge ──────────────────────────────────────────────────────────
  pill:
    paddingX: "12px"
    paddingY: "4px"
    borderRadius: "{rounded.full}"
    borderColor: "rgba(0,0,0,0.08)"
    fontSize: "{typography.micro.fontSize}"

  # ── Composer input card ───────────────────────────────────────────────────
  composer:
    background: "{colors.background}"
    borderColor: "rgba(0,0,0,0.10)"
    borderRadius: "{rounded.xl}"
    boxShadow: "0 1px 1px rgba(0,0,0,0.04)"
    focusRing: "0 0 0 2px rgba(163,163,163,0.20)"
    backdropBlur: "blur(8px)"
    backgroundOpacity: "0.80"

  # ── Message bubble (user) ─────────────────────────────────────────────────
  bubble-user:
    background: "{colors.muted}"
    borderRadius: "{rounded.lg} {rounded.lg} 2px {rounded.lg}"
    fontSize: "{typography.body-lg.fontSize}"

  # ── Floating overlay (popover / command) ──────────────────────────────────
  popover:
    background: "rgba(255,255,255,0.95)"
    borderColor: "rgba(0,0,0,0.08)"
    borderRadius: "{rounded.xl}"
    boxShadow: "0 8px 32px rgba(0,0,0,0.12)"
    backdropBlur: "blur(12px)"

  # ── Tab pill (animated sliding indicator) ─────────────────────────────────
  tab-pill:
    background: "{colors.muted}"
    borderRadius: "{rounded.md}"
    transition: "spring stiffness:600 damping:40"

  # ── Scope icon badge ──────────────────────────────────────────────────────
  scope-badge:
    size: "28px"
    borderRadius: "{rounded.lg}"

  # ── Resize handle ─────────────────────────────────────────────────────────
  resize-handle:
    width: "5px"
    activeColor: "rgba(0,0,0,0.15)"
    hoverColor: "rgba(0,0,0,0.08)"
    idleColor: "transparent"
    borderRadius: "{rounded.full}"
---

# Cradle Design Language

## Overview

Cradle is a desktop AI environment for developers. Its visual identity sits at the intersection of **Linear's precision** and **Vercel's austerity** — but with its own distinct character: warmer, more tactile, and physics-native.

The design isn't minimalist for the sake of minimalism. It's dense-capable: capable of showing complex information (chat, kanban, tools, usage) without fragmenting into visual noise. Every element earns its place by serving clarity.

**Core personality traits:**
- **Two-tone chrome architecture:** The shell (header, sidebar, footer) lives on a distinct chrome surface (`--sidebar`, slightly off-white/dark). The main content card floats on pure white/dark background. This alone creates all necessary spatial hierarchy without shadows or borders.
- **Surface texture, not elevation:** Cards use `inset-shadow` (a 1px top highlight) to feel like physical surfaces pressed into the material. No levitating box-shadows on interactive UI — those are reserved for genuine floating layers.
- **Physics-first motion:** Spring animations everywhere (Framer Motion). Transitions aren't cubic-bezier millisecond counts — they're mass and damping. Everything has weight.
- **Typographic restraint:** A single variable font (Geist Variable) covers the entire scale from 10px metadata to 30px display. No decorative typefaces, no uppercase tracking labels, no arbitrary optical tricks.
- **Categorical color discipline:** Colors are reserved for semantic categories (workspace = blue, session = violet, agent = rose, etc.), not decoration. The neutral palette is almost completely achromatic — all "color" is black/white with opacity.

**What Cradle is NOT:**
- Not card-heavy. Cards only appear where genuine containment is needed.
- Not gradient-heavy. Background gradients are a last resort.
- Not icon-decorative. Icons serve navigation and status — not illustration.
- Not uppercase-heavy. `uppercase tracking-wider` is avoided; one exception is tool-call parameter labels inside the chat (intentional engineering aesthetic).

---

## Colors

The palette is built entirely from **opacity-modulated neutrals** plus a **categorical accent set**. There are no fixed middle-gray hex codes — depth comes from layering black or white at calibrated opacities. This makes light and dark mode a single system, not two separate themes.

**Core surfaces:**
- **Background (#ffffff / #141414):** The main content canvas. Pure white in light mode; a deep near-black (neutral-950 tinted 6% white) in dark mode.
- **Chrome (#f5f5f5 / #111111):** The shell layer — sidebar, header bar, footer bar, and right aside. Slightly warm off-white in light; imperceptibly darker than background in dark. The visual separation between chrome and content is the foundation of all spatial hierarchy.
- **Muted (black/4% / white/4%):** The hover state. Used for row backgrounds on hover, user message bubbles, and subtle fill backgrounds. The same value in both modes — opacity against the surface is the constant.
- **Border (black/8% / white/6%):** Hairline dividers. Used extremely sparingly; spatial separation replaces borders wherever possible.
- **Muted Foreground (#737373):** The secondary text tier. Guarantees AA (4.54:1) on `--background`. Do not further reduce with opacity — use the pre-resolved text hierarchy tiers instead.

**Text hierarchy (pre-resolved, never stack opacity):**

| Token | Light | Dark | On bg (light) | On bg (dark) | WCAG | Use |
|---|---|---|---|---|---|---|
| `--text-primary` | `#262626` | `#f5f5f5` | 15.6:1 | 17.6:1 | **AAA** | Body text, headings, all primary readable content |
| `--text-secondary` | `#737373` | `#a3a3a3` | 4.54:1 | 7.5:1 | **AA** | Descriptions, secondary labels, supporting body |
| `--text-tertiary` | `#767676` | `#8a8a8a` | 4.53:1 | 5.3:1 | **AA** | Metadata, timestamps, captions, scope labels |
| `--text-dim` | `#a3a3a3` | `#525252` | 2.43:1 | 1.6:1 | Exempt | Decorative only, disabled states — never for readable content |

> All contrast ratios computed against `--background` (`#ffffff` light / `#141414` dark) using the WCAG 2.1 relative luminance formula. The WCAG 2.1 SC 1.4.3 exempts disabled/inactive UI components from contrast requirements — `--text-dim` exists exclusively for those cases.

**Categorical accents** (used in pairs: `bg-[color]-500/10` fill + `text-[color]-500/70` icon):
- Workspace: blue-500
- Session / Builtin skill: violet-500
- Cradle-only scope: sky-500
- Workspace scope / Doc: emerald-500
- Agent scope: rose-500
- Standard `.agents` scope / Warning: amber-500
- Diff / Code: orange-500
- Summary: pink-500

**Status:**
- Success: emerald-500
- Warning: amber-500
- Error: red-500 / destructive

---

## Typography

All text is set in **Geist Variable** (by Vercel), with **Geist Mono** for code, timestamps, and technical counters. No other typefaces.

The scale is micro-precise: 10px, 11px, 12px, 13px, 14px, 16px. Most UI copy lives in the 11–13px range. No uppercase tracking labels — hierarchy is expressed through size and opacity, not transformation.

**Scale and roles:**

| Token | Size | Weight | Use |
|---|---|---|---|
| `display` | 30px | 600 | Large numeric stats (usage totals) |
| `heading` | 18px | 600 | Page titles with explicit headers |
| `section-title` | 16px | 600 | Settings section headers, major titles |
| `label-md` | 13px | 500 | Row item names, skill names, issue titles |
| `body-lg` | 14px | 400 | Message bubble text, primary chat content |
| `body-md` | 13px | 400 | General body, settings descriptions |
| `body-sm` / `label-sm` | 12px | 400/500 | Buttons, action bar labels, metadata |
| `label-xs` | 11px | 400 | Skill descriptions, secondary meta, scope labels |
| `caption` | 11px | 400 | Timestamps, breadcrumbs, relationship labels |
| `micro` | 10px | 400 | Token counters, badge counts, trailing labels |
| `micro-mono` | 10px | 400 | Keyboard shortcuts, hash IDs, refs |
| `code-sm` | 11px | 400 | Tool call content, pre blocks in aside |

**Text hierarchy tier system:** Use the four pre-resolved tokens; never add `opacity` on top of them. Contrast ratios are baked in at token definition time (Radix principle).

| Token | Size range | Color token | Contrast |
|---|---|---|---|
| Primary content | 13–30px | `--text-primary` | 15.6:1 AAA |
| Secondary body | 12–14px | `--text-secondary` | 4.54:1 AA |
| Tertiary meta | 10–12px | `--text-tertiary` | 4.53:1 AA |
| Decorative / disabled | any | `--text-dim` | 2.43:1 Exempt |

**`tabular-nums` rule:** All numeric data (counts, timestamps, durations, token usage) must use `tabular-nums` to prevent layout shift during updates.

---

## Layout

Cradle uses a **three-column chrome shell** with a **floating content card** in the center.

```
┌─────────────────────────────────────────────────────────────┐
│                    window chrome (drag region)              │
├──────────────┬─────────────────────────────┬────────────────┤
│              │   ┌─────────────────────┐   │                │
│  AppSidebar  │   │   Content Card      │   │  RightAside    │
│  bg-sidebar  │   │   bg-background     │   │  bg-sidebar    │
│  260px       │   │   rounded-xl        │   │  280px         │
│              │   │   shadow-sm         │   │                │
│              │   │   m-1 mr-2          │   │                │
│              │   └─────────────────────┘   │                │
├──────────────┴─────────────────────────────┴────────────────┤
│                    AppFooter (bg-sidebar)                   │
└─────────────────────────────────────────────────────────────┘
```

**Key layout rules:**
- `bg-sidebar` chrome surrounds the `bg-background` content card. This color difference is the entire depth model.
- The content card uses `rounded-xl shadow-sm` — it appears to float 1px above the chrome floor, but `shadow-sm` is the *only* box-shadow used on layout elements.
- Header: `h-10`, no borders, `bg-sidebar`, with `WebkitAppRegion: drag`.
- Footer: `h-9`, `bg-sidebar`, status bar.
- Content max-widths: `max-w-2xl` (chat messages, ~672px), `max-w-4xl` (usage/reports, ~896px).
- Sidebar animates between 48px (collapsed, icon-only) and 260px (expanded).
- Right aside defaults to 280px, ranges 200–560px.
- Resize handles are 5px wide, visible only on hover.
- Inner page sections use `divide-x divide-border/30` for column dividers (border, not gap).
- No hard layout borders between panel columns — spatial separation from color differentiation only.

**Spacing rhythm:** 4px base unit, 8px standard increment. Component padding follows 8px multiples; micro gaps use 4/6px.

---

## Elevation & Depth

Cradle deliberately avoids "levitating shadows." The depth language has three tiers:

**Tier 1 — Spatial separation (chrome vs. content):**  
The core `bg-sidebar` / `bg-background` split handles all permanent spatial hierarchy. No shadows or borders needed.

**Tier 2 — Surface texture (physical feel):**  
Interactive cards (ActivityCard on dashboard) use `inset-shadow-[0_1px_rgba(255,255,255,0.10)]` — a subtle 1px top edge highlight that makes surfaces feel pressed-in rather than floating. This is the Cradle surface texture.

**Tier 3 — Floating layers (transient):**  
Popovers, dropdowns, mention panels, and command palettes use:
- `shadow-md` (hover previews): small float
- `shadow-xl` + `backdrop-blur-md` (mention panel, modals): maximum context separation  
These are the only elements that truly "float" in the z-axis.

**What NOT to use:**
- `shadow-xs`, `shadow-sm`, `shadow-md` on list items, row hover states, or sidebar items — no elevation for non-floating elements.
- Backdrop blur on static content — reserved for transient overlays only.

---

## Shapes

Shape language is **architectural and compact**. All interactive atoms use small, consistent radius values. Nothing is dramatically round except pills/tags.

| Token | Value | Use |
|---|---|---|
| `rounded-sm` | 6px | Micro badges, tiny chips |
| `rounded-md` | 8px | Row items, buttons, input fields, tab pills |
| `rounded-base` | 10px | Default card radius (`--radius: 0.625rem`) |
| `rounded-lg` | 12px | Sidebar items, scope icon badges, activity cards |
| `rounded-xl` | 16px | Content card, composer, mention panel |
| `rounded-full` | 9999px | Avatar, status dots, pill badges, progress bars |

**Inputs:** `rounded-md` (8px). The composer textarea has `rounded-xl` (16px) as the card container, with `rounded-t-xl` on the inner textarea.

**Tags/chips:** `rounded-md px-1.5 py-0.5` — square-ish, not pill-shaped, to appear as data rather than navigation.

---

## Components

### Chrome Navigation (Sidebar)

The left sidebar is the primary navigation surface. Items are `rounded-lg`, padded `px-2.5 py-1.5`, with `gap-2.5` icon-to-label spacing. Icons are `size-4 text-muted-foreground/70`. The active/hover state uses `hover:bg-accent/50` — no borders, no underlines.

Collapse animation: labels slide out with spring `stiffness:600 damping:40`. The icon persists; the text collapses to `width: 0, opacity: 0`.

Session sub-lists are indented with `ml-5 border-l border-sidebar-border/50 pl-2.5` — a thin vertical guide rail, not separator lines.

**Don't:** Add background fills to inactive sidebar items. Don't add hard left borders for active indication — use background fill only.

### Section Labels

Small structural labels between list groups: `text-[11px] font-medium text-muted-foreground`. No uppercase, no tracking. Often accompanied by a hairline rule (`h-px bg-border/40`) and an optional count badge (`rounded-full bg-muted/60 px-1.5 text-[10px] tabular-nums text-muted-foreground`).

> **Note**: Previously documented as `text-muted-foreground/50`. Opacity modifiers on `muted-foreground` produce ~1.5–2.8:1 contrast (below WCAG AA 4.5:1). Use full `text-muted-foreground` (~4.54:1 AA) for all readable text. See [Text Hierarchy & Contrast](#text-hierarchy--contrast-guarantees).

### List Rows

The universal list item: `flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs hover:bg-accent/50 transition-colors`. Icons at `size-3~3.5` (decorative — opacity modifiers acceptable), titles at full `text-foreground`, metadata after at `text-muted-foreground tabular-nums`.

Hover-reveal actions use `opacity-0 group-hover:opacity-100 transition-opacity` — never visible by default, never consume space.

### Dashboard Activity Cards

Horizontal-scroll cards: `w-32 rounded-lg border border-border/50 overflow-hidden`. Each card has a colored icon zone (`h-14`, category color at `/10` fill + `/60` text) and a white/background text zone (`px-2.5 py-2`). Surface texture: `inset-shadow-[0_1px_rgba(255,255,255,0.10)]`.

Empty/"+" cards: `border-dashed border-border/40`, same dimensions.

### Stat Pills (Usage)

`flex items-center gap-1.5 rounded-full border border-border/40 px-3 py-1`. Label in `micro`, value in `label-sm tabular-nums`. Wrapped in `flex flex-wrap gap-3`.

### Composer

Fixed-bottom input with `bg-background/80 backdrop-blur-sm`. The input card is `rounded-xl border border-border/40 shadow-xs`, with `focus-within:ring-2 focus-within:ring-ring/20` focus ring. Textarea has no border, no background — it's `bg-transparent` inside the card. Action bar is `px-3 py-2 flex items-center justify-between`.

### Message Bubbles

User: `bg-muted rounded-lg rounded-br-sm px-3 py-2 text-sm` — slightly rounded corner indicates the "tail" side without drawing an actual tail.  
Assistant: No bubble background — the text floats on the content card background. Maximum readability.

No avatars in messages. Tiny icons only if role disambiguation is needed.

### Tab Bars (Right Aside)

Active tab uses a **Framer Motion sliding pill** (`layoutId="tab-pill"`, `bg-accent`, `rounded-md`) — animated spring `stiffness:600 damping:40`. Tab buttons are `text-xs`, inactive at `text-muted-foreground`, active at `text-foreground`. No underline indicators, no border indicators.

### Scope Icon Badges

`size-7 rounded-lg flex items-center justify-center` with category color at `bg-[color]-500/10 text-[color]-600`. Category scopes: builtin → violet, standard `.agents` → amber, Cradle-only → sky, workspace → emerald, agent → rose. Dark mode text uses `/400` variants.

### Reasoning / Tool Call Toggles

Expandable disclosure rows: `inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50`. Expanded content indented with `ml-2 border-l-2 border-muted pl-3 text-xs text-muted-foreground leading-relaxed`.

Streaming/active spinner icons use `animate-pulse text-primary/70`.

---

## Do's and Don'ts

### Do
- Use the two-tone chrome/content split as your entire depth model before reaching for shadows.
- Use `inset-shadow` for surface texture on cards and interactive tiles.
- Use `opacity-0 group-hover:opacity-100 transition-opacity` to reveal secondary actions.
- Use `tabular-nums` on all numerical display content.
- Use categorical color pairs: `bg-[color]-500/10 text-[color]-500/60~70`.
- Use spring animations (Framer Motion) for all state transitions; match existing constants (stiffness: 500–600, damping: 35–40).
- Use `text-pretty` on wrapping prose (issue titles, descriptions).
- Use `backdrop-blur` + `bg-popover/95` only for popovers and overlays.

### Don't
- Add `shadow-xs/sm/md` to list rows, sidebar items, or any static UI element.
- Use `uppercase tracking-wider font-semibold` for section labels or headers.
- Reduce primary content text opacity below full (`text-foreground`) — hierarchy comes from size, not opacity washing.
- Use standalone gradient backgrounds for UI surfaces.
- Use emojis in UI.
- Add hard borders between layout columns — let color separation do the work.
- Use `border-b` under column headers inside content cards — use `divide-border/30` or spatial separation.
- Add per-item hover elevation (shadow on hover) — use `hover:bg-accent/50` fill only.
- Use cubic-bezier transitions for elements that should feel physical — use spring.
