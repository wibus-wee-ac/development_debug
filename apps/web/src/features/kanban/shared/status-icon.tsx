// Input: StatusCategory
// Output: SVG status indicator colored by category
// Position: Shared icon component for kanban status visualization

import { cn } from '~/lib/cn'

import type { StatusCategory } from '../use-view-config'

const categoryColors: Record<StatusCategory, string> = {
  triage: '#a855f7',
  backlog: '#6b7280',
  unstarted: '#9ca3af',
  started: '#f59e0b',
  completed: '#22c55e',
  canceled: '#6b7280',
}

export function normalizeStatusCategory(value: unknown): StatusCategory {
  return typeof value === 'string' && value in categoryColors ? value as StatusCategory : 'unstarted'
}

export function StatusIcon({ category, size = 16, className }: {
  category: StatusCategory | string | null | undefined
  size?: number
  className?: string
}) {
  const normalizedCategory = normalizeStatusCategory(category)
  const color = categoryColors[normalizedCategory]
  const r = size / 2 - 2
  const cx = size / 2
  const cy = size / 2

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0', className)}
    >
      {normalizedCategory === 'triage' && (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={2} />
      )}
      {normalizedCategory === 'backlog' && (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="2 2" />
      )}
      {normalizedCategory === 'unstarted' && (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} />
      )}
      {normalizedCategory === 'started' && (
        <>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} />
          <path
            d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r}`}
            fill={color}
          />
        </>
      )}
      {normalizedCategory === 'completed' && (
        <circle cx={cx} cy={cy} r={r} fill={color} />
      )}
      {normalizedCategory === 'canceled' && (
        <>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} />
          <line x1={cx - r + 2} y1={cy} x2={cx + r - 2} y2={cy} stroke={color} strokeWidth={1.5} />
        </>
      )}
    </svg>
  )
}
