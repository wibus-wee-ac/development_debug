// FILE: browser-annotation-adjustment-panel.tsx
// Purpose: Displays and allows editing of browser annotation element style adjustments
// Layer: Browser feature UI
// Depends on: BrowserPanel Zustand store

import { MinusIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { cn } from '~/lib/cn'
import type { BrowserAnnotationDesignChange, BrowserAnnotationElement } from '~/store/browser-panel'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

export interface BrowserAnnotationDesignField {
  key: Exclude<keyof BrowserAnnotationDesignChange, 'comment'>
  label: string
  targetLabel: string
  group: 'Color' | 'Type' | 'Border' | 'Layout' | 'Spacing'
  swatch?: boolean
}

export const DESIGN_FIELDS: BrowserAnnotationDesignField[] = [
  { key: 'color', label: 'Text', targetLabel: 'Text to', group: 'Color', swatch: true },
  { key: 'backgroundColor', label: 'Fill', targetLabel: 'Fill to', group: 'Color', swatch: true },
  { key: 'opacity', label: 'Opacity', targetLabel: 'Opacity to', group: 'Color' },
  { key: 'fontFamily', label: 'Font', targetLabel: 'Font to', group: 'Type' },
  { key: 'fontSize', label: 'Size', targetLabel: 'Size to', group: 'Type' },
  { key: 'fontWeight', label: 'Weight', targetLabel: 'Weight to', group: 'Type' },
  { key: 'borderRadius', label: 'Radius', targetLabel: 'Radius to', group: 'Border' },
  { key: 'borderColor', label: 'Border', targetLabel: 'Border to', group: 'Border', swatch: true },
  { key: 'borderWidth', label: 'Stroke', targetLabel: 'Stroke to', group: 'Border' },
  { key: 'width', label: 'Width', targetLabel: 'Width to', group: 'Layout' },
  { key: 'height', label: 'Height', targetLabel: 'Height to', group: 'Layout' },
  { key: 'display', label: 'Display', targetLabel: 'Display to', group: 'Layout' },
  { key: 'alignItems', label: 'Align', targetLabel: 'Align to', group: 'Layout' },
  { key: 'justifyContent', label: 'Justify', targetLabel: 'Justify to', group: 'Layout' },
  { key: 'flexDirection', label: 'Direction', targetLabel: 'Direction to', group: 'Layout' },
  { key: 'marginTop', label: 'M top', targetLabel: 'M top to', group: 'Spacing' },
  { key: 'marginRight', label: 'M right', targetLabel: 'M right to', group: 'Spacing' },
  { key: 'marginBottom', label: 'M bottom', targetLabel: 'M bottom to', group: 'Spacing' },
  { key: 'marginLeft', label: 'M left', targetLabel: 'M left to', group: 'Spacing' },
  { key: 'paddingTop', label: 'P top', targetLabel: 'P top to', group: 'Spacing' },
  { key: 'paddingRight', label: 'P right', targetLabel: 'P right to', group: 'Spacing' },
  { key: 'paddingBottom', label: 'P bottom', targetLabel: 'P bottom to', group: 'Spacing' },
  { key: 'paddingLeft', label: 'P left', targetLabel: 'P left to', group: 'Spacing' },
  { key: 'rowGap', label: 'Row gap', targetLabel: 'Row gap to', group: 'Spacing' },
  { key: 'columnGap', label: 'Col gap', targetLabel: 'Col gap to', group: 'Spacing' },
]

export const DESIGN_GROUPS = ['Color', 'Type', 'Border', 'Layout', 'Spacing'] as const

function readableStyleValue(value: string): string {
  if (!value || value === 'rgba(0, 0, 0, 0)') {
    return 'transparent'
  }
  return value.replaceAll('"', '')
}

export function elementStyleValue(
  element: BrowserAnnotationElement,
  key: Exclude<keyof BrowserAnnotationDesignChange, 'comment'>,
): string {
  switch (key) {
    case 'color':
      return element.styles.color
    case 'backgroundColor':
      return element.styles.backgroundColor
    case 'opacity':
      return element.styles.opacity
    case 'fontFamily':
      return element.styles.fontFamily
    case 'fontSize':
      return element.styles.fontSize
    case 'fontWeight':
      return element.styles.fontWeight
    case 'borderRadius':
      return element.styles.borderRadius
    case 'borderColor':
      return element.styles.borderColor ?? ''
    case 'borderWidth':
      return element.styles.borderWidth ?? ''
    case 'display':
      return element.styles.display ?? ''
    case 'alignItems':
      return element.styles.alignItems ?? ''
    case 'justifyContent':
      return element.styles.justifyContent ?? ''
    case 'flexDirection':
      return element.styles.flexDirection ?? ''
    case 'width':
      return element.styles.width ?? ''
    case 'height':
      return element.styles.height ?? ''
    case 'marginTop':
      return element.styles.marginTop ?? ''
    case 'marginRight':
      return element.styles.marginRight ?? ''
    case 'marginBottom':
      return element.styles.marginBottom ?? ''
    case 'marginLeft':
      return element.styles.marginLeft ?? ''
    case 'paddingTop':
      return element.styles.paddingTop ?? ''
    case 'paddingRight':
      return element.styles.paddingRight ?? ''
    case 'paddingBottom':
      return element.styles.paddingBottom ?? ''
    case 'paddingLeft':
      return element.styles.paddingLeft ?? ''
    case 'rowGap':
      return element.styles.rowGap ?? ''
    case 'columnGap':
      return element.styles.columnGap ?? ''
  }
}

function parseScrubbableStyleValue(value: string): { number: number, unit: string } | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|rem|em|%)?$/)
  if (!match) {
    return null
  }
  return {
    number: Number(match[1]),
    unit: match[2] ?? '',
  }
}

