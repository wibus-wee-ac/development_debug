import type { FileUIPart } from 'ai'
import {
  CheckIcon,
  ImagePlusIcon,
  Maximize2Icon,
  MousePointer2Icon,
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
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

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

const MIN_REGION_SIZE = 12
const PANEL_WIDTH = 360
const PANEL_MIN_VISIBLE = 72
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
  const setAnnotationAdjustmentSession = useBrowserPanelStore(state => state.setAnnotationAdjustmentSession)
  const openAsideTab = useLayoutStore(state => state.openAsideTab)
  const setAsideOpen = useLayoutStore(state => state.setAsideOpen)

  const [anchor, setAnchor] = useState<BrowserAnnotationAnchor | null>(
    () => initialAnnotation?.anchor ?? null,
  )
  const [draft, setDraft] = useState(() => initialAnnotation?.body ?? '')
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
  const [previewImage, setPreviewImage] = useState<BrowserAnnotationAttachedImage | null>(null)

  const visibleRegion = drag ? buildRegion(drag) : anchor?.kind === 'region' ? anchor : null
  const selectedElement = anchor?.kind === 'element' ? anchor.element : null
  const framedElement = selectedElement ?? hoveredElement
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
        setAnnotationAdjustmentSession({
          ownerId: 'global',
          tabId: 'current',
          annotationId: null,
          selectedElement: element,
          designChanges: {},
        })
        openAsideTab('adjustment')
        setAsideOpen(true)
      }
      setEditorOverride(null)
    }
    setDrag(null)
  }, [drag, elements, setAnnotationAdjustmentSession, openAsideTab, setAsideOpen])

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

  const canSubmit = Boolean(anchor)
    && (draft.trim().length > 0 || attachedImages.length > 0)
    && !submitting
  const buildSubmitInput = useCallback((): BrowserAnnotationOverlaySubmitInput | null => {
    if (!anchor || !canSubmit) {
      return null
    }
    return {
      body: draft.trim(),
      anchor,
      attachedImages: attachedImages.map(image => image.filePart),
      designChange: null,
    }
  }, [anchor, attachedImages, canSubmit, draft])

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

  // Cleanup adjustment session on unmount
  useEffect(() => {
    return () => {
      setAnnotationAdjustmentSession(null)
    }
  }, [setAnnotationAdjustmentSession])

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
              'pointer-events-none absolute rounded border-2 bg-primary/10 transition-[left,top,width,height,border-color] duration-200 ease-out',
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
          />
        )}
        {anchor?.kind === 'point' && (
          <span
            className="pointer-events-none absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/25 transition-[left,top,transform] duration-200 ease-out"
            style={{ left: anchor.x, top: anchor.y }}
            aria-hidden="true"
          >
            <MousePointer2Icon className="size-3.5" />
          </span>
        )}
        {visibleRegion && (
          <span
            className="pointer-events-none absolute rounded border-2 border-primary bg-primary/10 transition-[left,top,width,height] duration-200 ease-out"
            style={{
              left: visibleRegion.x,
              top: visibleRegion.y,
              width: visibleRegion.width,
              height: visibleRegion.height,
            }}
            aria-hidden="true"
          />
        )}
      </div>

      {anchor && (
        <form
          className="absolute w-[360px] rounded-lg bg-popover/95 p-2.5 text-popover-foreground shadow-[0_16px_50px_rgba(0,0,0,0.18)] ring-1 ring-foreground/10 backdrop-blur-md dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
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
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex w-3 shrink-0 flex-col gap-0.5" aria-hidden="true">
                <span className="h-px w-3 rounded-full bg-muted-foreground/45" />
                <span className="h-px w-3 rounded-full bg-muted-foreground/45" />
              </span>
              <span className="min-w-0 truncate text-sm font-medium text-popover-foreground">
                Comment
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="-mr-1 text-muted-foreground"
              onClick={onCancel}
              aria-label="Close"
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
          {selectedElement && (
            <div className="mb-2 rounded-lg bg-muted/50 px-2.5 py-2 ring-1 ring-border/60">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase text-primary">
                  {selectedElement.tagName.toLowerCase()}
                </span>
                <span className="min-w-0 truncate text-xs font-medium text-foreground">
                  {selectedElement.label || selectedElement.role || selectedElement.selector}
                </span>
              </div>
              {selectedElement.selector && (
                <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                  {selectedElement.selector}
                </div>
              )}
            </div>
          )}
          <Textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder="Comment"
            className="min-h-24 resize-none bg-background/70 text-sm shadow-none"
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
            <div className="flex shrink-0 items-center gap-1">
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
                {!submitting && <CheckIcon className="size-3.5" />}
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
