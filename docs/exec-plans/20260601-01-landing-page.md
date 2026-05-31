# Cradle Landing Page Implementation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

## Purpose / Big Picture

Build a high-quality, modern landing page for Cradle — an AI development orchestrator. The page communicates Cradle's unique positioning: it is not another AI coding tool, but the command center that coordinates all AI coding tools. After this change, visiting the landing page will show an immersive, scroll-driven experience with Canvas-based background effects, GSAP-powered animations, and a clear message hierarchy that conveys Cradle's value proposition in seconds.

User-visible outcome: A visually polished, performant landing page at `apps/landing/` that can be built and served via `pnpm dev` in the landing directory.

## Progress

- [x] (2026-06-01) Project setup: package.json with gsap, tailwindcss, vite
- [x] (2026-06-01) Vite config with Tailwind CSS v4 plugin
- [x] (2026-06-01) Canvas background gradient mesh animation module (src/canvas-bg.ts)
- [x] (2026-06-01) Full HTML/CSS page structure with all sections (index.html + src/style.css)
- [x] (2026-06-01) GSAP animation system (src/animations.ts) — hero timeline, ScrollTrigger batch, parallax, mouse glow, nav opacity
- [x] (2026-06-01) Integration and verification — dev server running, all sections render correctly

## Surprises & Discoveries

(none yet)

## Decision Log

- Decision: Use vanilla TypeScript + Vite (no React) for landing page
  Rationale: Landing pages are static marketing content. React adds unnecessary bundle size and complexity. Vanilla TS with GSAP gives full control and better performance.
  Date: 2026-06-01

- Decision: Tailwind CSS v4 with @tailwindcss/vite plugin
  Rationale: Zero-config, modern CSS approach. Consistent with main app's usage of Tailwind.
  Date: 2026-06-01

- Decision: Canvas for background effects, not WebGL/Three.js
  Rationale: User requested Canvas specifically. Keeps bundle small and avoids GPU compatibility issues. Gradient mesh / noise effects achievable with 2D canvas.
  Date: 2026-06-01

- Decision: GSAP for all animations (scroll-triggered, timeline, entrance)
  Rationale: User explicitly requested GSAP. Gives precise control, great performance, and supports ScrollTrigger for scroll-driven animations.
  Date: 2026-06-01

## Outcomes & Retrospective

Completed successfully. The landing page renders with:
- Animated canvas background (flowing gradient blobs, low-opacity purples/blues)
- Full messaging hierarchy (Hero → Problem → Solution → Features → CTA)
- GSAP-powered animations (hero entrance timeline, ScrollTrigger section reveals, parallax, mouse-following glow)
- Modern minimalist dark design (Linear/Vercel aesthetic)
- Glass-morphism cards, subtle borders, generous spacing
- Responsive design + prefers-reduced-motion support

Tech stack: Vanilla TypeScript + Vite + Tailwind CSS v4 + GSAP (with ScrollTrigger).
No React overhead — pure static page with animation.

## Context and Orientation

The landing page lives at `apps/landing/` in the Cradle monorepo. It is a standalone Vite project with:
- `index.html` — entry point
- `src/main.ts` — main TypeScript entry
- `src/style.css` — global styles (Tailwind)
- `vite.config.ts` — Vite config with Tailwind plugin

Key messaging (from the marketing strategy):
- Hook: "Your AI coding tools are brilliant. Managing them is a mess."
- Position: AI development orchestrator / command center
- Key features: Session Await/Resume, Multi-Agent parallel orchestration, Local-first, Complementary (not replacement), Extensible

Design constraints:
- Modern minimalist (Linear/Vercel aesthetic)
- Blur + light gradients only (no heavy colors, no high-contrast gradients)
- Canvas-based background effects
- GSAP animations throughout
- No emoji in UI

## Plan of Work

### Node A: Canvas Background System (standalone module)
Create `src/canvas-bg.ts` — a self-contained module that renders an animated gradient mesh / flowing noise background on a full-screen canvas. Exports an `initCanvas(container: HTMLElement)` function.

### Node B: Page Structure + Content + Styling
Create the full HTML structure in `index.html` and styles in `src/style.css`. Sections:
1. Nav (minimal, fixed)
2. Hero (hook text + subtle floating elements)
3. Problem (pain point)
4. Solution (what Cradle does)
5. Features (5 cards with icons)
6. CTA / Footer

### Node C: GSAP Animation Integration
Wire up all GSAP animations:
- Hero entrance timeline (text reveal, stagger)
- ScrollTrigger for each section (fade-in, parallax)
- Smooth scrub animations
- Mouse-following subtle effects

## Concrete Steps

1. Spawn Worker A to create `src/canvas-bg.ts`
2. Spawn Worker B to create full page HTML + CSS + content
3. After both complete, spawn Worker C to integrate GSAP animations
4. Verify by running `pnpm dev` in `apps/landing/`

## Validation and Acceptance

Run `cd apps/landing && pnpm dev` — page loads with:
- Animated canvas background
- Smooth hero entrance animation
- Scroll-triggered section reveals
- All messaging visible and correctly structured
- No console errors
- Performant (60fps animations)

## Idempotence and Recovery

All work is file creation/modification in `apps/landing/src/`. Safe to re-run. No migrations or destructive operations.

## Artifacts and Notes

(will be added as work proceeds)

## Interfaces and Dependencies

- `src/canvas-bg.ts`: exports `initCanvas(container: HTMLElement): { destroy(): void }`
- `src/animations.ts`: exports `initAnimations(): void` (registers all GSAP ScrollTriggers and timelines)
- `src/main.ts`: imports and calls both init functions
- `src/style.css`: Tailwind v4 styles with `@import "tailwindcss"`
