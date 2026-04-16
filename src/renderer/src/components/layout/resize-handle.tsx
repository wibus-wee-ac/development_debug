import { cn } from '@renderer/lib/cn'
import { useState } from 'react'

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  /** Current panel size value */
  value: number
  /** Called with the new clamped value on every pointer move */
  onChange: (v: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  min?: number
  max?: number
  /**
   * Negate the drag delta.
   * Use for right-anchored panels (dragging left ↑ width) and
   * bottom-anchored panels (dragging up ↑ height).
   */
  inverted?: boolean
  className?: string
}

export function ResizeHandle({
  direction,
  value,
  onChange,
  onDragStart,
  onDragEnd,
  min = 0,
  max = Infinity,
  inverted = false,
  className,
}: ResizeHandleProps) {
  const [active, setActive] = useState(false)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActive(true)
    onDragStart?.()

    const axis = direction === 'horizontal' ? 'clientX' : 'clientY'
    const start = e[axis]
    const startVal = value

    const onMove = (me: PointerEvent) => {
      const delta = (me[axis] - start) * (inverted ? -1 : 1)
      onChange(Math.max(min, Math.min(max, startVal + delta)))
    }

    const onUp = () => {
      setActive(false)
      onDragEnd?.()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const isH = direction === 'horizontal'

  return (
    <div
      onPointerDown={handlePointerDown}
      className={cn(
        'group relative shrink-0 select-none touch-none z-10',
        isH ? 'w-1.25 cursor-col-resize' : 'h-1.25 cursor-row-resize',
        className,
      )}
    >
      {/* Invisible hit area — only a hairline appears on hover / drag */}
      <div
        className={cn(
          'absolute rounded-full transition-all duration-300',
          isH ? 'inset-y-[10%] inset-x-0.5' : 'inset-x-[10%] inset-y-0.5',
          active ? 'bg-border/40' : 'bg-transparent group-hover:bg-border/20',
        )}
      />
    </div>
  )
}
