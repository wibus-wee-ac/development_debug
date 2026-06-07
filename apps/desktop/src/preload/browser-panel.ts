import { contextBridge, ipcRenderer } from 'electron'

const BROWSER_SEND_PROMPT_CHANNEL = 'desktop:browser-send-prompt'
const BROWSER_ANNOTATION_RUNTIME_COMMAND_CHANNEL = 'desktop:browser-annotation-runtime-command'
const BROWSER_ANNOTATION_RUNTIME_EVENT_CHANNEL = 'desktop:browser-annotation-runtime-event'

interface BrowserPanelPromptAttachment {
  filename?: string
  mediaType?: string
  url: string
}

type BrowserPanelAttachmentInput
  = | string
    | Blob
    | {
        dataURL?: string
        dataUrl?: string
        filename?: string
        mediaType?: string
        mimeType?: string
        name?: string
        type?: string
        url?: string
      }

type BrowserPanelSendPromptInput
  = | string
    | {
        attachments?: BrowserPanelAttachmentInput[]
        files?: BrowserPanelAttachmentInput[]
        prompt?: string
        text?: string
      }

interface BrowserPanelSendPromptPayload {
  text: string
  attachments: BrowserPanelPromptAttachment[]
}

interface BrowserAnnotationElementStyle {
  color: string
  backgroundColor: string
  opacity: string
  fontFamily: string
  fontSize: string
  fontWeight: string
  lineHeight: string
  borderRadius: string
  borderColor?: string
  borderWidth?: string
  display?: string
  alignItems?: string
  justifyContent?: string
  flexDirection?: string
  width?: string
  height?: string
  marginTop?: string
  marginRight?: string
  marginBottom?: string
  marginLeft?: string
  paddingTop?: string
  paddingRight?: string
  paddingBottom?: string
  paddingLeft?: string
  rowGap?: string
  columnGap?: string
}

interface BrowserAnnotationElement {
  id: string
  tagName: string
  label: string
  description?: string
  role: string
  selector: string
  attributes?: {
    id?: string
    className?: string
    ariaLabel?: string
    title?: string
    alt?: string
    href?: string
    type?: string
    name?: string
    placeholder?: string
    value?: string
    testId?: string
  }
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
  styles: BrowserAnnotationElementStyle
  pageUrl?: string
  nearbyText?: string
}

type BrowserAnnotationAnchor
  = | { kind: 'point', x: number, y: number }
    | { kind: 'region', x: number, y: number, width: number, height: number }
    | { kind: 'element', element: BrowserAnnotationElement }

interface BrowserAnnotationDesignChange {
  comment?: string
  color?: string
  backgroundColor?: string
  opacity?: string
  fontFamily?: string
  fontSize?: string
  fontWeight?: string
  borderRadius?: string
  borderColor?: string
  borderWidth?: string
  display?: string
  alignItems?: string
  justifyContent?: string
  flexDirection?: string
  width?: string
  height?: string
  marginTop?: string
  marginRight?: string
  marginBottom?: string
  marginLeft?: string
  paddingTop?: string
  paddingRight?: string
  paddingBottom?: string
  paddingLeft?: string
  rowGap?: string
  columnGap?: string
}

interface BrowserAnnotationRuntimeCommand {
  type: 'start' | 'stop' | 'apply-design' | 'clear-design'
  selector?: string
  designChange?: BrowserAnnotationDesignChange
}

interface BrowserAnnotationRuntimeEvent {
  type: 'ready' | 'selected-element' | 'save' | 'submit' | 'cancel' | 'closed' | 'toggle'
  anchor?: BrowserAnnotationAnchor
  selectedElement?: BrowserAnnotationElement | null
  body?: string
  attachedImages?: BrowserPanelPromptAttachment[]
  designChange?: BrowserAnnotationDesignChange | null
  elements?: BrowserAnnotationElement[]
  surfaceSize?: {
    width: number
    height: number
  }
}

type BrowserAnnotationRuntimeStage = 'selecting' | 'editing'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function inferMediaTypeFromDataUrl(url: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/i.exec(url)
  return match?.[1]
}

function inferFilenameFromUrl(url: string): string | undefined {
  if (url.startsWith('data:')) {
    return undefined
  }

  try {
    const parsed = new URL(url)
    const segment = parsed.pathname.split('/').filter(Boolean).at(-1)
    return segment ? decodeURIComponent(segment) : undefined
  }
  catch {
    return undefined
  }
}

function isBlobLike(value: unknown): value is Blob {
  return isObject(value)
    && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
    && typeof (value as { type?: unknown }).type === 'string'
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('Browser prompt attachment did not produce a data URL.'))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read browser prompt attachment.')))
    reader.readAsDataURL(blob)
  })
}

async function normalizeAttachment(input: BrowserPanelAttachmentInput): Promise<BrowserPanelPromptAttachment | null> {
  if (typeof input === 'string') {
    const url = input.trim()
    if (!url) {
      return null
    }
    return {
      filename: inferFilenameFromUrl(url),
      mediaType: inferMediaTypeFromDataUrl(url),
      url,
    }
  }

  if (isBlobLike(input)) {
    const url = await blobToDataUrl(input)
    const filename = readString((input as { name?: unknown }).name)
    return {
      filename,
      mediaType: readString(input.type) ?? inferMediaTypeFromDataUrl(url),
      url,
    }
  }

  if (!isObject(input)) {
    return null
  }

  const url = readString(input.url) ?? readString(input.dataURL) ?? readString(input.dataUrl)
  if (!url) {
    return null
  }

  return {
    filename: readString(input.filename) ?? readString(input.name) ?? inferFilenameFromUrl(url),
    mediaType:
      readString(input.mediaType)
      ?? readString(input.mimeType)
      ?? readString(input.type)
      ?? inferMediaTypeFromDataUrl(url),
    url,
  }
}