function formatScrubbableStyleValue(value: { number: number, unit: string }): string {
  const rounded = Math.round(value.number * 100) / 100
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : String(rounded)}${value.unit}`
}

interface StyleRowProps {
  label: string
  value: string
  swatch?: string
}

export function StyleRow({ label, value, swatch }: StyleRowProps) {
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-foreground">
        {swatch !== undefined && (
          <span
            className="size-4 shrink-0 rounded border border-border shadow-sm"
            style={{ backgroundColor: swatch }}
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 truncate font-mono text-[11px] tabular-nums">
          {readableStyleValue(value)}
        </span>
      </span>
    </div>
  )
}

interface DesignInputProps {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  onReset: () => void
}

export function DesignInput({ label, value, placeholder, onChange, onReset }: DesignInputProps) {
  const changed = value.trim().length > 0
  const scrubValue = parseScrubbableStyleValue(value || placeholder)
  const handleScrub = (delta: number) => {
    if (!scrubValue) {
      return
    }
    onChange(formatScrubbableStyleValue({
      number: scrubValue.number + delta,
      unit: scrubValue.unit,
    }))
  }
  return (
    <label className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className={cn('text-muted-foreground', changed && 'text-primary')}>{label}</span>
      <span className="flex min-w-0 items-center gap-1">
        {scrubValue && (
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            onClick={() => handleScrub(-1)}
            aria-label={`Decrease ${label}`}
          >
            <MinusIcon className="size-3.5" />
          </button>
        )}
        <input
          type="text"
          value={value}
          placeholder={readableStyleValue(placeholder)}
          className={cn(
            'h-7 min-w-0 flex-1 rounded-md bg-background px-2 font-mono text-[11px] text-foreground outline-none ring-1 transition-colors placeholder:text-muted-foreground/45 focus:ring-primary/50',
            changed ? 'ring-primary/45' : 'ring-border/70',
          )}
          onChange={event => onChange(event.target.value)}
        />
        {scrubValue && (
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            onClick={() => handleScrub(1)}
            aria-label={`Increase ${label}`}
          >
            <PlusIcon className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
          disabled={!changed}
          onClick={onReset}
          aria-label={`Reset ${label}`}
        >
          <RotateCcwIcon className="size-3.5" />
        </button>
      </span>
    </label>
  )
}

export function BrowserAnnotationAdjustmentPanel() {
  const adjustmentSession = useBrowserPanelStore(state => state.annotationAdjustmentSession)
  const updateDesignChanges = useBrowserPanelStore(state => state.updateAnnotationAdjustmentDesignChanges)
  const openAsideTab = useLayoutStore(state => state.openAsideTab)

  const selectedElement = adjustmentSession?.selectedElement
  const designChanges = adjustmentSession?.designChanges ?? {}

  const fieldsByGroup = useMemo(() => {
    const groups: Record<string, BrowserAnnotationDesignField[]> = {}
    for (const field of DESIGN_FIELDS) {
      if (!groups[field.group]) {
        groups[field.group] = []
      }
      groups[field.group].push(field)
    }
    return groups
  }, [])

  const handleFieldChange = useCallback((key: Exclude<keyof BrowserAnnotationDesignChange, 'comment'>, value: string) => {
    updateDesignChanges({ [key]: value })
  }, [updateDesignChanges])

  const handleFieldReset = useCallback((key: Exclude<keyof BrowserAnnotationDesignChange, 'comment'>) => {
    updateDesignChanges({ [key]: '' })
  }, [updateDesignChanges])

  if (!adjustmentSession || !selectedElement) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">
            Select an element in annotation mode to adjust its styles
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="browser-annotation-adjustment-panel">
      <div className="border-b border-border p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
            {selectedElement.tagName.toLowerCase()}
          </span>
          {selectedElement.label && (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {selectedElement.label}
            </span>
          )}
        </div>
        {selectedElement.selector && (
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {selectedElement.selector}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {DESIGN_GROUPS.map((group) => {
          const fields = fieldsByGroup[group] ?? []
          if (fields.length === 0) {
            return null
          }

          return (
            <div key={group} className="border-b border-border p-3">
              <h3 className="mb-2 text-xs font-semibold text-foreground">{group}</h3>
              <div className="space-y-2">
                {fields.map((field) => {
                  const originalValue = elementStyleValue(selectedElement, field.key)
                  const currentValue = designChanges[field.key] ?? ''
                  const displayValue = currentValue || originalValue

                  if (!originalValue) {
                    return null
                  }

                  return (
                    <DesignInput
                      key={field.key}
                      label={field.label}
                      value={currentValue}
                      placeholder={originalValue}
                      onChange={value => handleFieldChange(field.key, value)}
                      onReset={() => handleFieldReset(field.key)}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-border p-3">
        <div className="text-xs text-muted-foreground">
          <p className="mb-1">Current Styles</p>
          <div className="space-y-1.5">
            <StyleRow
              label="Text"
              value={selectedElement.styles.color}
              swatch={selectedElement.styles.color}
            />
            <StyleRow
              label="Fill"
              value={selectedElement.styles.backgroundColor}
              swatch={selectedElement.styles.backgroundColor}
            />
            <StyleRow
              label="Font"
              value={selectedElement.styles.fontFamily}
            />
            <StyleRow
              label="Size"
              value={selectedElement.styles.fontSize}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
