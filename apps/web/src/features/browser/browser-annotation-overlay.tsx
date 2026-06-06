import type { FileUIPart } from 'ai'
import {
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  ImagePlusIcon,
  Maximize2Icon,
  MessageSquarePlusIcon,
  MinusIcon,
  MousePointer2Icon,
  PaletteIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SquareMousePointerIcon,
  TypeIcon,
  XIcon,
} from 'lucide-react'
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'
import type {
  BrowserAnnotationAnchor,
  BrowserAnnotationDesignChange,
  BrowserAnnotationElement,
  BrowserAnnotationRecord,
  BrowserAnnotationRegion,
} from '~/store/browser-panel'

export interface BrowserAnnotationSurfaceSize {
  width: number
  height: number
}

interface BrowserAnnotationOverlayProps {
  imageDataUrl: string
  elements: BrowserAnnotationElement[]
  surfaceSize: BrowserAnnotationSurfaceSize
  submitting: boolean
  initialAnnotation?: BrowserAnnotationRecord | null
  onCancel: () => void
  onSave: (input: BrowserAnnotationOverlaySubmitInput) => void
  onSubmit: (input: BrowserAnnotationOverlaySubmitInput) => void
}

export interface BrowserAnnotationOverlaySubmitInput {
  body: string
  anchor: BrowserAnnotationAnchor
  attachedImages: FileUIPart[]
  designChange: BrowserAnnotationDesignChange | null
}