async function normalizeSendPromptPayload(
  input: BrowserPanelSendPromptInput,
  attachments: BrowserPanelAttachmentInput[] = [],
): Promise<BrowserPanelSendPromptPayload> {
  if (typeof input === 'string') {
    return {
      text: input,
      attachments: (await Promise.all(attachments.map(normalizeAttachment))).filter(
        attachment => attachment !== null,
      ),
    }
  }

  const inlineAttachments = [
    ...(Array.isArray(input.attachments) ? input.attachments : []),
    ...(Array.isArray(input.files) ? input.files : []),
    ...attachments,
  ]

  return {
    text: input.text ?? input.prompt ?? '',
    attachments: (await Promise.all(inlineAttachments.map(normalizeAttachment))).filter(
      attachment => attachment !== null,
    ),
  }
}

function installBrowserAnnotationRuntime(): void {
  const runtime = new BrowserAnnotationRuntime()
  ipcRenderer.on(
    BROWSER_ANNOTATION_RUNTIME_COMMAND_CHANNEL,
    (_event, command: BrowserAnnotationRuntimeCommand) => {
      runtime.handleCommand(command)
    },
  )
}

class BrowserAnnotationRuntime {
  private root: HTMLDivElement | null = null
  private layer: HTMLDivElement | null = null
  private highlight: HTMLDivElement | null = null
  private highlightLabel: HTMLDivElement | null = null
  private region: HTMLDivElement | null = null
  private editor: HTMLDivElement | null = null
  private textarea: HTMLTextAreaElement | null = null
  private fileInput: HTMLInputElement | null = null
  private selectedElement: Element | null = null
  private designElement: Element | null = null
  private selectedElements: Element[] = []
  private selectedAnchor: BrowserAnnotationAnchor | null = null
  private designChange: BrowserAnnotationDesignChange | null = null
  private attachedImages: BrowserPanelPromptAttachment[] = []
  private dragStart: { x: number, y: number, altKey: boolean, shiftKey: boolean } | null = null
  private selectionFrames: HTMLDivElement[] = []
  private stopTimer: ReturnType<typeof setTimeout> | null = null
  private shakeTimer: ReturnType<typeof setTimeout> | null = null
  private active = false
  private stage: BrowserAnnotationRuntimeStage = 'selecting'

  constructor() {
    window.addEventListener('keydown', this.onKeyDown, true)
  }

  handleCommand(command: BrowserAnnotationRuntimeCommand): void {
    if (command.type === 'start') {
      this.start()
      return
    }
    if (command.type === 'stop') {
      this.stop('closed')
      return
    }
    if (command.type === 'apply-design') {
      this.applyDesign(command.selector, command.designChange ?? {})
      return
    }
    if (command.type === 'clear-design') {
      this.clearDesign()
    }
  }

  private start(): void {
    if (this.active) {
      return
    }
    this.active = true
    this.stage = 'selecting'
    this.mount()
    this.emit({ type: 'ready', surfaceSize: this.surfaceSize(), elements: this.scanElements() })
  }

