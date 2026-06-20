/* Motion constants — mirror apps/web/src/components/layout/right-aside.tsx
   so the tab bar and panel transitions feel identical to the host right-aside. */

export const TAB_SPRING = {
  type: 'spring',
  stiffness: 520,
  damping: 36,
  mass: 0.7,
} as const

export const TAB_LABEL_TRANSITION = {
  width: {
    type: 'spring',
    stiffness: 520,
    damping: 36,
    mass: 0.7,
  },
  opacity: { duration: 0.16, ease: 'easeOut' as const },
  x: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
  filter: { duration: 0.16, ease: 'easeOut' as const },
} as const

export const PANEL_SLIDE_TRANSITION = {
  type: 'spring',
  stiffness: 580,
  damping: 48,
  mass: 0.78,
} as const

export const PANEL_SLIDE_VARIANTS = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0.96,
  }),
  center: { x: '0%', opacity: 1 },
  exit: (direction: number) => ({
    x: direction > 0 ? '-100%' : '100%',
    opacity: 0.96,
  }),
} as const

export const PANEL_INSTANT_VARIANTS = {
  enter: { x: '0%', opacity: 1 },
  center: { x: '0%', opacity: 1 },
  exit: { x: '0%', opacity: 1 },
} as const

export const PANEL_INSTANT_TRANSITION = { duration: 0 } as const

export const TAB_INSTANT_LABEL_TRANSITION = {
  width: PANEL_INSTANT_TRANSITION,
  opacity: PANEL_INSTANT_TRANSITION,
  x: PANEL_INSTANT_TRANSITION,
  filter: PANEL_INSTANT_TRANSITION,
} as const