interface DragState {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

interface EditorDragState {
  startClientX: number
  startClientY: number
  startLeft: number
  startTop: number
}

interface BrowserAnnotationAttachedImage {
  id: string
  filePart: FileUIPart
}

interface BrowserAnnotationDesignField {
  key: Exclude<keyof BrowserAnnotationDesignChange, 'comment'>
  label: string
  targetLabel: string
  group: 'Color' | 'Type' | 'Border' | 'Layout' | 'Spacing'
  swatch?: boolean
}

type BrowserAnnotationEditorMode = 'comment' | 'design'

const MIN_REGION_SIZE = 12
const PANEL_WIDTH = 360
const PANEL_MIN_VISIBLE = 72
const DESIGN_FIELDS: BrowserAnnotationDesignField[] = [
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
const DESIGN_GROUPS = ['Color', 'Type', 'Border', 'Layout', 'Spacing'] as const
let nextAttachedImageId = 0

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function buildRegion(drag: DragState): BrowserAnnotationRegion {
  const x = Math.min(drag.startX, drag.currentX)
  const y = Math.min(drag.startY, drag.currentY)
  return {
    kind: 'region',
    x,
    y,
    width: Math.abs(drag.currentX - drag.startX),
    height: Math.abs(drag.currentY - drag.startY),
  }
}

function anchorSummary(anchor: BrowserAnnotationAnchor | null): string {
  if (!anchor) {
    return 'Click an element or drag a region'
  }
  if (anchor.kind === 'point') {
    return `Point at ${Math.round(anchor.x)}, ${Math.round(anchor.y)}`
  }
  if (anchor.kind === 'element') {
    return `<${anchor.element.tagName.toLowerCase()}> ${anchor.element.label || anchor.element.role}`
  }
  return `Region ${Math.round(anchor.width)} x ${Math.round(anchor.height)}`
}

function editorPosition(anchor: BrowserAnnotationAnchor | null, surface: BrowserAnnotationSurfaceSize) {
  const fallback = {
    left: Math.max(12, surface.width - 344 - 12),
    top: Math.max(12, surface.height - 180 - 12),
  }
  if (!anchor) {
    return fallback
  }

  const anchorRight = anchor.kind === 'region'
    ? anchor.x + anchor.width
    : anchor.kind === 'element'
      ? anchor.element.rect.x + anchor.element.rect.width
      : anchor.x
  const anchorBottom = anchor.kind === 'region'
    ? anchor.y + anchor.height
    : anchor.kind === 'element'
      ? anchor.element.rect.y + anchor.element.rect.height
      : anchor.y
  return {
    left: clamp(anchorRight + 12, 12, Math.max(12, surface.width - PANEL_WIDTH - 12)),
    top: clamp(anchorBottom + 12, 12, Math.max(12, surface.height - 300 - 12)),
  }
}

function elementAtPoint(
  elements: BrowserAnnotationElement[],
  point: { x: number, y: number },
): BrowserAnnotationElement | null {
  let best: BrowserAnnotationElement | null = null
  let bestArea = Number.POSITIVE_INFINITY
  for (const element of elements) {
    const rect = element.rect
    if (
      point.x < rect.x
      || point.y < rect.y
      || point.x > rect.x + rect.width
      || point.y > rect.y + rect.height
    ) {
      continue
    }
    const area = rect.width * rect.height
    if (area < bestArea) {
      best = element
      bestArea = area
    }
  }
  return best
}

function readableStyleValue(value: string): string {
  if (!value || value === 'rgba(0, 0, 0, 0)') {
    return 'transparent'
  }
  return value.replaceAll('"', '')
}

function elementStyleValue(
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

function elementSearchText(element: BrowserAnnotationElement): string {
  return [
    element.tagName,
    element.label,
    element.description,
    element.role,
    element.selector,
    element.attributes?.id,
    element.attributes?.className,
    element.attributes?.ariaLabel,
    element.attributes?.title,
    element.attributes?.alt,
    element.attributes?.href,
    element.attributes?.type,
    element.attributes?.name,
    element.attributes?.placeholder,
    element.attributes?.value,
    element.attributes?.testId,
  ].join(' ').toLowerCase()
}

function StyleRow({
  label,
  value,
  swatch,
}: {
  label: string
  value: string
  swatch?: string
}) {
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

function normalizeDesignChange(input: BrowserAnnotationDesignChange): BrowserAnnotationDesignChange | null {
  const next = Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''])
      .filter(([, value]) => value.length > 0),
  ) as BrowserAnnotationDesignChange

  return Object.keys(next).length > 0 ? next : null
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

function readImageFilePart(file: File): Promise<BrowserAnnotationAttachedImage | null> {
  if (!file.type.startsWith('image/')) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        resolve(null)
        return
      }
      resolve({
        id: `browser-annotation-image-${nextAttachedImageId++}`,
        filePart: {
          type: 'file',
          filename: file.name,
          mediaType: file.type,
          url: reader.result,
        },
      })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

function DesignInput({
  label,
  value,
  placeholder,
  onChange,
  onReset,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  onReset: () => void
}) {
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

export function BrowserAnnotationOverlay({
  imageDataUrl,
  elements,
  surfaceSize,
  submitting,
  initialAnnotation = null,
  onCancel,
  onSave,
  onSubmit,
}: BrowserAnnotationOverlayProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const [anchor, setAnchor] = useState<BrowserAnnotationAnchor | null>(
    () => initialAnnotation?.anchor ?? null,
  )
  const [draft, setDraft] = useState(() => initialAnnotation?.body ?? '')
  const [designDraft, setDesignDraft] = useState<BrowserAnnotationDesignChange>(
    () => initialAnnotation?.designChange ?? {},
  )
  const [attachedImages, setAttachedImages] = useState<BrowserAnnotationAttachedImage[]>(
    () =>
      initialAnnotation?.attachedImages.map(filePart => ({
        id: `browser-annotation-image-${nextAttachedImageId++}`,
        filePart,
      })) ?? [],
  )
  const [drag, setDrag] = useState<DragState | null>(null)
  const [isDraggingImages, setIsDraggingImages] = useState(false)
  const [editorOverride, setEditorOverride] = useState<{ left: number, top: number } | null>(null)
  const [editorDrag, setEditorDrag] = useState<EditorDragState | null>(null)
  const [hoveredElement, setHoveredElement] = useState<BrowserAnnotationElement | null>(null)
  const [elementQuery, setElementQuery] = useState('')
  const [elementOutlinesEnabled, setElementOutlinesEnabled] = useState(true)
  const [originalViewEnabled, setOriginalViewEnabled] = useState(false)
  const [previewImage, setPreviewImage] = useState<BrowserAnnotationAttachedImage | null>(null)
  const [editorMode, setEditorMode] = useState<BrowserAnnotationEditorMode>(
    () => initialAnnotation?.designChange ? 'design' : 'comment',
  )
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(
    () => initialAnnotation?.designChange !== null || initialAnnotation === null,
  )

  const visibleRegion = drag ? buildRegion(drag) : anchor?.kind === 'region' ? anchor : null
  const selectedElement = anchor?.kind === 'element' ? anchor.element : null
  const filteredElements = useMemo(() => {
    const query = elementQuery.trim().toLowerCase()
    if (!query) {
      return elements.slice(0, 40)
    }
    return elements.filter(element => elementSearchText(element).includes(query)).slice(0, 40)
  }, [elementQuery, elements])
  const framedElement = selectedElement ?? hoveredElement
  const HeaderIcon = selectedElement ? TypeIcon : MessageSquarePlusIcon
  const anchoredEditor = useMemo(() => editorPosition(anchor, surfaceSize), [anchor, surfaceSize])
  const editor = editorOverride ?? anchoredEditor

  const readSurfacePoint = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) {
      return null
    }
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    }
  }, [])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) {
      return
    }
    const point = readSurfacePoint(event)
    if (!point) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    })
  }, [readSurfacePoint])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const point = readSurfacePoint(event)
    if (!point) {
      return
    }
    if (!drag) {
      setHoveredElement(elementAtPoint(elements, point))
      return
    }
    event.preventDefault()
    setDrag({
      ...drag,
      currentX: point.x,
      currentY: point.y,
    })
  }, [drag, elements, readSurfacePoint])

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) {
      return
    }
    event.preventDefault()
    event.currentTarget.releasePointerCapture(event.pointerId)
    const region = buildRegion(drag)
    if (region.width >= MIN_REGION_SIZE && region.height >= MIN_REGION_SIZE) {
      setAnchor(region)
      setEditorMode('comment')
      setDesignDraft({})
      setEditorOverride(null)
    }
    else {
      const element = elementAtPoint(elements, { x: drag.startX, y: drag.startY })
      setAnchor(element
        ? { kind: 'element', element }
        : {
            kind: 'point',
            x: drag.startX,
            y: drag.startY,
          })
      if (element) {
        setEditorMode('comment')
      }
      else {
        setEditorMode('comment')
      }
      setDesignDraft({})
      setEditorOverride(null)
    }
    setDrag(null)
  }, [drag, elements])

  const handleEditorPointerMove = useCallback((event: ReactPointerEvent<HTMLFormElement>) => {
    if (!editorDrag) {
      return
    }
    event.preventDefault()
    const nextLeft = editorDrag.startLeft + event.clientX - editorDrag.startClientX
    const nextTop = editorDrag.startTop + event.clientY - editorDrag.startClientY
    setEditorOverride({
      left: clamp(nextLeft, 8, Math.max(8, surfaceSize.width - PANEL_MIN_VISIBLE)),
      top: clamp(nextTop, 8, Math.max(8, surfaceSize.height - PANEL_MIN_VISIBLE)),
    })
  }, [editorDrag, surfaceSize.height, surfaceSize.width])

  const handleEditorPointerUp = useCallback((event: ReactPointerEvent<HTMLFormElement>) => {
    if (!editorDrag) {
      return
    }
    event.preventDefault()
    event.currentTarget.releasePointerCapture(event.pointerId)
    setEditorDrag(null)
  }, [editorDrag])

  const designChange = selectedElement && editorMode === 'design'
    ? normalizeDesignChange(designDraft)
    : null
  const designChangeCount = designChange ? Object.keys(designChange).length : 0
  const canSubmit = Boolean(anchor)
    && (draft.trim().length > 0 || designChange !== null || attachedImages.length > 0)
    && !submitting
  const buildSubmitInput = useCallback((): BrowserAnnotationOverlaySubmitInput | null => {
    if (!anchor || !canSubmit) {
      return null
    }
    return {
      body: draft.trim(),
      anchor,
      attachedImages: attachedImages.map(image => image.filePart),
      designChange,
    }
  }, [anchor, attachedImages, canSubmit, designChange, draft])

  const appendImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return
    }
    const nextImages = (await Promise.all(files.map(readImageFilePart)))
      .filter((image): image is BrowserAnnotationAttachedImage => image !== null)
    if (nextImages.length === 0) {
      return
    }
    setAttachedImages(previous => [...previous, ...nextImages])
  }, [])

  const handleImagesSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    await appendImageFiles(files)
  }, [appendImageFiles])

  const handlePaste = useCallback((event: ReactClipboardEvent<HTMLFormElement>) => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'))
    if (files.length === 0) {
      return
    }
    event.preventDefault()
    void appendImageFiles(files)
  }, [appendImageFiles])

  const handleDrag = useCallback((event: ReactDragEvent<HTMLFormElement>) => {
    const hasImages = Array.from(event.dataTransfer.items)
      .some(item => item.kind === 'file' && item.type.startsWith('image/'))
    if (!hasImages) {
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    return true
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        const input = buildSubmitInput()
        if (!input) {
          return
        }
        onSubmit(input)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [buildSubmitInput, onCancel, onSubmit])

  return (
    <div
      className="absolute inset-0 z-30 overflow-hidden bg-background"
      data-testid="browser-annotation-overlay"
    >
      <img
        src={imageDataUrl}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 size-full select-none object-fill"
        draggable={false}
      />
      {!originalViewEnabled && <div className="absolute inset-0 bg-black/5" aria-hidden="true" />}
      {!originalViewEnabled && (
        <div
          ref={surfaceRef}
          className="absolute inset-0 cursor-crosshair touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          {framedElement && (
            <span
              className={cn(
                'pointer-events-none absolute rounded-sm border bg-primary/10 shadow-[0_0_0_1px_rgba(255,255,255,0.4)]',
                selectedElement ? 'border-primary' : 'border-primary/70',
              )}
              data-testid="browser-annotation-selected-frame"
              style={{
                left: framedElement.rect.x,
                top: framedElement.rect.y,
                width: framedElement.rect.width,
                height: framedElement.rect.height,
              }}
              aria-hidden="true"
            >
              <span className="absolute -left-px -top-6 flex h-5 items-center gap-1 rounded-t-sm bg-primary px-1.5 text-[10px] font-medium text-primary-foreground shadow-sm">
                <SquareMousePointerIcon className="size-3" />
                {framedElement.tagName.toLowerCase()}
              </span>
            </span>
          )}
          {anchor?.kind === 'point' && (
            <span
              className="pointer-events-none absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-primary/20"
              style={{ left: anchor.x, top: anchor.y }}
              aria-hidden="true"
            >
              <MousePointer2Icon className="size-4" />
            </span>
          )}
          {visibleRegion && (
            <span
              className="pointer-events-none absolute rounded-md border border-primary bg-primary/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.22)]"
              style={{
                left: visibleRegion.x,
                top: visibleRegion.y,
                width: visibleRegion.width,
                height: visibleRegion.height,
              }}
              aria-hidden="true"
            />
          )}
          {elementOutlinesEnabled && !framedElement && !visibleRegion && (
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {filteredElements.slice(0, 80).map(element => (
                <span
                  key={element.id}
                  className="absolute rounded-sm border border-primary/30 bg-primary/[0.03]"
                  style={{
                    left: element.rect.x,
                    top: element.rect.y,
                    width: element.rect.width,
                    height: element.rect.height,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-background/90 px-3 py-2 text-xs text-foreground shadow-lg ring-1 ring-border/70 backdrop-blur">
        <MessageSquarePlusIcon className="size-4 text-primary" aria-hidden="true" />
        <span>{anchorSummary(anchor)}</span>
        {elements.length > 0 && (
          <span className="rounded bg-foreground/7 px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
            {`${elements.length} elements`}
          </span>
        )}
        <button
          type="button"
          className={cn(
            'ml-1 flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] transition-colors',
            originalViewEnabled
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
          )}
          onClick={() => setOriginalViewEnabled(enabled => !enabled)}
          aria-pressed={originalViewEnabled}
        >
          <EyeIcon className="size-3" />
          Original
        </button>
      </div>

      {!originalViewEnabled && elements.length > 0 && (
        <div
          className="absolute left-3 top-14 flex max-h-[min(420px,calc(100%-96px))] w-72 flex-col overflow-hidden rounded-lg bg-background/92 shadow-lg ring-1 ring-border/70 backdrop-blur"
          data-testid="browser-annotation-elements-panel"
        >
          <div className="border-b border-border/60 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-foreground">Elements</div>
              <button
                type="button"
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[10px] transition-colors',
                  elementOutlinesEnabled
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                )}
                onClick={() => setElementOutlinesEnabled(enabled => !enabled)}
                aria-pressed={elementOutlinesEnabled}
              >
                Outlines
              </button>
            </div>
            <label className="flex h-8 items-center gap-2 rounded-md bg-foreground/5 px-2 text-xs text-muted-foreground ring-1 ring-border/50">
              <SearchIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={elementQuery}
                placeholder="Find elements"
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60"
                onChange={event => setElementQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="min-h-0 overflow-y-auto p-1">
            {filteredElements.length === 0 && (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                No matching elements
              </div>
            )}
            {filteredElements.map((element) => {
              const selected = selectedElement?.id === element.id
              return (
                <button
                  key={element.id}
                  type="button"
                  data-testid={`browser-annotation-element-row-${element.id}`}
                  className={cn(
                    'flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                    selected
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-foreground/5',
                  )}
                  onPointerEnter={() => setHoveredElement(element)}
                  onPointerLeave={() => {
                    setHoveredElement(previous => previous?.id === element.id ? null : previous)
                  }}
                  onClick={() => {
                    setAnchor({ kind: 'element', element })
                    setEditorMode('comment')
                    setDesignDraft({})
                    setEditorOverride(null)
                  }}
                >
                  <span className="mt-0.5 shrink-0 rounded bg-foreground/7 px-1 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                    {element.tagName.toLowerCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {element.label || element.role || element.selector}
                    </span>
                    {element.description && (
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {element.description}
                      </span>
                    )}
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                      {element.selector}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {!originalViewEnabled && (
        <form
          className="absolute w-[360px] rounded-lg bg-background/95 p-3 shadow-xl ring-1 ring-border/80 backdrop-blur"
          data-testid="browser-annotation-editor"
          style={{ left: editor.left, top: editor.top }}
          onPointerMove={handleEditorPointerMove}
          onPointerUp={handleEditorPointerUp}
          onPointerCancel={() => setEditorDrag(null)}
          onPaste={handlePaste}
          onDragEnter={(event) => {
            if (handleDrag(event)) {
              setIsDraggingImages(true)
            }
          }}
          onDragOver={handleDrag}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsDraggingImages(false)
            }
          }}
          onDrop={(event) => {
            if (!handleDrag(event)) {
              return
            }
            setIsDraggingImages(false)
            void appendImageFiles(Array.from(event.dataTransfer.files))
          }}
          onSubmit={(event) => {
            event.preventDefault()
            const input = buildSubmitInput()
            if (!input) {
              return
            }
            onSubmit(input)
          }}
        >
          {isDraggingImages && (
            <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-md bg-primary/10 text-xs font-medium text-primary ring-1 ring-primary/30 backdrop-blur-sm">
              Drop images to attach
            </div>
          )}
          <div
            className="mb-2 flex cursor-grab items-center justify-between gap-2 active:cursor-grabbing"
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) {
                return
              }
              if (event.target instanceof Element && event.target.closest('button,input,textarea,label')) {
                return
              }
              const form = event.currentTarget.closest('form')
              if (!form) {
                return
              }
              event.preventDefault()
              form.setPointerCapture(event.pointerId)
              setEditorDrag({
                startClientX: event.clientX,
                startClientY: event.clientY,
                startLeft: editor.left,
                startTop: editor.top,
              })
            }}
          >
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
              <HeaderIcon className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 truncate">
                {selectedElement
                  ? `<${selectedElement.tagName.toLowerCase()}>`
                  : 'Browser annotation'}
              </span>
            </div>
            <button
              type="button"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              onClick={onCancel}
              aria-label="Cancel annotation"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
          {selectedElement && (
            <div className="mb-3 space-y-3 rounded-md bg-foreground/5 p-2.5">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-foreground">
                    {selectedElement.label || selectedElement.role || selectedElement.selector}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                    {selectedElement.selector}
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-2 rounded-md bg-background p-0.5 text-[10px] ring-1 ring-border/70">
                  <button
                    type="button"
                    className={cn(
                      'h-6 rounded px-2 transition-colors',
                      editorMode === 'comment'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setEditorMode('comment')}
                    aria-pressed={editorMode === 'comment'}
                  >
                    Comment
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'h-6 rounded px-2 transition-colors',
                      editorMode === 'design'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => {
                      setEditorMode('design')
                      setAdjustmentsOpen(true)
                    }}
                    aria-pressed={editorMode === 'design'}
                  >
                    Design
                  </button>
                </div>
              </div>
              {editorMode === 'design' && (
                <>
                  <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                    {DESIGN_GROUPS.map((group) => {
                      const fields = DESIGN_FIELDS.filter(field => field.group === group)
                      return (
                        <div key={group} className="space-y-1.5">
                          <div className="text-[10px] font-medium uppercase text-muted-foreground">
                            {group}
                          </div>
                          {fields.map(field => (
                            <StyleRow
                              key={field.key}
                              label={field.label}
                              value={elementStyleValue(selectedElement, field.key)}
                              swatch={field.swatch ? elementStyleValue(selectedElement, field.key) : undefined}
                            />
                          ))}
                        </div>
                      )
                    })}
                  </div>
                  <div className="border-t border-border/70 pt-2">
                    <button
                      type="button"
                      className="flex h-8 w-full items-center justify-between rounded-md px-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5"
                      onClick={() => setAdjustmentsOpen(open => !open)}
                      aria-expanded={adjustmentsOpen}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <SlidersHorizontalIcon className="size-3.5 shrink-0 text-primary" />
                        <span>Adjustments</span>
                        {designChangeCount > 0 && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary tabular-nums">
                            {designChangeCount}
                          </span>
                        )}
                      </span>
                      <ChevronDownIcon
                        className={cn(
                          'size-3.5 shrink-0 text-muted-foreground transition-transform',
                          adjustmentsOpen && 'rotate-180',
                        )}
                      />
                    </button>
                    {adjustmentsOpen && (
                      <div className="space-y-1.5 pt-1.5">
                        {designChangeCount > 0 && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                              onClick={() => setDesignDraft({})}
                            >
                              <RotateCcwIcon className="size-3" />
                              Reset all
                            </button>
                          </div>
                        )}
                        {DESIGN_GROUPS.map((group) => {
                          const fields = DESIGN_FIELDS.filter(field => field.group === group)
                          return (
                            <div key={group} className="space-y-1.5 rounded-md bg-foreground/[0.03] p-1.5">
                              <div className="px-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                                {group}
                              </div>
                              {fields.map(field => (
                                <DesignInput
                                  key={field.key}
                                  label={field.targetLabel}
                                  value={designDraft[field.key] ?? ''}
                                  placeholder={elementStyleValue(selectedElement, field.key)}
                                  onChange={value =>
                                    setDesignDraft(previous => ({ ...previous, [field.key]: value }))}
                                  onReset={() =>
                                    setDesignDraft(({ [field.key]: _removed, ...rest }) => rest)}
                                />
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <Textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder={selectedElement && editorMode === 'design' ? 'Describe the design change' : 'Comment'}
            className="min-h-20 resize-none bg-background text-sm"
            autoFocus
          />
        {attachedImages.length > 0 && (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {attachedImages.map((image) => {
              const label = image.filePart.filename ?? image.filePart.mediaType
              return (
                <div
                  role="button"
                  tabIndex={0}
                  key={image.id}
                  className="group relative size-14 shrink-0 overflow-hidden rounded-md bg-muted shadow-[inset_0_0_0_1px_rgba(0,0,0,0.10)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
                  onClick={() => setPreviewImage(image)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setPreviewImage(image)
                    }
                  }}
                  aria-label={`Preview ${label}`}
                >
                  <img src={image.filePart.url} alt={label} className="size-full object-cover" />
                  <span className="absolute bottom-1 left-1 flex size-5 items-center justify-center rounded-sm bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                    <Maximize2Icon className="size-3" />
                  </span>
                  <button
                    type="button"
                    className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-sm bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation()
                      setAttachedImages(previous => previous.filter(item => item.id !== image.id))
                    }}
                    aria-label={`Remove ${label}`}
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {anchorSummary(anchor)}
          </span>
          <div className="flex items-center gap-1">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImagesSelected}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => imageInputRef.current?.click()}
              aria-label="Attach images"
            >
              <ImagePlusIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canSubmit}
              onClick={() => {
                const input = buildSubmitInput()
                if (input) {
                  onSave(input)
                }
              }}
            >
              Save
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit} className="gap-1.5">
              {selectedElement && editorMode === 'design' && !submitting && <PaletteIcon className="size-3.5" />}
              {(!selectedElement || editorMode === 'comment') && !submitting && <CheckIcon className="size-3.5" />}
              {submitting ? 'Sending...' : 'Send'}
            </Button>
          </div>
        </div>
        </form>
      )}

      <button
        type="button"
        className={cn(
          'absolute bottom-3 left-3 rounded-md bg-background/90 px-2.5 py-1.5 text-xs text-muted-foreground shadow-lg ring-1 ring-border/70 backdrop-blur',
          'transition-colors hover:bg-background hover:text-foreground',
        )}
        onClick={onCancel}
      >
        Exit annotate
      </button>
      {previewImage && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${previewImage.filePart.filename ?? previewImage.filePart.mediaType}`}
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-h-full max-w-full" onClick={event => event.stopPropagation()}>
            <img
              src={previewImage.filePart.url}
              alt={previewImage.filePart.filename ?? 'Attached image'}
              className="max-h-[calc(100vh-96px)] max-w-[calc(100vw-96px)] rounded-lg object-contain shadow-2xl ring-1 ring-white/20"
            />
            <button
              type="button"
              className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
              onClick={() => setPreviewImage(null)}
              aria-label="Close image preview"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