  private stop(eventType: 'cancel' | 'closed'): void {
    if (!this.active && !this.root) {
      return
    }
    if (eventType === 'cancel' && this.root && !this.root.hasAttribute('data-cradle-browser-comment-exiting')) {
      this.active = false
      this.root.setAttribute('data-cradle-browser-comment-exiting', 'true')
      if (this.stopTimer !== null) {
        clearTimeout(this.stopTimer)
      }
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null
        this.finishStop(eventType)
      }, 150)
      return
    }
    this.finishStop(eventType)
  }

  private finishStop(eventType: 'cancel' | 'closed'): void {
    if (!this.active && !this.root) {
      return
    }
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    if (this.shakeTimer !== null) {
      clearTimeout(this.shakeTimer)
      this.shakeTimer = null
    }
    this.active = false
    this.stage = 'selecting'
    this.clearDesign()
    this.root?.remove()
    this.root = null
    this.layer = null
    this.highlight = null
    this.highlightLabel = null
    this.region = null
    this.editor = null
    this.textarea = null
    this.fileInput = null
    this.selectedAnchor = null
    this.selectedElement = null
    this.designElement = null
    this.selectedElements = []
    this.attachedImages = []
    this.clearSelectionFrames()
    this.emit({ type: eventType })
  }

  private mount(): void {
    this.root?.remove()
    const root = document.createElement('div')
    root.id = 'cradle-browser-comment-root'
    root.setAttribute('data-cradle-browser-comment-root', 'true')

    const style = document.createElement('style')
    style.textContent = `
      #cradle-browser-comment-root {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
        color-scheme: light;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-layer] {
        position: absolute;
        inset: 0;
        cursor: crosshair;
        pointer-events: auto;
        background: transparent;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-highlight],
      #cradle-browser-comment-root [data-cradle-browser-comment-region],
      #cradle-browser-comment-root [data-cradle-browser-comment-selection-frame] {
        position: absolute;
        box-sizing: border-box;
        border: 2px solid #0088ff;
        border-radius: 4px;
        pointer-events: none;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-highlight] {
        background: rgba(0, 136, 255, 0.10);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.68), 0 2px 10px rgba(0, 0, 0, 0.16);
        transition:
          left 140ms cubic-bezier(0.22, 1, 0.36, 1),
          top 140ms cubic-bezier(0.22, 1, 0.36, 1),
          width 140ms cubic-bezier(0.22, 1, 0.36, 1),
          height 140ms cubic-bezier(0.22, 1, 0.36, 1),
          opacity 120ms cubic-bezier(0.22, 1, 0.36, 1);
        will-change: left, top, width, height, opacity;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-region] {
        background: rgba(0, 136, 255, 0.10);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.68), 0 2px 10px rgba(0, 0, 0, 0.16);
        animation: cradle-browser-comment-frame-in 160ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-highlight-label],
      #cradle-browser-comment-root [data-cradle-browser-comment-selection-label] {
        position: absolute;
        box-sizing: border-box;
        max-width: min(220px, calc(100vw - 16px));
        height: 22px;
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 0 7px;
        border-radius: 12px;
        color: rgba(255, 255, 255, 0.86);
        background: #1a1a1a;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(255, 255, 255, 0.08);
        font: 500 11px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
        transition:
          left 140ms cubic-bezier(0.22, 1, 0.36, 1),
          top 140ms cubic-bezier(0.22, 1, 0.36, 1),
          opacity 120ms cubic-bezier(0.22, 1, 0.36, 1);
        will-change: left, top, opacity;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-highlight-label] span,
      #cradle-browser-comment-root [data-cradle-browser-comment-selection-label] span {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-selection-frame] {
        background: rgba(0, 136, 255, 0.10);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.68), 0 2px 10px rgba(0, 0, 0, 0.16);
        animation: cradle-browser-comment-frame-in 160ms cubic-bezier(0.22, 1, 0.36, 1);
        transition:
          left 160ms cubic-bezier(0.22, 1, 0.36, 1),
          top 160ms cubic-bezier(0.22, 1, 0.36, 1),
          width 160ms cubic-bezier(0.22, 1, 0.36, 1),
          height 160ms cubic-bezier(0.22, 1, 0.36, 1),
          opacity 120ms cubic-bezier(0.22, 1, 0.36, 1);
        will-change: left, top, width, height, opacity;
      }
      @keyframes cradle-browser-comment-frame-in {
        from {
          opacity: 0;
          transform: scale(0.96);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
      @keyframes cradle-browser-comment-popup-enter {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(4px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
      @keyframes cradle-browser-comment-popup-exit {
        from {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
        to {
          opacity: 0;
          transform: scale(0.95) translateY(4px);
        }
      }
      @keyframes cradle-browser-comment-popup-shake {
        0%,
        100% {
          transform: scale(1) translateX(0);
        }
        20% {
          transform: scale(1) translateX(-3px);
        }
        40% {
          transform: scale(1) translateX(3px);
        }
        60% {
          transform: scale(1) translateX(-2px);
        }
        80% {
          transform: scale(1) translateX(2px);
        }
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-editor] {
        position: absolute;
        box-sizing: border-box;
        width: min(280px, calc(100vw - 24px));
        min-height: 112px;
        pointer-events: auto;
        border: 0;
        border-radius: 16px;
        background: #1a1a1a;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(255, 255, 255, 0.08);
        padding: 12px 16px 14px;
        backdrop-filter: blur(10px);
        animation: cradle-browser-comment-popup-enter 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        transform-origin: 24px 0;
        will-change: transform, opacity;
      }
      #cradle-browser-comment-root[data-cradle-browser-comment-exiting] [data-cradle-browser-comment-editor] {
        animation: cradle-browser-comment-popup-exit 150ms ease-in both;
      }
      #cradle-browser-comment-root[data-cradle-browser-comment-shaking] [data-cradle-browser-comment-editor] {
        animation: cradle-browser-comment-popup-shake 250ms ease-out;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-prompt-row] {
        display: flex;
        min-width: 0;
        align-items: baseline;
        gap: 6px;
        color: rgba(255, 255, 255, 0.94);
        font: 400 12px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-prompt-row] span {
        flex: none;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-token] {
        display: inline-flex;
        max-width: min(188px, calc(100vw - 80px));
        min-width: 0;
        align-items: center;
        border-radius: 999px;
        padding: 2px 6px;
        color: #ffffff;
        background: #0088ff;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-token] span {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      #cradle-browser-comment-root textarea {
        display: block;
        box-sizing: border-box;
        width: 100%;
        min-height: 48px;
        margin: 8px 0 0;
        resize: none;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        padding: 8px 10px;
        color: rgba(255, 255, 255, 0.94);
        background: rgba(255, 255, 255, 0.05);
        font: 400 12px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        outline: none;
        transition: border-color 150ms ease;
      }
      #cradle-browser-comment-root textarea:focus {
        border-color: #0088ff;
      }
      #cradle-browser-comment-root textarea::placeholder {
        color: rgba(255, 255, 255, 0.42);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-actions] {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
      }
      #cradle-browser-comment-root button,
      #cradle-browser-comment-root label {
        display: inline-flex;
        min-width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        border: 0;
        padding: 0 9px;
        color: rgba(255, 255, 255, 0.62);
        background: transparent;
        font: 500 11px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        transition: background-color 160ms cubic-bezier(0.2, 0, 0, 1), color 160ms cubic-bezier(0.2, 0, 0, 1), transform 160ms cubic-bezier(0.2, 0, 0, 1);
      }
      #cradle-browser-comment-root button:hover,
      #cradle-browser-comment-root label:hover {
        color: rgba(255, 255, 255, 0.9);
        background: rgba(255, 255, 255, 0.08);
      }
      #cradle-browser-comment-root button:active,
      #cradle-browser-comment-root label:active {
        transform: scale(0.96);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-ghost] {
        background: rgba(255, 255, 255, 0.06);
      }
      #cradle-browser-comment-root button[data-primary] {
        margin-left: auto;
        width: 28px;
        min-width: 28px;
        padding: 0;
        color: #ffffff;
        background: #0088ff;
        font-size: 16px;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-file-count] {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: rgba(255, 255, 255, 0.48);
        font: 11px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #cradle-browser-comment-root input[type="file"] {
        display: none;
      }
      @media (prefers-reduced-motion: reduce) {
        #cradle-browser-comment-root [data-cradle-browser-comment-highlight],
        #cradle-browser-comment-root [data-cradle-browser-comment-highlight-label],
        #cradle-browser-comment-root [data-cradle-browser-comment-selection-label],
        #cradle-browser-comment-root [data-cradle-browser-comment-selection-frame],
        #cradle-browser-comment-root [data-cradle-browser-comment-region],
        #cradle-browser-comment-root [data-cradle-browser-comment-editor] {
          animation: none;
          transition: none;
        }
      }
    `
    const layer = document.createElement('div')
    layer.setAttribute('data-cradle-browser-comment-layer', 'true')
    const highlight = document.createElement('div')
    highlight.setAttribute('data-cradle-browser-comment-highlight', 'true')
    highlight.hidden = true
    const highlightLabel = document.createElement('div')
    highlightLabel.setAttribute('data-cradle-browser-comment-highlight-label', 'true')
    highlightLabel.hidden = true
    const region = document.createElement('div')
    region.setAttribute('data-cradle-browser-comment-region', 'true')
    region.hidden = true

    layer.addEventListener('pointerdown', this.onPointerDown)
    layer.addEventListener('pointermove', this.onPointerMove)
    layer.addEventListener('pointerup', this.onPointerUp)
    layer.addEventListener('pointerleave', this.onPointerLeave)

    root.append(style, layer, highlight, highlightLabel, region)
    document.documentElement.appendChild(root)
    this.root = root
    this.layer = layer
    this.highlight = highlight
    this.highlightLabel = highlightLabel
    this.region = region
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (this.stage === 'editing') {
      this.shakeEditor()
      return
    }
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    }
    this.layer?.setPointerCapture?.(event.pointerId)
    this.hideRegion()
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.active) {
      return
    }
    if (this.dragStart) {
      const rect = this.rectFromPoints(this.dragStart, { x: event.clientX, y: event.clientY })
      if (rect.width > 4 || rect.height > 4) {
        this.showRegion(rect)
      }
      return
    }

    if (this.stage === 'editing') {
      this.hideHighlight()
      return
    }

    const element = this.elementFromPoint(event.clientX, event.clientY)
    if (element) {
      const annotationElement = this.readElement(element, 0)
      this.showHighlight(element.getBoundingClientRect(), annotationElement)
      return
    }
    this.hideHighlight()
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.active || !this.dragStart) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const rect = this.rectFromPoints(this.dragStart, { x: event.clientX, y: event.clientY })
    const dragStart = this.dragStart
    this.dragStart = null

    if (rect.width > 8 && rect.height > 8) {
      this.selectRegion(rect)
      this.showRegion(rect)
      this.openEditor(rect, this.anchorLabel())
      this.emitSelection(null)
      if (dragStart.altKey) {
        this.submit('submit')
      }
      return
    }

    const element = this.elementFromPoint(event.clientX, event.clientY)
    if (element) {
      if (dragStart.shiftKey) {
        const nextSelection = this.selectedElements.includes(element)
          ? this.selectedElements.filter(item => item !== element)
          : [...this.selectedElements, element]
        const selected = this.selectElements(nextSelection.length > 0 ? nextSelection : [element])
        if (selected) {
          this.hideRegion()
          this.openEditor(this.rectForAnchor(selected.anchor), this.anchorLabel())
          this.emitSelection(selected.element)
        }
        return
      }

      const selected = this.selectElements([element])
      if (selected) {
        this.hideRegion()
        this.openEditor(selected.element.rect, this.anchorLabel())
        this.emitSelection(selected.element)
        if (dragStart.altKey) {
          this.submit('submit')
        }
        return
      }
    }

    this.selectPoint(event.clientX, event.clientY)
    this.showRegion({ x: event.clientX - 5, y: event.clientY - 5, width: 10, height: 10 })
    this.openEditor({ x: event.clientX, y: event.clientY, width: 1, height: 1 }, this.anchorLabel())
    this.emitSelection(null)
    if (dragStart.altKey) {
      this.submit('submit')
    }
  }

  private readonly onPointerLeave = (): void => {
    if (!this.dragStart) {
      this.hideHighlight()
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const isToggleShortcut
      = event.metaKey
        && event.shiftKey
        && !event.altKey
        && !event.ctrlKey
        && event.key.toLowerCase() === 'd'
    if (isToggleShortcut) {
      event.preventDefault()
      event.stopPropagation()
      this.emit({ type: 'toggle' })
      return
    }

    if (!this.active) {
      return
    }

    const isAddToChatShortcut
      = event.metaKey
        && !event.shiftKey
        && !event.altKey
        && !event.ctrlKey
        && event.key.toLowerCase() === 'l'
    if (isAddToChatShortcut) {
      if (!this.selectedAnchor) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      this.submit('submit')
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.stop('cancel')
      return
    }

    const targetElement = this.selectedElement
    if (!targetElement) {
      return
    }

    let nextElement: Element | null = null
    if (event.key === 'Tab') {
      nextElement = event.shiftKey
        ? this.previousNavigableSibling(targetElement)
        : this.nextNavigableSibling(targetElement)
    }
    else if (event.key === 'Enter') {
      nextElement = event.shiftKey
        ? this.navigableParent(targetElement)
        : this.firstNavigableChild(targetElement)
    }

    if (!nextElement) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const selected = this.selectElements([nextElement])
    if (selected) {
      this.hideRegion()
      this.openEditor(selected.element.rect, this.anchorLabel())
      this.emitSelection(selected.element)
    }
  }

  private emitSelection(element: BrowserAnnotationElement | null): void {
    this.emit({
      type: 'selected-element',
      anchor: this.selectedAnchor ?? undefined,
      selectedElement: element,
      surfaceSize: this.surfaceSize(),
      elements: this.scanElements(),
    })
  }

  private openEditor(
    rect: { x: number, y: number, width: number, height: number },
    anchorLabel: string,
  ): void {
    this.editor?.remove()
    if (!this.root) {
      return
    }

    const editor = document.createElement('div')
    editor.setAttribute('data-cradle-browser-comment-editor', 'true')
    const previousBody = this.textarea?.value ?? this.designChange?.comment ?? ''
    const promptRow = document.createElement('div')
    promptRow.setAttribute('data-cradle-browser-comment-prompt-row', 'true')
    const promptPrefix = document.createElement('span')
    promptPrefix.textContent = 'Add more detail to'
    const token = document.createElement('span')
    token.setAttribute('data-cradle-browser-comment-token', 'true')
    const tokenText = document.createElement('span')
    tokenText.textContent = anchorLabel
    token.appendChild(tokenText)
    promptRow.append(promptPrefix, token)

    const textarea = document.createElement('textarea')
    textarea.placeholder = 'Comment'
    textarea.value = previousBody

    const actions = document.createElement('div')
    actions.setAttribute('data-cradle-browser-comment-actions', 'true')
    const fileLabel = document.createElement('label')
    fileLabel.textContent = 'Attach'
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'image/*'
    fileInput.multiple = true
    fileLabel.appendChild(fileInput)
    const fileCount = document.createElement('span')
    fileCount.setAttribute('data-cradle-browser-comment-file-count', 'true')
    fileCount.textContent = this.attachedImages.length === 0
      ? 'No files'
      : `${this.attachedImages.length} file${this.attachedImages.length === 1 ? '' : 's'}`
    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.textContent = 'Cancel'
    cancelButton.setAttribute('data-cradle-browser-comment-ghost', 'true')
    const saveButton = document.createElement('button')
    saveButton.type = 'button'
    saveButton.textContent = 'Save'
    saveButton.setAttribute('data-cradle-browser-comment-ghost', 'true')
    const sendButton = document.createElement('button')
    sendButton.type = 'button'
    sendButton.textContent = '↑'
    sendButton.title = 'Add to chat (Command L)'
    sendButton.setAttribute('data-primary', 'true')

    fileInput.addEventListener('change', () => {
      void this.readAttachedFiles(fileInput.files).then((attachments) => {
        this.attachedImages = attachments
        fileCount.textContent = attachments.length === 0
          ? 'No files'
          : `${attachments.length} file${attachments.length === 1 ? '' : 's'}`
      })
    })
    cancelButton.addEventListener('click', () => this.stop('cancel'))
    saveButton.addEventListener('click', () => this.submit('save'))
    sendButton.addEventListener('click', () => this.submit('submit'))

    actions.append(fileLabel, fileCount, cancelButton, saveButton, sendButton)
    editor.append(promptRow, textarea, actions)
    this.root.appendChild(editor)
    this.editor = editor
    this.textarea = textarea
    this.fileInput = fileInput

    const editorWidth = Math.min(280, Math.max(260, window.innerWidth - 24))
    const leftCandidate = rect.x + rect.width + 8
    const fallbackLeft = rect.x
    const left = leftCandidate + editorWidth <= window.innerWidth - 12
      ? leftCandidate
      : fallbackLeft
    const top = Math.min(window.innerHeight - 136, Math.max(12, rect.y + rect.height + 8))
    editor.style.left = `${Math.max(12, Math.min(window.innerWidth - editorWidth - 12, left))}px`
    editor.style.top = `${top}px`
    textarea.focus()
  }

  private shakeEditor(): void {
    if (!this.root || !this.textarea) {
      return
    }
    if (this.shakeTimer !== null) {
      clearTimeout(this.shakeTimer)
    }
    this.root.setAttribute('data-cradle-browser-comment-shaking', 'true')
    this.shakeTimer = setTimeout(() => {
      this.root?.removeAttribute('data-cradle-browser-comment-shaking')
      this.shakeTimer = null
      this.textarea?.focus()
    }, 250)
  }

  private submit(type: 'save' | 'submit'): void {
    if (!this.selectedAnchor) {
      return
    }
    const body = this.textarea?.value.trim() ?? ''
    this.emit({
      type,
      anchor: this.selectedAnchor,
      body,
      attachedImages: this.attachedImages,
      designChange: this.designChange,
      elements: this.scanElements(),
      surfaceSize: this.surfaceSize(),
    })
    this.stop('closed')
  }

  private async readAttachedFiles(files: FileList | null): Promise<BrowserPanelPromptAttachment[]> {
    if (!files) {
      return []
    }
    return (await Promise.all(Array.from(files).map(async file => ({
      filename: file.name,
      mediaType: file.type || 'application/octet-stream',
      url: await blobToDataUrl(file),
    })))).slice(0, 12)
  }

  private scanElements(): BrowserAnnotationElement[] {
    return Array.from(document.querySelectorAll('body *'))
      .map((element, index) => this.readElement(element, index))
      .filter(element => element !== null)
      .slice(0, 250)
  }

  private readElement(element: Element, index: number): BrowserAnnotationElement | null {
    if (element.closest('#cradle-browser-comment-root, script, style, meta, link, noscript')) {
      return null
    }
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
    if (
      rect.width <= 0
      || rect.height <= 0
      || rect.right < 0
      || rect.bottom < 0
      || rect.left > viewportWidth
      || rect.top > viewportHeight
      || style.visibility === 'hidden'
      || style.display === 'none'
      || Number(style.opacity) === 0
    ) {
      return null
    }

    const attributes = this.attributesFor(element)
    const label = this.labelFor(element)
    const role = this.roleFor(element)
    return {
      id: `element-${index}`,
      tagName: element.tagName,
      label,
      description: this.descriptionFor(attributes),
      role,
      selector: this.cssPath(element),
      attributes,
      pageUrl: window.location.href,
      nearbyText: this.nearbyTextFor(element),
      rect: {
        x: Math.max(0, Math.min(viewportWidth, rect.left)),
        y: Math.max(0, Math.min(viewportHeight, rect.top)),
        width: Math.max(1, Math.min(viewportWidth, rect.right) - Math.max(0, rect.left)),
        height: Math.max(1, Math.min(viewportHeight, rect.bottom) - Math.max(0, rect.top)),
      },
      styles: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        opacity: style.opacity,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        borderRadius: style.borderRadius,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        display: style.display,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        flexDirection: style.flexDirection,
        width: style.width,
        height: style.height,
        marginTop: style.marginTop,
        marginRight: style.marginRight,
        marginBottom: style.marginBottom,
        marginLeft: style.marginLeft,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        rowGap: style.rowGap,
        columnGap: style.columnGap,
      },
    }
  }

  private applyDesign(selector: string | undefined, designChange: BrowserAnnotationDesignChange): void {
    if (!selector) {
      return
    }
    const element = document.querySelector(selector)
    if (!element) {
      return
    }

    this.clearDesign()
    this.designElement = element
    element.setAttribute('data-cradle-browser-design-group', 'active')
    this.designChange = designChange
    const rows = [
      this.cssDeclaration('color', designChange.color),
      this.cssDeclaration('background-color', designChange.backgroundColor),
      this.cssDeclaration('opacity', designChange.opacity),
      this.cssDeclaration('font-family', designChange.fontFamily),
      this.cssDeclaration('font-size', designChange.fontSize),
      this.cssDeclaration('font-weight', designChange.fontWeight),
      this.cssDeclaration('border-radius', designChange.borderRadius),
      this.cssDeclaration('border-color', designChange.borderColor),
      this.cssDeclaration('border-width', designChange.borderWidth),
      this.cssDeclaration('display', designChange.display),
      this.cssDeclaration('align-items', designChange.alignItems),
      this.cssDeclaration('justify-content', designChange.justifyContent),
      this.cssDeclaration('flex-direction', designChange.flexDirection),
      this.cssDeclaration('width', designChange.width),
      this.cssDeclaration('height', designChange.height),
      this.cssDeclaration('margin-top', designChange.marginTop),
      this.cssDeclaration('margin-right', designChange.marginRight),
      this.cssDeclaration('margin-bottom', designChange.marginBottom),
      this.cssDeclaration('margin-left', designChange.marginLeft),
      this.cssDeclaration('padding-top', designChange.paddingTop),
      this.cssDeclaration('padding-right', designChange.paddingRight),
      this.cssDeclaration('padding-bottom', designChange.paddingBottom),
      this.cssDeclaration('padding-left', designChange.paddingLeft),
      this.cssDeclaration('row-gap', designChange.rowGap),
      this.cssDeclaration('column-gap', designChange.columnGap),
    ].filter(row => row !== null)

    let style = document.getElementById('cradle-browser-design-draft-style')
    if (!style) {
      style = document.createElement('style')
      style.id = 'cradle-browser-design-draft-style'
      style.setAttribute('data-cradle-browser-runtime', 'annotation-design')
      document.head.appendChild(style)
    }
    style.textContent = rows.length > 0
      ? `[data-cradle-browser-design-group="active"] { ${rows.join(' ')} }`
      : ''

    const annotationElement = this.readElement(element, 0)
    if (annotationElement) {
      this.selectElements([element])
    }
  }

  private clearDesign(): void {
    this.designElement?.removeAttribute('data-cradle-browser-design-group')
    this.designElement = null
    this.designChange = null
    document.getElementById('cradle-browser-design-draft-style')?.remove()
  }

  private cssDeclaration(property: string, value: string | undefined): string | null {
    if (!value?.trim()) {
      return null
    }
    return `${property}: ${value.trim().replace(/[;{}]/g, '')} !important;`
  }

  private elementFromPoint(x: number, y: number): Element | null {
    return document.elementsFromPoint(x, y).find(element =>
      !element.closest('#cradle-browser-comment-root')
      && !['HTML', 'BODY'].includes(element.tagName)) ?? null
  }

  private showHighlight(rect: DOMRect, element: BrowserAnnotationElement | null = null): void {
    if (!this.highlight) {
      return
    }
    this.highlight.hidden = false
    this.highlight.style.left = `${rect.left}px`
    this.highlight.style.top = `${rect.top}px`
    this.highlight.style.width = `${rect.width}px`
    this.highlight.style.height = `${rect.height}px`
    if (this.highlightLabel) {
      this.highlightLabel.hidden = false
      this.highlightLabel.style.left = `${Math.max(8, rect.left)}px`
      this.highlightLabel.style.top = `${Math.max(8, rect.top - 22)}px`
      this.highlightLabel.innerHTML = ''
      const label = document.createElement('span')
      label.textContent = element ? this.elementTokenLabel(element) : 'Element'
      this.highlightLabel.appendChild(label)
    }
  }

  private hideHighlight(): void {
    if (this.highlight) {
      this.highlight.hidden = true
    }
    if (this.highlightLabel) {
      this.highlightLabel.hidden = true
    }
  }

  private showRegion(rect: { x: number, y: number, width: number, height: number }): void {
    if (!this.region) {
      return
    }
    this.region.hidden = false
    this.region.style.left = `${rect.x}px`
    this.region.style.top = `${rect.y}px`
    this.region.style.width = `${rect.width}px`
    this.region.style.height = `${rect.height}px`
  }

  private hideRegion(): void {
    if (this.region) {
      this.region.hidden = true
    }
  }

  private selectPoint(x: number, y: number): void {
    this.stage = 'editing'
    this.selectedElement = null
    this.selectedElements = []
    this.selectedAnchor = { kind: 'point', x, y }
    this.clearSelectionFrames()
    this.hideHighlight()
  }

  private selectRegion(rect: { x: number, y: number, width: number, height: number }): void {
    this.stage = 'editing'
    this.selectedElement = null
    this.selectedElements = []
    this.selectedAnchor = { kind: 'region', ...rect }
    this.clearSelectionFrames()
    this.hideHighlight()
  }

  private selectElements(elements: Element[]): {
    anchor: BrowserAnnotationAnchor
    element: BrowserAnnotationElement
  } | null {
    const uniqueElements = Array.from(new Set(elements)).filter(element => this.readElement(element, 0))
    if (uniqueElements.length === 0) {
      return null
    }

    const primaryElement = uniqueElements.at(-1)
    if (!primaryElement) {
      return null
    }
    const annotationElement = this.readElement(primaryElement, 0)
    if (!annotationElement) {
      return null
    }

    this.selectedElement = primaryElement
    this.selectedElements = uniqueElements
    this.stage = 'editing'
    if (uniqueElements.length === 1) {
      this.selectedAnchor = { kind: 'element', element: annotationElement }
      this.hideHighlight()
      this.renderSelectionFrames(uniqueElements)
      return {
        anchor: this.selectedAnchor,
        element: annotationElement,
      }
    }

    const region = this.boundsForElements(uniqueElements)
    this.selectedAnchor = { kind: 'region', ...region }
    this.hideHighlight()
    this.renderSelectionFrames(uniqueElements)
    return {
      anchor: this.selectedAnchor,
      element: annotationElement,
    }
  }

  private boundsForElements(elements: Element[]): { x: number, y: number, width: number, height: number } {
    const rects = elements.map(element => element.getBoundingClientRect())
    const left = Math.min(...rects.map(rect => rect.left))
    const top = Math.min(...rects.map(rect => rect.top))
    const right = Math.max(...rects.map(rect => rect.right))
    const bottom = Math.max(...rects.map(rect => rect.bottom))
    return {
      x: Math.max(0, left),
      y: Math.max(0, top),
      width: Math.max(1, Math.min(window.innerWidth, right) - Math.max(0, left)),
      height: Math.max(1, Math.min(window.innerHeight, bottom) - Math.max(0, top)),
    }
  }

  private renderSelectionFrames(elements: Element[]): void {
    this.clearSelectionFrames()
    if (!this.root) {
      return
    }
    elements.forEach((element, index) => {
      const rect = element.getBoundingClientRect()
      const frame = document.createElement('div')
      frame.setAttribute('data-cradle-browser-comment-selection-frame', 'true')
      frame.style.left = `${rect.left}px`
      frame.style.top = `${rect.top}px`
      frame.style.width = `${rect.width}px`
      frame.style.height = `${rect.height}px`
      this.root?.appendChild(frame)
      this.selectionFrames.push(frame)
      if (index === elements.length - 1) {
        const annotationElement = this.readElement(element, 0)
        const label = document.createElement('div')
        label.setAttribute('data-cradle-browser-comment-selection-label', 'true')
        label.style.left = `${Math.max(8, rect.left)}px`
        label.style.top = `${Math.max(8, rect.top - 22)}px`
        const labelText = document.createElement('span')
        labelText.textContent = annotationElement
          ? `${elements.length} selected · ${this.elementTokenLabel(annotationElement)}`
          : `${elements.length} selected`
        label.appendChild(labelText)
        this.root?.appendChild(label)
        this.selectionFrames.push(label)
      }
    })
  }

  private clearSelectionFrames(): void {
    for (const frame of this.selectionFrames) {
      frame.remove()
    }
    this.selectionFrames = []
  }

  private rectForAnchor(anchor: BrowserAnnotationAnchor): { x: number, y: number, width: number, height: number } {
    if (anchor.kind === 'point') {
      return { x: anchor.x, y: anchor.y, width: 1, height: 1 }
    }
    if (anchor.kind === 'element') {
      return anchor.element.rect
    }
    return anchor
  }

  private anchorLabel(): string {
    if (!this.selectedAnchor) {
      return 'selection'
    }
    if (this.selectedElements.length > 1) {
      return `${this.selectedElements.length} elements`
    }
    if (this.selectedAnchor.kind === 'element') {
      return this.elementTokenLabel(this.selectedAnchor.element)
    }
    if (this.selectedAnchor.kind === 'region') {
      return 'region'
    }
    return 'point'
  }

  private elementTokenLabel(element: BrowserAnnotationElement): string {
    const name = element.label || element.attributes?.id || element.role || element.selector
    return `${name || 'Element'} <${element.tagName.toLowerCase()}>`
  }

  private firstNavigableChild(element: Element): Element | null {
    return Array.from(element.children).find(child => this.readElement(child, 0)) ?? null
  }

  private navigableParent(element: Element): Element | null {
    let parent = element.parentElement
    while (parent && parent !== document.body) {
      if (this.readElement(parent, 0)) {
        return parent
      }
      parent = parent.parentElement
    }
    return null
  }

  private nextNavigableSibling(element: Element): Element | null {
    let sibling = element.nextElementSibling
    while (sibling) {
      if (this.readElement(sibling, 0)) {
        return sibling
      }
      sibling = sibling.nextElementSibling
    }
    return null
  }

  private previousNavigableSibling(element: Element): Element | null {
    let sibling = element.previousElementSibling
    while (sibling) {
      if (this.readElement(sibling, 0)) {
        return sibling
      }
      sibling = sibling.previousElementSibling
    }
    return null
  }

  private rectFromPoints(
    start: { x: number, y: number },
    end: { x: number, y: number },
  ): { x: number, y: number, width: number, height: number } {
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    return {
      x,
      y,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }
  }

  private cssPath(element: Element): string {
    const parts: string[] = []
    let current: Element | null = element
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const tag = current.tagName.toLowerCase()
      if (current.id) {
        parts.unshift(`${tag}#${CSS.escape(current.id)}`)
        break
      }
      const classes = Array.from(current.classList || [])
        .slice(0, 2)
        .map(name => `.${CSS.escape(name)}`)
        .join('')
      let index = 1
      let sibling = current.previousElementSibling
      while (sibling) {
        if (sibling.tagName === current.tagName) {
          index += 1
        }
        sibling = sibling.previousElementSibling
      }
      parts.unshift(`${tag}${classes}:nth-of-type(${index})`)
      current = current.parentElement
    }
    return parts.join(' > ')
  }

  private labelFor(element: Element): string {
    const inputValue = 'value' in element && typeof element.value === 'string' ? element.value : ''
    const text = element.getAttribute('aria-label')
      || element.getAttribute('alt')
      || element.getAttribute('title')
      || element.getAttribute('placeholder')
      || inputValue
      || element.textContent
      || ''
    return text.replace(/\s+/g, ' ').trim().slice(0, 140)
  }

  private nearbyTextFor(element: Element): string {
    return (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400)
  }

  private roleFor(element: Element): string {
    const explicit = element.getAttribute('role')
    if (explicit) {
      return explicit
    }
    switch (element.tagName) {
      case 'A':
        return element.hasAttribute('href') ? 'link' : ''
      case 'BUTTON':
        return 'button'
      case 'IMG':
        return 'img'
      case 'INPUT': {
        const type = (element.getAttribute('type') || 'text').toLowerCase()
        if (type === 'checkbox') {
          return 'checkbox'
        }
        if (type === 'radio') {
          return 'radio'
        }
        if (type === 'range') {
          return 'slider'
        }
        if (type === 'submit' || type === 'button' || type === 'reset') {
          return 'button'
        }
        return 'textbox'
      }
      case 'TEXTAREA':
        return 'textbox'
      case 'SELECT':
        return 'combobox'
      default:
        return ''
    }
  }

  private attributesFor(element: Element): BrowserAnnotationElement['attributes'] {
    const inputValue = 'value' in element && typeof element.value === 'string' ? element.value : ''
    return {
      id: element.id || undefined,
      className: element.className && typeof element.className === 'string'
        ? element.className.slice(0, 160)
        : undefined,
      ariaLabel: element.getAttribute('aria-label') || undefined,
      title: element.getAttribute('title') || undefined,
      alt: element.getAttribute('alt') || undefined,
      href: element instanceof HTMLAnchorElement ? element.href : element.getAttribute('href') || undefined,
      type: element.getAttribute('type') || undefined,
      name: element.getAttribute('name') || undefined,
      placeholder: element.getAttribute('placeholder') || undefined,
      value: inputValue ? inputValue.slice(0, 120) : undefined,
      testId: element.getAttribute('data-testid') || element.getAttribute('data-test-id') || undefined,
    }
  }

  private descriptionFor(attributes: BrowserAnnotationElement['attributes']): string {
    const parts = [
      attributes?.href ? `href=${attributes.href}` : null,
      attributes?.placeholder ? `placeholder=${attributes.placeholder}` : null,
      attributes?.name ? `name=${attributes.name}` : null,
      attributes?.type ? `type=${attributes.type}` : null,
      attributes?.testId ? `testid=${attributes.testId}` : null,
    ].filter(part => part !== null)
    return parts.join(' · ').slice(0, 220)
  }

  private surfaceSize(): { width: number, height: number } {
    return {
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
    }
  }

  private emit(event: BrowserAnnotationRuntimeEvent): void {
    void ipcRenderer.invoke(BROWSER_ANNOTATION_RUNTIME_EVENT_CHANNEL, event).catch(() => {})
  }
}

contextBridge.exposeInMainWorld('codex', {
  async sendPrompt(
    input: BrowserPanelSendPromptInput,
    attachments?: BrowserPanelAttachmentInput[],
  ): Promise<void> {
    await ipcRenderer.invoke(
      BROWSER_SEND_PROMPT_CHANNEL,
      await normalizeSendPromptPayload(input, attachments),
    )
  },
})

installBrowserAnnotationRuntime()
