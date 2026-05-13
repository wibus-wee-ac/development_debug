// Input: DailyUsage[] data from IPC
// Output: UsageHeatmap — smooth rounded GitHub-style contribution heatmap
// Position: Core visual component of the usage dashboard

import { memo, useMemo, useRef, useState } from 'react'

interface DailyUsage {
  date: string
  totalTokens: number
  promptTokens: number
  completionTokens: number
  count: number
}

interface UsageHeatmapProps {
  data: DailyUsage[]
  days?: number
}

const CELL_SIZE = 13
const CELL_GAP = 3
const CELL_RADIUS = 3.5
const WEEKS = 53
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Build a map of 53×7 cells spanning today back ~371 days. */
function buildGrid(data: DailyUsage[]): {
  cells: Array<{ date: string, week: number, day: number, tokens: number, usage: DailyUsage | null }>
  monthLabels: Array<{ label: string, week: number }>
  maxTokens: number
} {
  const lookup = new Map(data.map(d => [d.date, d]))

  const today = new Date()
  const todayDay = today.getDay() // 0=Sun
  // Start from the Sunday of the earliest week
  const start = new Date(today)
  start.setDate(start.getDate() - (WEEKS - 1) * 7 - todayDay)

  const cells: Array<{ date: string, week: number, day: number, tokens: number, usage: DailyUsage | null }> = []
  const monthStarts = new Map<number, number>() // month → earliest week index
  let maxTokens = 0

  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(start)
      cellDate.setDate(cellDate.getDate() + w * 7 + d)

      // Don't render future dates
      if (cellDate > today) {
        continue
      }

      const dateStr = getDateString(cellDate)
      const usage = lookup.get(dateStr) ?? null
      const tokens = usage?.totalTokens ?? 0
      if (tokens > maxTokens) {
        maxTokens = tokens
      }
      cells.push({ date: dateStr, week: w, day: d, tokens, usage })

      // Track month label positions
      const month = cellDate.getMonth()
      if (!monthStarts.has(month) || w < monthStarts.get(month)!) {
        monthStarts.set(month, w)
      }
    }
  }

  const monthLabels = Array.from(monthStarts.entries())
    .sort(([, a], [, b]) => a - b)
    .map(([month, week]) => ({ label: MONTH_NAMES[month], week }))

  return { cells, monthLabels, maxTokens }
}

/** Interpolate between transparent and accent color based on intensity (0–1). */
function cellColor(intensity: number): string {
  if (intensity === 0) {
    return 'var(--color-muted-foreground)'
  }
  // Use CSS oklch for smooth perceptual interpolation
  const l = 0.75 - intensity * 0.25 // lightness: 0.75 → 0.50
  const c = 0.05 + intensity * 0.15 // chroma: 0.05 → 0.20
  const h = 160 // green hue
  return `oklch(${l} ${c} ${h})`
}

function UsageHeatmapInner({ data }: UsageHeatmapProps) {
  const { cells, monthLabels, maxTokens } = useMemo(() => buildGrid(data), [data])
  const [hoveredCell, setHoveredCell] = useState<typeof cells[number] | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)

  const leftPad = 32 // space for day labels
  const topPad = 20 // space for month labels
  const svgWidth = leftPad + WEEKS * (CELL_SIZE + CELL_GAP)
  const svgHeight = topPad + 7 * (CELL_SIZE + CELL_GAP)

  const handleMouseMove = (e: React.MouseEvent, cell: typeof cells[number]) => {
    setTooltipPos({ x: e.clientX, y: e.clientY })
    setHoveredCell(cell)
  }

  return (
    <div data-testid="usage-heatmap">
      <svg
        ref={svgRef}
        width={svgWidth}
        height={svgHeight}
        className="select-none mx-auto"
      >
        {/* Month labels */}
        {monthLabels.map(({ label, week }) => (
          <text
            key={`${label}-${week}`}
            x={leftPad + week * (CELL_SIZE + CELL_GAP)}
            y={12}
            className="fill-muted-foreground/50 text-[10px]"
          >
            {label}
          </text>
        ))}

        {/* Day labels */}
        {DAY_LABELS.map((label, i) =>
          label
            ? (
              <text
                key={`day-${label}`}
                x={0}
                y={topPad + i * (CELL_SIZE + CELL_GAP) + CELL_SIZE * 0.75}
                className="fill-muted-foreground/40 text-[10px]"
              >
                {label}
              </text>
            )
            : null)}

        {/* Cells */}
        {cells.map((cell) => {
          const intensity = maxTokens > 0 ? cell.tokens / maxTokens : 0
          const x = leftPad + cell.week * (CELL_SIZE + CELL_GAP)
          const y = topPad + cell.day * (CELL_SIZE + CELL_GAP)
          const isHovered = hoveredCell?.date === cell.date
          return (
            <rect
              key={cell.date}
              x={x}
              y={y}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={CELL_RADIUS}
              ry={CELL_RADIUS}
              data-testid="usage-heatmap-cell"
              data-date={cell.date}
              data-has-usage={cell.tokens > 0 ? 'true' : 'false'}
              fill={cellColor(intensity)}
              opacity={intensity === 0 ? 0.08 : 1}
              stroke={isHovered ? 'var(--color-foreground)' : 'none'}
              strokeWidth={isHovered ? 1.5 : 0}
              className="transition-opacity duration-150"
              onMouseMove={e => handleMouseMove(e, cell)}
              onMouseLeave={() => setHoveredCell(null)}
            />
          )
        })}
      </svg>

      {/* Tooltip */}
      {hoveredCell && (
        <div
          data-testid="usage-heatmap-tooltip"
          className="pointer-events-none fixed z-50 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md"
          style={{
            left: tooltipPos.x + 12,
            top: tooltipPos.y - 50,
          }}
        >
          <p className="text-xs font-medium text-foreground" data-testid="usage-heatmap-tooltip-date">
            {hoveredCell.date}
          </p>
          {hoveredCell.tokens > 0
            ? (
              <div className="mt-1 space-y-0.5">
                <p className="text-[11px] text-muted-foreground" data-testid="usage-heatmap-tooltip-metrics">
                  {hoveredCell.tokens.toLocaleString()}
                  {' '}
                  tokens
                  {' '}
                  ·
                  {' '}
                  {hoveredCell.usage?.count ?? 0}
                  {' '}
                  turns
                </p>
              </div>
            )
            : (
              <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="usage-heatmap-tooltip-metrics">No usage</p>
            )}
        </div>
      )}
    </div>
  )
}

export const UsageHeatmap = memo(UsageHeatmapInner)
