// FILE: browser-panel.tsx
// Purpose: Renders Cradle's BrowserPanel chrome and anchors the native Electron WebContentsView.
// Layer: Browser feature UI
// Depends on: BrowserPanel Zustand metadata cache, Electron browser preload bridge

import type { FileUIPart } from 'ai'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  CameraIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  FileTextIcon,
  GaugeIcon,
  GlobeIcon,
  LoaderCircleIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  ServerIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Button } from '~/components/ui/button'
import { releaseSideConversation } from '../chat/commands/chat-response-command'
import {
  submitChatComposerFileIngress,
  submitChatPromptIngress,
} from '~/features/chat/prompt-ingress'
import { WorkspaceFileEditor } from '~/features/workspace/workspace-file-editor'
import { WorkspaceFilePreview } from '~/features/workspace/workspace-file-preview'
import { cn } from '~/lib/cn'
import { isElectron } from '~/lib/electron'
import type {
  BrowserAnnotationAnchor,
  BrowserAnnotationDesignChange,
  BrowserAnnotationElement,
  BrowserAnnotationRecord,
  BrowserPanelTab,
  BrowserTabState,
  BrowserWebTab,
} from '~/store/browser-panel'
import {
  DEFAULT_BROWSER_PANEL_OWNER_ID,
  selectOwnerBrowserAnnotations,
  selectOwnerBrowserHistory,
  selectOwnerBrowserState,
  useBrowserPanelStore,
} from '~/store/browser-panel'

import type { BrowserAnnotationAdjustmentApplyDetail } from './browser-annotation-adjustment-panel'
import {
  BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT,
} from './browser-annotation-adjustment-panel'
import type { BrowserAddressSuggestion } from './browser-panel.logic'
import {
  browserAddressDisplayValue,
  buildBrowserAddressSuggestions,
  normalizeBrowserAddressInput,
  resolveBrowserAddressSync,
  resolveBrowserChromeStatus,
} from './browser-panel.logic'
import { ContextUsageReport } from './context-usage-report'
import { SideConversationPanel } from './side-conversation-panel'
import { SubagentOutputPanel } from './subagent-output-panel'
import { WorkspaceDiffViewer } from './workspace-diff-viewer'

interface BrowserPanelProps {
  ownerId?: string | null
  activeSessionId?: string | null
  activeSessionTitle?: string | null
  nativeBoundsPaused?: boolean
  onCloseLastTab?: (ownerId: string) => void
}

interface BrowserLocalServer {
  port: number
  url: string
  title: string
  statusCode: number | null
}

interface BrowserPromptAttachment {
  filename?: string
  mediaType?: string
  url: string
}

interface BrowserPromptRequest {
  threadId: string
  tabId: string
  text: string
  attachments: BrowserPromptAttachment[]
  sourceUrl: string | null
  sourceTitle: string | null
}

interface BrowserAnnotationRuntimeEvent {
  threadId: string
  tabId: string
  type: 'ready' | 'selected-element' | 'save' | 'submit' | 'cancel' | 'closed' | 'toggle'
  anchor?: BrowserAnnotationAnchor
  selectedElement?: BrowserAnnotationElement | null
  body?: string
  attachedImages?: BrowserPromptAttachment[]
  designChange?: BrowserAnnotationDesignChange | null
  elements?: BrowserAnnotationElement[]
  surfaceSize?: {
    width: number
    height: number
  }
  sourceUrl: string | null
  sourceTitle: string | null
}

const BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET = 2
const BROWSER_SCREENSHOT_CHUNK_SIZE = 0x8000
const EMPTY_BROWSER_PANEL_TABS: BrowserPanelTab[] = []
const EMPTY_BROWSER_LOCAL_SERVERS: BrowserLocalServer[] = []
interface BrowserAnnotationRuntimeSession {
  tabId: string
  editingAnnotationId: string | null
}

interface BrowserNativeBoundsPreview {
  tabId: string
  url: string
  imageDataUrl: string
}

interface BrowserAnnotationCropRect {
  x: number
  y: number
  width: number
  height: number
}

function readBrowserBridge() {
  return window.cradle?.browser ?? null
}

function formatBrowserActionError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return 'Browser action failed.'
  }
  if (/ERR_ABORTED|\(-3\)/i.test(error.message)) {
    return null
  }
  return error.message || 'Browser action failed.'
}

function getTabTitle(tab: BrowserTabState): string {
  if (tab.title && tab.title !== 'about:blank') {
    return tab.title
  }
  if (tab.url === 'about:blank') {
    return 'New tab'
  }
  return tab.url
}

function getPanelTabTitle(tab: BrowserPanelTab): string {
  if (tab.kind === 'browser') {
    return getTabTitle(tab)
  }
  return tab.title
}

function isBrowserPanelTab(tab: BrowserPanelTab): tab is BrowserWebTab {
  return tab.kind === 'browser'
}

function isBrowserBlankTab(tab: BrowserWebTab | null): boolean {
  return (tab?.url.trim() ?? '') === 'about:blank'
}

function localServerStatusLabel(statusCode: number | null): string {
  if (statusCode === null) {
    return 'HTTP'
  }
  if (statusCode >= 200 && statusCode < 300) {
    return 'Ready'
  }
  if (statusCode >= 300 && statusCode < 400) {
    return `${statusCode} redirect`
  }
  return `${statusCode}`
}

interface BrowserNewTabSurfaceProps {
  localServers: BrowserLocalServer[]
  localServersLoading: boolean
  localServersError: string | null
  onOpenUrl: (url: string) => void
  onRefreshLocalServers: () => void
}

const BrowserNewTabSurface = ({
  localServers,
  localServersLoading,
  localServersError,
  onOpenUrl,
  onRefreshLocalServers,
}: BrowserNewTabSurfaceProps) => {
  const localServerCountLabel = localServersLoading
    ? 'Scanning'
    : `${localServers.length} local ${localServers.length === 1 ? 'server' : 'servers'}`

  return (
    <div className="absolute inset-0 overflow-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-5 py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-foreground">New tab</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">{localServerCountLabel}</p>
          </div>
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            onClick={onRefreshLocalServers}
            disabled={localServersLoading}
            aria-label="Refresh local servers"
          >
            <RefreshCwIcon className={cn('size-3.5', localServersLoading && 'animate-spin')} />
          </button>
        </div>

        <div className="grid overflow-hidden rounded-lg border border-border/60 bg-muted/20">
          {localServers.map(server => (
            <button
              key={server.url}
              type="button"
              className="group flex min-h-14 w-full min-w-0 items-center gap-3 border-b border-border/50 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/50"
              onClick={() => onOpenUrl(server.url)}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground ring-1 ring-border/60">
                <ServerIcon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {server.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {`localhost:${server.port}`}
                </span>
              </span>
              <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground tabular-nums ring-1 ring-border/60">
                {localServerStatusLabel(server.statusCode)}
              </span>
              <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            </button>
          ))}
        </div>

        {!localServersLoading && localServers.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
            {localServersError ?? 'No local servers found.'}
          </div>
        )}

        {localServersLoading && localServers.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
            Scanning localhost.
          </div>
        )}
      </div>
    </div>
  )
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BROWSER_SCREENSHOT_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BROWSER_SCREENSHOT_CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }
  return window.btoa(binary)
}

function createBrowserScreenshotFilePart(input: {
  name: string
  mimeType: 'image/png'
  bytes: Uint8Array
}): FileUIPart {
  return {
    type: 'file',
    filename: input.name,
    mediaType: input.mimeType,
    url: `data:${input.mimeType};base64,${bytesToBase64(input.bytes)}`,
  }
}

function createBrowserDataUrlFilePart(input: {
  name: string
  mimeType: 'image/png'
  dataUrl: string
}): FileUIPart {
  return {
    type: 'file',
    filename: input.name,
    mediaType: input.mimeType,
    url: input.dataUrl,
  }
}

function createBrowserBase64FilePart(input: {
  name: string
  mimeType: 'image/png'
  base64: string
}): FileUIPart {
  return createBrowserDataUrlFilePart({
    name: input.name,
    mimeType: input.mimeType,
    dataUrl: `data:${input.mimeType};base64,${input.base64}`,
  })
}

function inferBrowserPromptMediaType(url: string): string {
  const dataUrlMatch = /^data:([^;,]+)[;,]/i.exec(url)
  if (dataUrlMatch?.[1]) {
    return dataUrlMatch[1]
  }

  const normalizedUrl = url.toLowerCase()
  if (/\.(png)(?:[?#].*)?$/.test(normalizedUrl)) {
    return 'image/png'
  }
  if (/\.(jpe?g)(?:[?#].*)?$/.test(normalizedUrl)) {
    return 'image/jpeg'
  }
  if (/\.(webp)(?:[?#].*)?$/.test(normalizedUrl)) {
    return 'image/webp'
  }
  if (/\.(gif)(?:[?#].*)?$/.test(normalizedUrl)) {
    return 'image/gif'
  }
  if (/\.(pdf)(?:[?#].*)?$/.test(normalizedUrl)) {
    return 'application/pdf'
  }
  return 'application/octet-stream'
}

function createBrowserPromptFilePart(
  attachment: BrowserPromptAttachment,
  index: number,
): FileUIPart | null {
  const url = attachment.url.trim()
  if (!url) {
    return null
  }

  const filename = attachment.filename?.trim() || `browser-prompt-attachment-${index + 1}`
  const mediaType = attachment.mediaType?.trim() || inferBrowserPromptMediaType(url)
  return {
    type: 'file',
    filename,
    mediaType,
    url,
  }
}

function isBrowserPromptAttachment(value: unknown): value is BrowserPromptAttachment {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as BrowserPromptAttachment).url === 'string'
    && (
      (value as BrowserPromptAttachment).filename === undefined
      || typeof (value as BrowserPromptAttachment).filename === 'string'
    )
    && (
      (value as BrowserPromptAttachment).mediaType === undefined
      || typeof (value as BrowserPromptAttachment).mediaType === 'string'
    ),
  )
}

function isBrowserPromptRequest(value: unknown): value is BrowserPromptRequest {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as BrowserPromptRequest
  return typeof candidate.threadId === 'string'
    && typeof candidate.tabId === 'string'
    && typeof candidate.text === 'string'
    && Array.isArray(candidate.attachments)
    && candidate.attachments.every(isBrowserPromptAttachment)
}

function isBrowserAnnotationRuntimeEvent(value: unknown): value is BrowserAnnotationRuntimeEvent {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as BrowserAnnotationRuntimeEvent
  return typeof candidate.threadId === 'string'
    && typeof candidate.tabId === 'string'
    && (
      candidate.type === 'ready'
      || candidate.type === 'selected-element'
      || candidate.type === 'save'
      || candidate.type === 'submit'
      || candidate.type === 'cancel'
      || candidate.type === 'closed'
      || candidate.type === 'toggle'
    )
}

function isBrowserAnnotationAdjustmentApplyEvent(
  event: Event,
): event is CustomEvent<BrowserAnnotationAdjustmentApplyDetail> {
  if (!(event instanceof CustomEvent)) {
    return false
  }
  const detail = event.detail
  return Boolean(
    detail
    && typeof detail === 'object'
    && typeof (detail as BrowserAnnotationAdjustmentApplyDetail).ownerId === 'string'
    && typeof (detail as BrowserAnnotationAdjustmentApplyDetail).tabId === 'string',
  )
}

function screenshotFileNameForBrowserAnnotationUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '')
    return `${host || 'browser'}-annotation.png`
  }
  catch {
    return 'browser-annotation.png'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function readCdpScreenshotData(result: unknown): string | null {
  if (!isRecord(result) || typeof result.data !== 'string' || result.data.length === 0) {
    return null
  }
  return result.data
}

async function captureBrowserAnnotationScreenshot(input: {
  bridge: NonNullable<ReturnType<typeof readBrowserBridge>>
  threadId: string
  tabId: string
  url: string
}): Promise<FileUIPart> {
  try {
    const screenshot = await input.bridge.captureScreenshot({
      threadId: input.threadId,
      tabId: input.tabId,
    })
    return createBrowserScreenshotFilePart({
      name: screenshot.name,
      mimeType: screenshot.mimeType,
      bytes: screenshot.bytes,
    })
  }
  catch {
    const result = await input.bridge.executeCdp({
      threadId: input.threadId,
      tabId: input.tabId,
      method: 'Page.captureScreenshot',
      params: {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
      },
    })
    const data = readCdpScreenshotData(result)
    if (!data) {
      throw new Error('Couldn\'t capture a browser screenshot.')
    }
    return createBrowserBase64FilePart({
      name: screenshotFileNameForBrowserAnnotationUrl(input.url),
      mimeType: 'image/png',
      base64: data,
    })
  }
}

function formatBrowserAnnotationAnchor(anchor: BrowserAnnotationAnchor): string {
  if (anchor.kind === 'point') {
    return `point (${Math.round(anchor.x)}, ${Math.round(anchor.y)})`
  }
  if (anchor.kind === 'element') {
    const rect = anchor.element.rect
    return `element <${anchor.element.tagName.toLowerCase()}> (${Math.round(rect.x)}, ${Math.round(rect.y)}, ${Math.round(rect.width)} x ${Math.round(rect.height)})`
  }
  return `region (${Math.round(anchor.x)}, ${Math.round(anchor.y)}, ${Math.round(anchor.width)} x ${Math.round(anchor.height)})`
}

function getBrowserAnnotationCropRect(anchor: BrowserAnnotationAnchor): BrowserAnnotationCropRect | null {
  if (anchor.kind === 'point') {
    return null
  }
  if (anchor.kind === 'element') {
    return anchor.element.rect
  }
  return {
    x: anchor.x,
    y: anchor.y,
    width: anchor.width,
    height: anchor.height,
  }
}

async function createBrowserAnnotationCropFilePart(input: {
  imageDataUrl: string
  cropRect: BrowserAnnotationCropRect
  surfaceSize: { width: number, height: number }
}): Promise<FileUIPart | null> {
  if (
    input.cropRect.width <= 0
    || input.cropRect.height <= 0
    || input.surfaceSize.width <= 0
    || input.surfaceSize.height <= 0
  ) {
    return null
  }

  const image = new Image()
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Browser annotation crop image failed to load.'))
  })
  image.src = input.imageDataUrl
  await loaded

  const scaleX = image.naturalWidth / input.surfaceSize.width
  const scaleY = image.naturalHeight / input.surfaceSize.height
  const sourceX = Math.max(0, Math.floor(input.cropRect.x * scaleX))
  const sourceY = Math.max(0, Math.floor(input.cropRect.y * scaleY))
  const sourceWidth = Math.min(
    image.naturalWidth - sourceX,
    Math.max(1, Math.ceil(input.cropRect.width * scaleX)),
  )
  const sourceHeight = Math.min(
    image.naturalHeight - sourceY,
    Math.max(1, Math.ceil(input.cropRect.height * scaleY)),
  )

  const canvas = document.createElement('canvas')
  canvas.width = sourceWidth
  canvas.height = sourceHeight
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  )

  return createBrowserDataUrlFilePart({
    name: 'browser-annotation-target.png',
    mimeType: 'image/png',
    dataUrl: canvas.toDataURL('image/png'),
  })
}

function formatBrowserAnnotationElementDetails(anchor: BrowserAnnotationAnchor): string[] {
  if (anchor.kind !== 'element') {
    return []
  }
  const element = anchor.element
  return [
    `Element selector: ${element.selector}`,
    element.label ? `Element text: ${element.label}` : null,
    element.description ? `Element description: ${element.description}` : null,
    element.role ? `Element role: ${element.role}` : null,
    element.attributes?.testId ? `Element test id: ${element.attributes.testId}` : null,
    element.attributes?.href ? `Element href: ${element.attributes.href}` : null,
    element.attributes?.placeholder ? `Element placeholder: ${element.attributes.placeholder}` : null,
    'Element styles:',
    `- color: ${element.styles.color}`,
    `- background: ${element.styles.backgroundColor}`,
    `- opacity: ${element.styles.opacity}`,
    `- font: ${element.styles.fontFamily}`,
    `- font-size: ${element.styles.fontSize}`,
    `- font-weight: ${element.styles.fontWeight}`,
    `- line-height: ${element.styles.lineHeight}`,
    `- border-radius: ${element.styles.borderRadius}`,
    element.styles.borderColor ? `- border-color: ${element.styles.borderColor}` : null,
    element.styles.borderWidth ? `- border-width: ${element.styles.borderWidth}` : null,
    element.styles.display ? `- display: ${element.styles.display}` : null,
    element.styles.alignItems ? `- align-items: ${element.styles.alignItems}` : null,
    element.styles.justifyContent ? `- justify-content: ${element.styles.justifyContent}` : null,
    element.styles.flexDirection ? `- flex-direction: ${element.styles.flexDirection}` : null,
    element.styles.width ? `- width: ${element.styles.width}` : null,
    element.styles.height ? `- height: ${element.styles.height}` : null,
    element.styles.marginTop ? `- margin-top: ${element.styles.marginTop}` : null,
    element.styles.marginRight ? `- margin-right: ${element.styles.marginRight}` : null,
    element.styles.marginBottom ? `- margin-bottom: ${element.styles.marginBottom}` : null,
    element.styles.marginLeft ? `- margin-left: ${element.styles.marginLeft}` : null,
    element.styles.paddingTop ? `- padding-top: ${element.styles.paddingTop}` : null,
    element.styles.paddingRight ? `- padding-right: ${element.styles.paddingRight}` : null,
    element.styles.paddingBottom ? `- padding-bottom: ${element.styles.paddingBottom}` : null,
    element.styles.paddingLeft ? `- padding-left: ${element.styles.paddingLeft}` : null,
    element.styles.rowGap ? `- row-gap: ${element.styles.rowGap}` : null,
    element.styles.columnGap ? `- column-gap: ${element.styles.columnGap}` : null,
  ].filter(line => line !== null)
}

function formatBrowserAnnotationDesignChange(
  designChange: BrowserAnnotationDesignChange | null,
): string[] {
  if (!designChange) {
    return []
  }

  const rows = [
    ['color', designChange.color],
    ['background', designChange.backgroundColor],
    ['opacity', designChange.opacity],
    ['font', designChange.fontFamily],
    ['font-size', designChange.fontSize],
    ['font-weight', designChange.fontWeight],
    ['border-radius', designChange.borderRadius],
    ['border-color', designChange.borderColor],
    ['border-width', designChange.borderWidth],
    ['display', designChange.display],
    ['align-items', designChange.alignItems],
    ['justify-content', designChange.justifyContent],
    ['flex-direction', designChange.flexDirection],
    ['width', designChange.width],
    ['height', designChange.height],
    ['margin-top', designChange.marginTop],
    ['margin-right', designChange.marginRight],
    ['margin-bottom', designChange.marginBottom],
    ['margin-left', designChange.marginLeft],
    ['padding-top', designChange.paddingTop],
    ['padding-right', designChange.paddingRight],
    ['padding-bottom', designChange.paddingBottom],
    ['padding-left', designChange.paddingLeft],
    ['row-gap', designChange.rowGap],
    ['column-gap', designChange.columnGap],
    ['comment', designChange.comment],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `- ${label}: ${value}`)

  return rows.length > 0 ? ['Requested design changes:', ...rows] : []
}

function formatBrowserAnnotationSummary(annotation: BrowserAnnotationRecord): string {
  if (annotation.body) {
    return annotation.body
  }
  if (annotation.designChange) {
    return 'Design change'
  }
  if (annotation.attachedImages.length > 0) {
    return `${annotation.attachedImages.length} attached image${annotation.attachedImages.length === 1 ? '' : 's'}`
  }
  return formatBrowserAnnotationAnchor(annotation.anchor)
}

function countBrowserAnnotationDesignChanges(
  designChange: BrowserAnnotationDesignChange | null,
): number {
  if (!designChange) {
    return 0
  }
  return Object.values(designChange).filter(value => Boolean(value?.trim())).length
}

function hasBrowserAnnotationDesignChanges(
  designChange: BrowserAnnotationDesignChange | null | undefined,
): boolean {
  return countBrowserAnnotationDesignChanges(designChange ?? null) > 0
}

function getBrowserAnnotationPreviewTarget(
  annotation: BrowserAnnotationRecord,
): { style: CSSProperties, mode: 'point' | 'rect' } | null {
  const { width, height } = annotation.surfaceSize
  if (width <= 0 || height <= 0) {
    return null
  }
  if (annotation.anchor.kind === 'point') {
    return {
      mode: 'point',
      style: {
        left: `${(annotation.anchor.x / width) * 100}%`,
        top: `${(annotation.anchor.y / height) * 100}%`,
      },
    }
  }

  const rect = annotation.anchor.kind === 'element'
    ? annotation.anchor.element.rect
    : annotation.anchor
  return {
    mode: 'rect',
    style: {
      left: `${(rect.x / width) * 100}%`,
      top: `${(rect.y / height) * 100}%`,
      width: `${(rect.width / width) * 100}%`,
      height: `${(rect.height / height) * 100}%`,
    },
  }
}

function createBrowserAnnotationPrompt(input: {
  body: string
  anchor: BrowserAnnotationAnchor
  attachedImageCount: number
  designChange: BrowserAnnotationDesignChange | null
  includesTargetCrop: boolean
  title: string
  url: string
  surfaceSize: { width: number, height: number }
}): string {
  return [
    `Browser annotation on "${input.title}".`,
    `URL: ${input.url}`,
    `Viewport: ${Math.round(input.surfaceSize.width)} x ${Math.round(input.surfaceSize.height)} px`,
    `Target: ${formatBrowserAnnotationAnchor(input.anchor)}`,
    input.includesTargetCrop
      ? 'Attached screenshots: full viewport and target crop'
      : 'Attached screenshots: full viewport',
    input.attachedImageCount > 0 ? `Additional attached images: ${input.attachedImageCount}` : null,
    ...formatBrowserAnnotationElementDetails(input.anchor),
    ...formatBrowserAnnotationDesignChange(input.designChange),
    '',
    input.body,
  ].filter(line => line !== null).join('\n')
}

export function BrowserPanel({
  ownerId = null,
  activeSessionId = null,
  activeSessionTitle = null,
  nativeBoundsPaused = false,
  onCloseLastTab,
}: BrowserPanelProps) {
  const resolvedOwnerId = ownerId ?? DEFAULT_BROWSER_PANEL_OWNER_ID
  const selectBrowserState = useMemo(
    () => selectOwnerBrowserState(resolvedOwnerId),
    [resolvedOwnerId],
  )
  const selectBrowserHistory = useMemo(
    () => selectOwnerBrowserHistory(resolvedOwnerId),
    [resolvedOwnerId],
  )
  const selectBrowserAnnotations = useMemo(
    () => selectOwnerBrowserAnnotations(resolvedOwnerId),
    [resolvedOwnerId],
  )
  const browserState = useBrowserPanelStore(selectBrowserState)
  const recentHistory = useBrowserPanelStore(selectBrowserHistory)
  const requestedTab = useBrowserPanelStore(
    state => state.owners[resolvedOwnerId]?.requestedTab ?? null,
  )
  const setActiveOwner = useBrowserPanelStore(state => state.setActiveOwner)
  const upsertOwnerState = useBrowserPanelStore(state => state.upsertOwnerState)
  const fulfillRequestedTab = useBrowserPanelStore(state => state.fulfillRequestedTab)
  const removeOwnerState = useBrowserPanelStore(state => state.removeOwnerState)
  const setActiveTab = useBrowserPanelStore(state => state.setActiveTab)
  const closePanelTab = useBrowserPanelStore(state => state.closeTab)
  const openWorkspaceFileTab = useBrowserPanelStore(state => state.openWorkspaceFileTab)
  const openContextUsageReportTab = useBrowserPanelStore(
    state => state.openContextUsageReportTab,
  )
  const saveAnnotation = useBrowserPanelStore(state => state.saveAnnotation)
  const markAnnotationSent = useBrowserPanelStore(state => state.markAnnotationSent)
  const deleteAnnotation = useBrowserPanelStore(state => state.deleteAnnotation)
  const clearAnnotations = useBrowserPanelStore(state => state.clearAnnotations)
  const annotationAdjustmentSession = useBrowserPanelStore(state => state.annotationAdjustmentSession)
  const setAnnotationAdjustmentSession = useBrowserPanelStore(
    state => state.setAnnotationAdjustmentSession,
  )
  const setAnnotationTrayCollapsed = useBrowserPanelStore(
    state => state.setAnnotationTrayCollapsed,
  )
  const ownerAnnotations = useBrowserPanelStore(selectBrowserAnnotations)
  const annotationTrayCollapsed = useBrowserPanelStore(
    state => state.annotationTrayCollapsedByOwnerId[resolvedOwnerId] ?? false,
  )

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const previousActiveTabIdRef = useRef<string | null>(null)
  const addressDraftByTabIdRef = useRef<Map<string, string>>(new Map())
  const lastSyncedAddressValueRef = useRef<string | undefined>(undefined)
  const previousAnnotationRuntimeTabIdRef = useRef<string | null>(null)
  const stableBoundsFrameCountRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const localServerDiscoveryRequestRef = useRef(0)
  const nativeBoundsPreviewRequestRef = useRef(0)
  const nativeBoundsPausedRef = useRef(nativeBoundsPaused)

  const [addressValue, setAddressValue] = useState('')
  const [isEditingAddress, setIsEditingAddress] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [annotationSession, setAnnotationSession] = useState<BrowserAnnotationRuntimeSession | null>(
    null,
  )
  const [, setAnnotationSubmitting] = useState(false)
  const [nativeBoundsPreview, setNativeBoundsPreview] = useState<BrowserNativeBoundsPreview | null>(
    null,
  )
  const [localServers, setLocalServers] = useState<BrowserLocalServer[]>(
    EMPTY_BROWSER_LOCAL_SERVERS,
  )
  const [localServersLoading, setLocalServersLoading] = useState(false)

  useEffect(() => {
    nativeBoundsPausedRef.current = nativeBoundsPaused
  }, [nativeBoundsPaused])
  const [localServersError, setLocalServersError] = useState<string | null>(null)

  const tabs = useBrowserPanelStore(
    state => state.owners[resolvedOwnerId]?.tabs ?? EMPTY_BROWSER_PANEL_TABS,
  )
  const activePanelTabId = useBrowserPanelStore(
    state => state.owners[resolvedOwnerId]?.activeTabId ?? null,
  )
  const browserTabs = useMemo(() => tabs.filter(isBrowserPanelTab), [tabs])
  const activePanelTab = tabs.find(tab => tab.id === activePanelTabId) ?? tabs[0] ?? null
  const activeBrowserTab = activePanelTab?.kind === 'browser' ? activePanelTab : null
  const activeBrowserTabId = activeBrowserTab?.id ?? null
  const activeBrowserTabUrl = activeBrowserTab?.lastCommittedUrl ?? activeBrowserTab?.url ?? null
  const activeBrowserTabIsBlank = isBrowserBlankTab(activeBrowserTab)
  const activeBrowserAnnotations = useMemo(
    () => ownerAnnotations.filter(annotation => annotation.tabId === activeBrowserTabId),
    [activeBrowserTabId, ownerAnnotations],
  )
  const activeAnnotationSession = annotationSession?.tabId === activeBrowserTabId
    ? annotationSession
    : null
  const hasActiveAnnotationSession = activeAnnotationSession !== null
  const suggestions = useMemo(
    () =>
      buildBrowserAddressSuggestions({
        query: addressValue,
        activeTabId: activeBrowserTabId,
        tabs: browserTabs,
        recentHistory,
      }),
    [activeBrowserTabId, addressValue, browserTabs, recentHistory],
  )
  const chromeStatus = activePanelTab?.kind === 'browser' || localError || browserState?.lastError
    ? resolveBrowserChromeStatus({
      localError,
      threadLastError: browserState?.lastError,
      activeTabStatus: activeBrowserTab?.status ?? 'suspended',
      hasActiveTab: Boolean(activeBrowserTab),
      workspaceReady: Boolean(browserState),
    })
    : null
  const chromeStatusLabel = chromeStatus?.label ?? null
  const chromeStatusTone = chromeStatus?.tone ?? null

  const refreshLocalServers = useCallback(() => {
    const bridge = readBrowserBridge()
    const requestId = localServerDiscoveryRequestRef.current + 1
    localServerDiscoveryRequestRef.current = requestId

    if (!bridge) {
      setLocalServers(EMPTY_BROWSER_LOCAL_SERVERS)
      setLocalServersLoading(false)
      setLocalServersError('Local discovery is available in the desktop app.')
      return
    }

    setLocalServersLoading(true)
    setLocalServersError(null)
    void bridge
      .discoverLocalServers()
      .then((servers) => {
        if (localServerDiscoveryRequestRef.current !== requestId) {
          return
        }
        setLocalServers(servers)
      })
      .catch((error) => {
        if (localServerDiscoveryRequestRef.current !== requestId) {
          return
        }
        const message = error instanceof Error ? error.message : 'Local discovery failed.'
        setLocalServers(EMPTY_BROWSER_LOCAL_SERVERS)
        setLocalServersError(message)
      })
      .finally(() => {
        if (localServerDiscoveryRequestRef.current !== requestId) {
          return
        }
        setLocalServersLoading(false)
      })
  }, [])

  useEffect(() => {
    return () => {
      localServerDiscoveryRequestRef.current += 1
      nativeBoundsPreviewRequestRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!activeBrowserTabIsBlank) {
      return
    }
    refreshLocalServers()
  }, [activeBrowserTabId, activeBrowserTabIsBlank, refreshLocalServers])

  useEffect(() => {
    setActiveOwner(resolvedOwnerId)
  }, [resolvedOwnerId, setActiveOwner])

  useEffect(() => {
    const bridge = readBrowserBridge()
    if (!bridge) {
      return
    }

    const unsubscribe = bridge.onState((state) => {
      upsertOwnerState(state)
    })

    void bridge
      .getState({ threadId: resolvedOwnerId })
      .then(upsertOwnerState)
      .catch((error) => {
        setLocalError(formatBrowserActionError(error))
      })

    return () => {
      setAnnotationSession(null)
      setAnnotationSubmitting(false)
      unsubscribe()
      void bridge.hide({ threadId: resolvedOwnerId }).catch(() => { })
    }
  }, [resolvedOwnerId, upsertOwnerState])

  useEffect(() => {
    if (!requestedTab) {
      return
    }

    const bridge = readBrowserBridge()
    if (!bridge) {
      fulfillRequestedTab(requestedTab.id, resolvedOwnerId)
      return
    }

    const url = requestedTab.url ?? 'about:blank'
    const action = browserState?.open
      ? bridge.newTab({ threadId: resolvedOwnerId, url, activate: true })
      : bridge.open({ threadId: resolvedOwnerId, initialUrl: url })

    void action
      .then((nextState) => {
        upsertOwnerState(nextState)
        if (nextState.activeTabId) {
          setActiveTab(nextState.activeTabId, resolvedOwnerId)
        }
      })
      .catch((error) => {
        setLocalError(formatBrowserActionError(error))
      })
      .finally(() => {
        fulfillRequestedTab(requestedTab.id, resolvedOwnerId)
      })
  }, [
    browserState?.open,
    fulfillRequestedTab,
    requestedTab,
    resolvedOwnerId,
    setActiveTab,
    upsertOwnerState,
  ])

  const hideNativeBrowserSurface = useCallback(() => {
    readBrowserBridge()?.setBounds({ threadId: resolvedOwnerId, bounds: null, surface: 'native' })
  }, [resolvedOwnerId])

  const syncBounds = useCallback(() => {
    if (nativeBoundsPausedRef.current && !hasActiveAnnotationSession) {
      return
    }

    const bridge = readBrowserBridge()
    const element = viewportRef.current
    if (!bridge || !element) {
      return
    }

    const rect = element.getBoundingClientRect()
    const visible
      = rect.width > 0
        && rect.height > 0
        && browserState?.open
        && activePanelTab?.kind === 'browser'
        && !activeBrowserTabIsBlank
    if (!visible) {
      hideNativeBrowserSurface()
      return
    }

    bridge.setBounds({
      threadId: resolvedOwnerId,
      surface: 'native',
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    })
  }, [
    activeBrowserTabIsBlank,
    activePanelTab?.kind,
    browserState?.open,
    hasActiveAnnotationSession,
    hideNativeBrowserSurface,
    resolvedOwnerId,
  ])

  const scheduleStableBoundsSync = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (nativeBoundsPausedRef.current && !hasActiveAnnotationSession) {
      return
    }
    if (animationFrameRef.current !== null) {
      return
    }

    const tick = () => {
      if (typeof window === 'undefined') {
        animationFrameRef.current = null
        stableBoundsFrameCountRef.current = 0
        return
      }
      syncBounds()
      stableBoundsFrameCountRef.current += 1
      if (stableBoundsFrameCountRef.current < BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET) {
        animationFrameRef.current = window.requestAnimationFrame(tick)
        return
      }
      animationFrameRef.current = null
      stableBoundsFrameCountRef.current = 0
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }, [hasActiveAnnotationSession, syncBounds])

  const scheduleStableBoundsSyncFromObserver = useEffectEvent(() => {
    scheduleStableBoundsSync()
  })

  const hideNativeBrowserSurfaceFromObserver = useEffectEvent(() => {
    hideNativeBrowserSurface()
  })

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) {
      hideNativeBrowserSurfaceFromObserver()
      return
    }

    scheduleStableBoundsSyncFromObserver()
    const resizeObserver = new ResizeObserver(scheduleStableBoundsSyncFromObserver)
    resizeObserver.observe(element)
    window.addEventListener('resize', scheduleStableBoundsSyncFromObserver)
    window.addEventListener('scroll', scheduleStableBoundsSyncFromObserver, true)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleStableBoundsSyncFromObserver)
      window.removeEventListener('scroll', scheduleStableBoundsSyncFromObserver, true)
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      hideNativeBrowserSurfaceFromObserver()
    }
  }, [activePanelTab?.kind])

  useEffect(() => {
    if (!nativeBoundsPaused || hasActiveAnnotationSession) {
      nativeBoundsPreviewRequestRef.current += 1
      scheduleStableBoundsSync()
      return
    }

    const bridge = readBrowserBridge()
    if (
      !bridge
      || !browserState?.open
      || activePanelTab?.kind !== 'browser'
      || !activeBrowserTabId
      || !activeBrowserTabUrl
      || activeBrowserTabIsBlank
    ) {
      nativeBoundsPreviewRequestRef.current += 1
      hideNativeBrowserSurface()
      return
    }

    const requestId = nativeBoundsPreviewRequestRef.current + 1
    nativeBoundsPreviewRequestRef.current = requestId
    const tabId = activeBrowserTabId
    const url = activeBrowserTabUrl

    void bridge
      .captureScreenshot({ threadId: resolvedOwnerId, tabId })
      .then((screenshot) => {
        if (nativeBoundsPreviewRequestRef.current !== requestId) {
          return
        }

        setNativeBoundsPreview({
          tabId,
          url,
          imageDataUrl: `data:${screenshot.mimeType};base64,${bytesToBase64(screenshot.bytes)}`,
        })
        window.requestAnimationFrame(() => {
          if (nativeBoundsPreviewRequestRef.current !== requestId) {
            return
          }
          hideNativeBrowserSurface()
        })
      })
      .catch(() => {
        if (nativeBoundsPreviewRequestRef.current !== requestId) {
          return
        }
        setNativeBoundsPreview(null)
        hideNativeBrowserSurface()
      })
  }, [
    activeBrowserTabId,
    activeBrowserTabIsBlank,
    activeBrowserTabUrl,
    activePanelTab?.kind,
    hasActiveAnnotationSession,
    browserState?.open,
    hideNativeBrowserSurface,
    nativeBoundsPaused,
    resolvedOwnerId,
    scheduleStableBoundsSync,
  ])

  useEffect(() => {
    const bridge = readBrowserBridge()
    const selectedElement = annotationAdjustmentSession?.selectedElement
    if (
      !bridge
      || activeAnnotationSession === null
      || !activeBrowserTab
      || !activeBrowserTabId
      || !selectedElement
      || annotationAdjustmentSession.ownerId !== resolvedOwnerId
      || annotationAdjustmentSession.tabId !== activeBrowserTabId
    ) {
      return
    }

    const designChange = annotationAdjustmentSession.designChanges

    void (async () => {
      if (hasBrowserAnnotationDesignChanges(designChange)) {
        await bridge.applyAnnotationDesign({
          threadId: resolvedOwnerId,
          tabId: activeBrowserTabId,
          selector: selectedElement.selector,
          designChange,
        })
      }
      else {
        await bridge.applyAnnotationDesign({
          threadId: resolvedOwnerId,
          tabId: activeBrowserTabId,
          selector: selectedElement.selector,
          designChange: {},
        })
      }
    })().catch((error) => {
      setLocalError(formatBrowserActionError(error))
    })
  }, [
    activeBrowserTab,
    activeBrowserTabId,
    annotationAdjustmentSession,
    activeAnnotationSession,
    resolvedOwnerId,
  ])

  useEffect(() => {
    scheduleStableBoundsSync()
  }, [
    activeBrowserTabIsBlank,
    activePanelTab?.id,
    hasActiveAnnotationSession,
    chromeStatusLabel,
    chromeStatusTone,
    scheduleStableBoundsSync,
    suggestionsOpen,
  ])

  useEffect(() => {
    const previousAnnotationRuntimeTabId = previousAnnotationRuntimeTabIdRef.current
    if (previousAnnotationRuntimeTabId) {
      void readBrowserBridge()?.clearAnnotationDesign({
        threadId: resolvedOwnerId,
        tabId: previousAnnotationRuntimeTabId,
      }).catch(() => { })
    }
    previousAnnotationRuntimeTabIdRef.current = activeBrowserTabId
    setAnnotationAdjustmentSession(null)
  }, [activeBrowserTabId, resolvedOwnerId, setAnnotationAdjustmentSession])

  useEffect(() => {
    const nextDisplayValue = browserAddressDisplayValue(activeBrowserTab)
    const decision = resolveBrowserAddressSync({
      activeTabId: activeBrowserTabId,
      previousActiveTabId: previousActiveTabIdRef.current,
      savedDraft: activeBrowserTabId
        ? addressDraftByTabIdRef.current.get(activeBrowserTabId)
        : undefined,
      nextDisplayValue,
      lastSyncedValue: lastSyncedAddressValueRef.current,
      isEditing: isEditingAddress,
    })
    previousActiveTabIdRef.current = activeBrowserTabId

    if (decision.type === 'replace') {
      setAddressValue(decision.value)
      lastSyncedAddressValueRef.current = decision.syncedValue
    }
  }, [activeBrowserTab, activeBrowserTabId, isEditingAddress])

  const runBrowserAction = useCallback(async (action: () => Promise<unknown>) => {
    setLocalError(null)
    try {
      await action()
    }
    catch (error) {
      const message = formatBrowserActionError(error)
      if (message) {
        setLocalError(message)
      }
    }
  }, [])

  useEffect(() => {
    const bridge = readBrowserBridge()
    if (!bridge?.onPromptRequested) {
      return undefined
    }

    return bridge.onPromptRequested((request) => {
      if (!isBrowserPromptRequest(request) || request.threadId !== resolvedOwnerId) {
        return
      }

      const ownerState = useBrowserPanelStore.getState().owners[resolvedOwnerId]
      const sourceTab = ownerState?.tabs.find(
        (tab): tab is BrowserWebTab => tab.id === request.tabId && tab.kind === 'browser',
      ) ?? null
      const targetSessionId = sourceTab?.sessionId ?? activeSessionId
      if (!targetSessionId) {
        setLocalError('Open a chat session to receive browser page prompts.')
        return
      }

      const files = request.attachments
        .map(createBrowserPromptFilePart)
        .filter(file => file !== null)
      const sent = submitChatPromptIngress(targetSessionId, {
        text: request.text,
        files,
      })
      if (!sent) {
        setLocalError('The target composer is not ready for browser page prompts.')
      }
    })
  }, [activeSessionId, resolvedOwnerId])

  const handleNewTab = useCallback(() => {
    const bridge = readBrowserBridge()
    if (!bridge) {
      return
    }
    void runBrowserAction(async () => {
      const nextState = browserState?.open
        ? await bridge.newTab({
          threadId: resolvedOwnerId,
          url: 'about:blank',
          activate: true,
        })
        : await bridge.open({ threadId: resolvedOwnerId, initialUrl: 'about:blank' })
      upsertOwnerState(nextState)
      if (nextState.activeTabId) {
        setActiveTab(nextState.activeTabId, resolvedOwnerId)
      }
    })
  }, [browserState?.open, resolvedOwnerId, runBrowserAction, setActiveTab, upsertOwnerState])

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find(item => item.id === tabId)
      if (!tab) {
        return
      }

      if (tab.kind !== 'browser') {
        if (tab.kind === 'side-conversation') {
          void releaseSideConversation(tab.sideConversationId)
        }
        const result = closePanelTab(tabId, resolvedOwnerId)
        if (result.closedLastTab) {
          removeOwnerState(resolvedOwnerId)
          onCloseLastTab?.(resolvedOwnerId)
          return
        }
        const nextOwnerState = useBrowserPanelStore.getState().owners[resolvedOwnerId]
        const nextActiveBrowserTab = nextOwnerState?.tabs.find(
          item => item.id === nextOwnerState.activeTabId && item.kind === 'browser',
        )
        const bridge = readBrowserBridge()
        if (nextActiveBrowserTab && bridge) {
          void runBrowserAction(async () => {
            upsertOwnerState(
              await bridge.selectTab({
                threadId: resolvedOwnerId,
                tabId: nextActiveBrowserTab.id,
              }),
            )
          })
        }
        return
      }

      const bridge = readBrowserBridge()
      if (!bridge) {
        const result = closePanelTab(tabId, resolvedOwnerId)
        if (result.closedLastTab) {
          removeOwnerState(resolvedOwnerId)
          onCloseLastTab?.(resolvedOwnerId)
        }
        return
      }

      void runBrowserAction(async () => {
        const nextState = await bridge.closeTab({ threadId: resolvedOwnerId, tabId })
        upsertOwnerState(nextState)
        const remainingTabs
          = useBrowserPanelStore.getState().owners[resolvedOwnerId]?.tabs ?? EMPTY_BROWSER_PANEL_TABS
        if (remainingTabs.length === 0) {
          removeOwnerState(resolvedOwnerId)
          onCloseLastTab?.(resolvedOwnerId)
        }
      })
    },
    [
      closePanelTab,
      onCloseLastTab,
      removeOwnerState,
      resolvedOwnerId,
      runBrowserAction,
      tabs,
      upsertOwnerState,
    ],
  )

  const handleSelectTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find(item => item.id === tabId)
      if (!tab) {
        return
      }
      if (tab.kind !== 'browser') {
        setActiveTab(tabId, resolvedOwnerId)
        return
      }

      const bridge = readBrowserBridge()
      if (!bridge) {
        setActiveTab(tabId, resolvedOwnerId)
        return
      }
      void runBrowserAction(async () => {
        upsertOwnerState(await bridge.selectTab({ threadId: resolvedOwnerId, tabId }))
        setActiveTab(tabId, resolvedOwnerId)
      })
    },
    [resolvedOwnerId, runBrowserAction, setActiveTab, tabs, upsertOwnerState],
  )

  const navigateActiveTab = useCallback(
    (url: string) => {
      if (!activeBrowserTabId) {
        return
      }
      const bridge = readBrowserBridge()
      if (!bridge) {
        return
      }
      void runBrowserAction(async () => {
        const normalizedUrl = normalizeBrowserAddressInput(url)
        upsertOwnerState(
          await bridge.navigate({
            threadId: resolvedOwnerId,
            tabId: activeBrowserTabId,
            url: normalizedUrl,
          }),
        )
        lastSyncedAddressValueRef.current = browserAddressDisplayValue({ url: normalizedUrl })
        addressDraftByTabIdRef.current.delete(activeBrowserTabId)
        setSuggestionsOpen(false)
      })
    },
    [activeBrowserTabId, resolvedOwnerId, runBrowserAction, upsertOwnerState],
  )

  const handleSuggestion = useCallback(
    (suggestion: BrowserAddressSuggestion) => {
      if (suggestion.kind === 'tab' && suggestion.tabId) {
        handleSelectTab(suggestion.tabId)
        setSuggestionsOpen(false)
        return
      }
      navigateActiveTab(suggestion.url)
    },
    [handleSelectTab, navigateActiveTab],
  )

  const handleAddressSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      navigateActiveTab(addressValue)
    },
    [addressValue, navigateActiveTab],
  )

  const handleCaptureScreenshot = useCallback(() => {
    if (!activeBrowserTabId) {
      return
    }
    const bridge = readBrowserBridge()
    if (!bridge) {
      return
    }
    void runBrowserAction(async () => {
      if (!activeSessionId) {
        throw new Error('Open a chat session to attach browser screenshots.')
      }
      const screenshot = await bridge.captureScreenshot({
        threadId: resolvedOwnerId,
        tabId: activeBrowserTabId,
      })
      const attached = submitChatComposerFileIngress(activeSessionId, [
        createBrowserScreenshotFilePart({
          name: screenshot.name,
          mimeType: screenshot.mimeType,
          bytes: screenshot.bytes,
        }),
      ])
      if (!attached) {
        throw new Error('The active composer is not ready for browser screenshots.')
      }
    })
  }, [activeBrowserTabId, activeSessionId, resolvedOwnerId, runBrowserAction])

  const handleStartAnnotation = useCallback(() => {
    if (!activeBrowserTabId) {
      return
    }
    const bridge = readBrowserBridge()
    const viewport = viewportRef.current
    if (!bridge || !viewport) {
      return
    }
    void runBrowserAction(async () => {
      await bridge.clearAnnotationDesign({
        threadId: resolvedOwnerId,
        tabId: activeBrowserTabId,
      }).catch(() => { })
      const rect = viewport.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        throw new Error('The browser viewport isn\'t ready for annotation.')
      }
      await bridge.startAnnotationRuntime({
        threadId: resolvedOwnerId,
        tabId: activeBrowserTabId,
      })
      setAnnotationAdjustmentSession(null)
      setAnnotationSession({
        tabId: activeBrowserTabId,
        editingAnnotationId: null,
      })
    })
  }, [
    activeBrowserTabId,
    resolvedOwnerId,
    runBrowserAction,
    setAnnotationAdjustmentSession,
  ])

  const buildBrowserAnnotationRecordInput = useCallback(async (
    input: BrowserAnnotationRuntimeEvent,
  ): Promise<Omit<BrowserAnnotationRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'> | null> => {
    if (!input.anchor) {
      return null
    }
    const bridge = readBrowserBridge()
    if (!bridge) {
      throw new Error('Browser annotations are available in the desktop app.')
    }
    const ownerState = useBrowserPanelStore.getState().owners[resolvedOwnerId]
    const sourceTab = ownerState?.tabs.find(
      (tab): tab is BrowserWebTab => tab.id === input.tabId && tab.kind === 'browser',
    ) ?? null
    const sourceUrl = input.sourceUrl ?? sourceTab?.lastCommittedUrl ?? sourceTab?.url ?? ''
    const screenshot = await captureBrowserAnnotationScreenshot({
      bridge,
      threadId: resolvedOwnerId,
      tabId: input.tabId,
      url: sourceUrl,
    })
    const attachedImages = (input.attachedImages ?? [])
      .map(createBrowserPromptFilePart)
      .filter(file => file !== null)
    const fallbackSurfaceRect = viewportRef.current?.getBoundingClientRect()
    const designChange = input.designChange ?? null
    return {
      ownerId: resolvedOwnerId,
      tabId: input.tabId,
      title: input.sourceTitle ?? (sourceTab ? getTabTitle(sourceTab) : sourceUrl),
      url: sourceUrl,
      body: input.body ?? '',
      anchor: input.anchor,
      designChange: hasBrowserAnnotationDesignChanges(designChange)
        ? designChange
        : null,
      attachedImages,
      screenshot,
      elements: input.elements ?? [],
      surfaceSize: input.surfaceSize ?? {
        width: fallbackSurfaceRect?.width ?? 0,
        height: fallbackSurfaceRect?.height ?? 0,
      },
    }
  }, [resolvedOwnerId])

  const sendBrowserAnnotationRecord = useCallback(async (record: BrowserAnnotationRecord) => {
    if (!activeSessionId) {
      setLocalError('Open a chat session to send browser annotations.')
      return false
    }

    const cropRect = getBrowserAnnotationCropRect(record.anchor)
    const cropPart = cropRect
      ? await createBrowserAnnotationCropFilePart({
        imageDataUrl: record.screenshot.url,
        cropRect,
        surfaceSize: record.surfaceSize,
      }).catch(() => null)
      : null
    const files = cropPart
      ? [record.screenshot, cropPart, ...record.attachedImages]
      : [record.screenshot, ...record.attachedImages]
    const sent = submitChatPromptIngress(activeSessionId, {
      text: createBrowserAnnotationPrompt({
        body: record.body,
        anchor: record.anchor,
        attachedImageCount: record.attachedImages.length,
        designChange: record.designChange,
        includesTargetCrop: Boolean(cropPart),
        title: record.title,
        url: record.url,
        surfaceSize: record.surfaceSize,
      }),
      files,
    })
    if (!sent) {
      setLocalError('The active composer is not ready for browser annotations.')
    }
    return sent
  }, [activeSessionId])

  const clearAnnotationRuntimeDraft = useCallback(() => {
    if (!activeBrowserTabId) {
      return
    }
    void readBrowserBridge()?.clearAnnotationDesign({
      threadId: resolvedOwnerId,
      tabId: activeBrowserTabId,
    }).catch(() => { })
  }, [
    activeBrowserTabId,
    resolvedOwnerId,
  ])

  const stopAnnotationRuntime = useCallback((tabId: string | null = activeBrowserTabId) => {
    if (!tabId) {
      return
    }
    void readBrowserBridge()?.stopAnnotationRuntime({
      threadId: resolvedOwnerId,
      tabId,
    }).catch(() => { })
  }, [activeBrowserTabId, resolvedOwnerId])

  const closeAnnotationSession = useCallback(() => {
    clearAnnotationRuntimeDraft()
    setAnnotationAdjustmentSession(null)
    setAnnotationSession(null)
    setAnnotationSubmitting(false)
    scheduleStableBoundsSync()
  }, [
    clearAnnotationRuntimeDraft,
    scheduleStableBoundsSync,
    setAnnotationAdjustmentSession,
  ])

  const handleCancelAnnotation = useCallback(() => {
    stopAnnotationRuntime(activeAnnotationSession?.tabId ?? activeBrowserTabId)
    closeAnnotationSession()
  }, [
    activeAnnotationSession?.tabId,
    activeBrowserTabId,
    closeAnnotationSession,
    stopAnnotationRuntime,
  ])

  const handleRuntimeAnnotationCommit = useCallback((event: BrowserAnnotationRuntimeEvent) => {
    void (async () => {
      if (event.type === 'submit') {
        setAnnotationSubmitting(true)
      }
      const recordInput = await buildBrowserAnnotationRecordInput(event)
      if (!recordInput) {
        setAnnotationSubmitting(false)
        return
      }
      const annotationId = saveAnnotation({
        ...recordInput,
        id: annotationSession?.editingAnnotationId ?? undefined,
        status: 'saved',
      }, resolvedOwnerId)
      if (event.type === 'save') {
        closeAnnotationSession()
        return
      }
      const now = Date.now()
      const record: BrowserAnnotationRecord = {
        ...recordInput,
        id: annotationId,
        createdAt: now,
        updatedAt: now,
        status: 'saved',
      }
      const sent = await sendBrowserAnnotationRecord(record)
      if (!sent) {
        setAnnotationSubmitting(false)
        return
      }
      markAnnotationSent(annotationId, resolvedOwnerId)
      closeAnnotationSession()
    })()
  }, [
    buildBrowserAnnotationRecordInput,
    annotationSession?.editingAnnotationId,
    closeAnnotationSession,
    markAnnotationSent,
    resolvedOwnerId,
    saveAnnotation,
    sendBrowserAnnotationRecord,
  ])

  const handleApplyAnnotationAdjustment = useCallback((
    detail: BrowserAnnotationAdjustmentApplyDetail,
  ) => {
    if (detail.ownerId !== resolvedOwnerId || detail.tabId !== activeBrowserTabId) {
      return
    }
    if (
      !annotationAdjustmentSession
      || annotationAdjustmentSession.ownerId !== resolvedOwnerId
      || annotationAdjustmentSession.tabId !== activeBrowserTabId
      || !annotationAdjustmentSession.selectedElement
      || !hasBrowserAnnotationDesignChanges(annotationAdjustmentSession.designChanges)
    ) {
      return
    }

    const element = annotationAdjustmentSession.selectedElement
    const surfaceRect = viewportRef.current?.getBoundingClientRect()
    handleRuntimeAnnotationCommit({
      threadId: resolvedOwnerId,
      tabId: activeBrowserTabId,
      type: 'submit',
      anchor: { kind: 'element', element },
      selectedElement: element,
      body: '',
      attachedImages: [],
      designChange: annotationAdjustmentSession.designChanges,
      elements: [element],
      surfaceSize: {
        width: surfaceRect?.width ?? 0,
        height: surfaceRect?.height ?? 0,
      },
      sourceUrl: activeBrowserTabUrl,
      sourceTitle: activeBrowserTab ? getTabTitle(activeBrowserTab) : activeBrowserTabUrl,
    })
  }, [
    activeBrowserTab,
    activeBrowserTabId,
    activeBrowserTabUrl,
    annotationAdjustmentSession,
    handleRuntimeAnnotationCommit,
    resolvedOwnerId,
  ])

  const handleToggleAnnotation = useCallback(() => {
    if (hasActiveAnnotationSession) {
      handleCancelAnnotation()
      return
    }
    handleStartAnnotation()
  }, [handleCancelAnnotation, handleStartAnnotation, hasActiveAnnotationSession])

  useEffect(() => {
    const handleEvent = (event: Event) => {
      if (!isBrowserAnnotationAdjustmentApplyEvent(event)) {
        return
      }
      handleApplyAnnotationAdjustment(event.detail)
    }

    window.addEventListener(BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT, handleEvent)
    return () => {
      window.removeEventListener(BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT, handleEvent)
    }
  }, [handleApplyAnnotationAdjustment])

  useEffect(() => {
    const bridge = readBrowserBridge()
    if (!bridge?.onAnnotationRuntimeEvent) {
      return undefined
    }

    return bridge.onAnnotationRuntimeEvent((event) => {
      if (!isBrowserAnnotationRuntimeEvent(event) || event.threadId !== resolvedOwnerId) {
        return
      }
      if (event.type === 'ready') {
        setAnnotationSession(previous => previous ?? {
          tabId: event.tabId,
          editingAnnotationId: null,
        })
        return
      }
      if (event.type === 'toggle') {
        if (event.tabId !== activeBrowserTabId) {
          return
        }
        handleToggleAnnotation()
        return
      }
      if (event.type === 'selected-element') {
        if (event.selectedElement) {
          setAnnotationAdjustmentSession({
            ownerId: resolvedOwnerId,
            tabId: event.tabId,
            annotationId: annotationSession?.editingAnnotationId ?? null,
            selectedElement: event.selectedElement,
            designChanges: event.designChange ?? {},
          })
        }
        else {
          setAnnotationAdjustmentSession(null)
        }
        return
      }
      if (event.type === 'save' || event.type === 'submit') {
        handleRuntimeAnnotationCommit(event)
        return
      }
      if (event.type === 'cancel' || event.type === 'closed') {
        closeAnnotationSession()
      }
    })
  }, [
    activeBrowserTabId,
    annotationSession?.editingAnnotationId,
    closeAnnotationSession,
    handleToggleAnnotation,
    handleRuntimeAnnotationCommit,
    resolvedOwnerId,
    setAnnotationAdjustmentSession,
  ])

  const handleEditSavedAnnotation = useCallback((annotation: BrowserAnnotationRecord) => {
    if (activeBrowserTabId !== annotation.tabId) {
      return
    }
    const bridge = readBrowserBridge()
    if (!bridge) {
      return
    }
    void runBrowserAction(async () => {
      await bridge.startAnnotationRuntime({
        threadId: resolvedOwnerId,
        tabId: annotation.tabId,
      })
    })
    if (annotation.anchor.kind === 'element') {
      setAnnotationAdjustmentSession({
        ownerId: resolvedOwnerId,
        tabId: annotation.tabId,
        annotationId: annotation.id,
        selectedElement: annotation.anchor.element,
        designChanges: annotation.designChange ?? {},
      })
    }
    else {
      setAnnotationAdjustmentSession(null)
    }
    setAnnotationSession({
      tabId: annotation.tabId,
      editingAnnotationId: annotation.id,
    })
  }, [activeBrowserTabId, resolvedOwnerId, runBrowserAction, setAnnotationAdjustmentSession])

  const handleSendSavedAnnotation = useCallback((annotation: BrowserAnnotationRecord) => {
    void (async () => {
      const sent = await sendBrowserAnnotationRecord(annotation)
      if (sent) {
        markAnnotationSent(annotation.id, resolvedOwnerId)
      }
    })()
  }, [markAnnotationSent, resolvedOwnerId, sendBrowserAnnotationRecord])

  const handlePanelKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const isAnnotationToggle
        = event.nativeEvent.metaKey
          && event.nativeEvent.shiftKey
          && !event.nativeEvent.altKey
          && !event.nativeEvent.ctrlKey
          && event.nativeEvent.key.toLowerCase() === 'd'
      if (isAnnotationToggle) {
        event.preventDefault()
        event.stopPropagation()
        event.nativeEvent.stopImmediatePropagation()
        handleToggleAnnotation()
        return
      }

      const isCommandOnly
        = event.nativeEvent.metaKey
          && !event.nativeEvent.altKey
          && !event.nativeEvent.ctrlKey
          && !event.nativeEvent.shiftKey
      if (!isCommandOnly) {
        return
      }

      const key = event.nativeEvent.key.toLowerCase()
      if (key === 'w' && activePanelTab) {
        event.preventDefault()
        event.stopPropagation()
        event.nativeEvent.stopImmediatePropagation()
        handleCloseTab(activePanelTab.id)
        return
      }

      if (!/^\d$/.test(key)) {
        return
      }

      const targetIndex = key === '0' ? 9 : Number.parseInt(key, 10) - 1
      const targetTab = tabs[targetIndex]
      if (!targetTab) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      handleSelectTab(targetTab.id)
    },
    [activePanelTab, handleCloseTab, handleSelectTab, handleToggleAnnotation, tabs],
  )

  const handleOpenContextUsageReport = useCallback(() => {
    if (!activeSessionId) {
      return
    }
    openContextUsageReportTab({
      sessionId: activeSessionId,
      sessionTitle: activeSessionTitle,
      ownerId: resolvedOwnerId,
    })
  }, [activeSessionId, activeSessionTitle, openContextUsageReportTab, resolvedOwnerId])

  if (!isElectron) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-xs text-muted-foreground"
        data-testid="browser-panel"
      >
        Browser Panel is available in the desktop app.
      </div>
    )
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-testid="browser-panel"
      data-browser-panel-ready="true"
      onKeyDownCapture={handlePanelKeyDown}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 bg-card px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={cn(
                'group flex h-7 max-w-44 shrink-0 items-center rounded-md text-[11px] transition-colors',
                tab.id === activePanelTabId
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground',
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-l-md py-1 pl-2 pr-1 text-left"
                onClick={() => handleSelectTab(tab.id)}
                aria-current={tab.id === activePanelTabId ? 'page' : undefined}
              >
                {tab.kind === 'browser' && tab.isLoading && (
                  <LoaderCircleIcon
                    className="size-3 shrink-0 animate-spin text-primary"
                    aria-hidden="true"
                  />
                )}
                {tab.kind === 'browser' && !tab.isLoading && tab.faviconUrl && (
                  <img src={tab.faviconUrl} alt="" className="size-3 shrink-0 rounded-sm" />
                )}
                {tab.kind === 'browser' && !tab.isLoading && !tab.faviconUrl && (
                  <GlobeIcon
                    className="size-3 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                )}
                {tab.kind === 'workspace-file' && (
                  <FileTextIcon className="size-3 shrink-0 text-muted-foreground/60" />
                )}
                {tab.kind === 'workspace-diff' && (
                  <FileDiffIcon className="size-3 shrink-0 text-muted-foreground/60" />
                )}
                {tab.kind === 'subagent' && (
                  <BotIcon className="size-3 shrink-0 text-muted-foreground/60" />
                )}
                {tab.kind === 'side-conversation' && (
                  <MessageSquarePlusIcon className="size-3 shrink-0 text-muted-foreground/60" />
                )}
                {tab.kind === 'context-usage-report' && (
                  <GaugeIcon className="size-3 shrink-0 text-muted-foreground/60" />
                )}
                <span className="truncate">{getPanelTabTitle(tab)}</span>
                {tab.kind === 'browser'
                  && tab.sessionId
                  && tab.sessionId !== activeSessionId
                  && tab.sessionTitle && (
                    <span
                      className="ml-0.5 shrink-0 rounded-sm bg-foreground/7 px-1 text-[9px] text-muted-foreground"
                      aria-label={`From ${tab.sessionTitle}`}
                    >
                      {tab.sessionTitle}
                    </span>
                  )}
              </button>
              <button
                type="button"
                className="mr-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => handleCloseTab(tab.id)}
                aria-label={`Close ${getPanelTabTitle(tab)}`}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
            onClick={handleNewTab}
            aria-label="New browser tab"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
          onClick={handleOpenContextUsageReport}
          disabled={!activeSessionId}
          aria-label="Open context usage report"
          title="Context Usage Report"
        >
          <GaugeIcon className="size-3.5" />
        </button>
      </div>

      {
        activeBrowserTab && (
          <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-border/50 bg-card px-2">
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
                disabled={!activeBrowserTab?.canGoBack}
                onClick={() => {
                  const bridge = readBrowserBridge()
                  if (bridge && activeBrowserTabId) {
                    void runBrowserAction(async () => {
                      upsertOwnerState(
                        await bridge.goBack({ threadId: resolvedOwnerId, tabId: activeBrowserTabId }),
                      )
                    })
                  }
                }}
                aria-label="Go back"
              >
                <ArrowLeftIcon className="size-3.5" />
              </button>
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
                disabled={!activeBrowserTab?.canGoForward}
                onClick={() => {
                  const bridge = readBrowserBridge()
                  if (bridge && activeBrowserTabId) {
                    void runBrowserAction(async () => {
                      upsertOwnerState(
                        await bridge.goForward({
                          threadId: resolvedOwnerId,
                          tabId: activeBrowserTabId,
                        }),
                      )
                    })
                  }
                }}
                aria-label="Go forward"
              >
                <ArrowRightIcon className="size-3.5" />
              </button>
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
                disabled={!activeBrowserTabId}
                onClick={() => {
                  const bridge = readBrowserBridge()
                  if (bridge && activeBrowserTabId) {
                    void runBrowserAction(async () => {
                      upsertOwnerState(
                        await bridge.reload({
                          threadId: resolvedOwnerId,
                          tabId: activeBrowserTabId,
                        }),
                      )
                    })
                  }
                }}
                aria-label="Reload"
              >
                <RefreshCwIcon
                  className={cn('size-3.5', activeBrowserTab?.isLoading && 'animate-spin')}
                />
              </button>
            </div>

            <form className="relative min-w-0 flex-1" onSubmit={handleAddressSubmit}>
              <input
                type="text"
                value={addressValue}
                placeholder="Search or enter address"
                aria-label="Search or enter address"
                disabled={!activeBrowserTab}
                className="h-7 w-full rounded-md bg-foreground/5 px-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:bg-foreground/8"
                onFocus={() => {
                  setIsEditingAddress(true)
                  setSuggestionsOpen(true)
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    setIsEditingAddress(false)
                    setSuggestionsOpen(false)
                  }, 120)
                }}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setAddressValue(nextValue)
                  if (activeBrowserTabId) {
                    addressDraftByTabIdRef.current.set(activeBrowserTabId, nextValue)
                  }
                  setSuggestionsOpen(true)
                }}
              />
              {suggestionsOpen && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-8 z-20 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg">
                  {suggestions.map(suggestion => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-foreground/5"
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => handleSuggestion(suggestion)}
                    >
                      {suggestion.faviconUrl && (
                        <img
                          src={suggestion.faviconUrl}
                          alt=""
                          className="size-3.5 shrink-0 rounded-sm"
                        />
                      )}
                      {!suggestion.faviconUrl && (
                        <GlobeIcon
                          className="size-3.5 shrink-0 text-muted-foreground/60"
                          aria-hidden="true"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">{suggestion.title}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {suggestion.detail}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </form>

            <button
              type="button"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
              disabled={!activeBrowserTabId}
              onClick={handleCaptureScreenshot}
              aria-label="Attach screenshot to composer"
            >
              <CameraIcon className="size-3.5" />
            </button>
            <button
              type="button"
              className={cn(
                'flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs transition-colors disabled:opacity-30',
                hasActiveAnnotationSession
                  ? 'bg-primary/12 text-primary hover:bg-primary/16'
                  : 'text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground',
              )}
              disabled={!activeBrowserTabId}
              onClick={hasActiveAnnotationSession ? handleCancelAnnotation : handleStartAnnotation}
              aria-label={hasActiveAnnotationSession ? 'Cancel annotation' : 'Comment on browser'}
              title="Toggle browser comments (Command Shift D)"
            >
              <MessageSquarePlusIcon className="size-3.5" />
              <span>Comment</span>
            </button>
          </div>
        )
      }

      {chromeStatus && (
        <div
          className={cn(
            'flex h-7 shrink-0 items-center border-b px-3 text-[11px]',
            chromeStatus.tone === 'error'
              ? 'border-destructive/20 bg-destructive/8 text-destructive'
              : 'border-border/40 bg-muted/40 text-muted-foreground',
          )}
        >
          {chromeStatus.label}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {activePanelTab?.kind === 'browser' && (
          <div className="absolute inset-0 flex min-h-0 flex-col bg-background">
            <div ref={viewportRef} className="relative min-h-0 flex-1 bg-background">
              {activeBrowserTabIsBlank && (
                <BrowserNewTabSurface
                  localServers={localServers}
                  localServersLoading={localServersLoading}
                  localServersError={localServersError}
                  onOpenUrl={navigateActiveTab}
                  onRefreshLocalServers={refreshLocalServers}
                />
              )}
              {nativeBoundsPaused && !activeBrowserTabIsBlank && !hasActiveAnnotationSession && (
                <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden bg-background">
                  {nativeBoundsPreview?.tabId === activeBrowserTabId
                    && nativeBoundsPreview.url === activeBrowserTabUrl && (
                    <img
                      src={nativeBoundsPreview.imageDataUrl}
                      alt=""
                      className="size-full object-fill"
                      draggable={false}
                    />
                  )}
                </div>
              )}
            </div>

            {activeBrowserAnnotations.length > 0 && (
              <div className="relative z-20 shrink-0 border-t border-border/50 bg-card/95 backdrop-blur">
                <div className="flex h-9 items-center justify-between gap-2 px-2">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs font-medium text-foreground transition-colors hover:bg-foreground/5"
                    onClick={() =>
                      setAnnotationTrayCollapsed(!annotationTrayCollapsed, resolvedOwnerId)}
                    aria-expanded={!annotationTrayCollapsed}
                  >
                    <ChevronDownIcon
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground transition-transform',
                        annotationTrayCollapsed && '-rotate-90',
                      )}
                    />
                    <MessageSquarePlusIcon className="size-3.5 shrink-0 text-primary" />
                    <span className="truncate">Annotations</span>
                    <span className="rounded bg-foreground/7 px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                      {activeBrowserAnnotations.length}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground"
                    onClick={() =>
                      clearAnnotations({ ownerId: resolvedOwnerId, tabId: activeBrowserTabId })}
                  >
                    <Trash2Icon className="size-3.5" />
                    Clear all
                  </Button>
                </div>
                {!annotationTrayCollapsed && (
                  <div className="flex max-h-36 gap-2 overflow-x-auto px-2 pb-2">
                    {activeBrowserAnnotations.map((annotation) => {
                      const previewTarget = getBrowserAnnotationPreviewTarget(annotation)
                      const designChangeCount = countBrowserAnnotationDesignChanges(
                        annotation.designChange,
                      )
                      return (
                        <div
                          key={annotation.id}
                          className="w-80 max-w-[calc(100vw-32px)] shrink-0 overflow-hidden rounded-lg bg-background shadow-sm ring-1 ring-border/70"
                        >
                          <div className="relative h-20 overflow-hidden border-b border-border/50 bg-muted">
                            <img
                              src={annotation.screenshot.url}
                              alt=""
                              className="size-full object-cover"
                              draggable={false}
                            />
                            <div className="absolute inset-0 bg-black/5" aria-hidden="true" />
                            {previewTarget?.mode === 'rect' && (
                              <span
                                className="absolute rounded-sm border border-primary bg-primary/15 shadow-[0_0_0_1px_rgba(255,255,255,0.45)]"
                                style={previewTarget.style}
                                aria-hidden="true"
                              />
                            )}
                            {previewTarget?.mode === 'point' && (
                              <span
                                className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_3px_rgba(255,255,255,0.65)]"
                                style={previewTarget.style}
                                aria-hidden="true"
                              />
                            )}
                            {designChangeCount > 0 && (
                              <span className="absolute bottom-1.5 right-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] text-foreground shadow-sm ring-1 ring-border/70 backdrop-blur">
                                {designChangeCount}
                                {' '}
                                {designChangeCount === 1 ? 'adjustment' : 'adjustments'}
                              </span>
                            )}
                          </div>
                          <div className="p-2.5">
                            <div className="flex items-start gap-2">
                              <MessageSquarePlusIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-xs font-medium text-foreground">
                                    {formatBrowserAnnotationAnchor(annotation.anchor)}
                                  </span>
                                  <span
                                    className={cn(
                                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums',
                                      annotation.status === 'sent'
                                        ? 'bg-primary/10 text-primary'
                                        : 'bg-foreground/7 text-muted-foreground',
                                    )}
                                  >
                                    {annotation.status}
                                  </span>
                                </div>
                                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                  {formatBrowserAnnotationSummary(annotation)}
                                </div>
                              </div>
                            </div>
                            <div className="mt-2 flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleEditSavedAnnotation(annotation)}
                                aria-label="Edit browser annotation"
                              >
                                <PencilIcon className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => deleteAnnotation(annotation.id, resolvedOwnerId)}
                                aria-label="Delete browser annotation"
                              >
                                <Trash2Icon className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={() => handleSendSavedAnnotation(annotation)}
                              >
                                <SendIcon className="size-3.5" />
                                {annotation.status === 'sent' ? 'Resend' : 'Send'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activePanelTab?.kind === 'workspace-file' && activePanelTab.view === 'preview' && (
          <WorkspaceFilePreview
            workspaceId={activePanelTab.workspaceId}
            path={activePanelTab.path}
            onOpenEditor={(path) => {
              openWorkspaceFileTab({
                workspaceId: activePanelTab.workspaceId,
                path,
                view: 'editor',
                ownerId: resolvedOwnerId,
              })
            }}
          />
        )}

        {activePanelTab?.kind === 'workspace-file' && activePanelTab.view === 'editor' && (
          <WorkspaceFileEditor workspaceId={activePanelTab.workspaceId} path={activePanelTab.path} />
        )}

        {activePanelTab?.kind === 'workspace-diff' && (
          <WorkspaceDiffViewer
            ownerId={resolvedOwnerId}
            tabId={activePanelTab.id}
            workspaceId={activePanelTab.workspaceId}
            paths={activePanelTab.paths}
          />
        )}

        {activePanelTab?.kind === 'subagent' && (
          <SubagentOutputPanel
            sessionId={activePanelTab.sessionId}
            threadId={activePanelTab.threadId}
            agentName={activePanelTab.agentName}
            agentRole={activePanelTab.agentRole}
          />
        )}

        {activePanelTab?.kind === 'side-conversation' && (
          <SideConversationPanel
            sideConversationId={activePanelTab.sideConversationId}
            parentSessionId={activePanelTab.parentSessionId}
            title={activePanelTab.title}
          />
        )}

        {activePanelTab?.kind === 'context-usage-report' && (
          <ContextUsageReport
            sessionId={activePanelTab.sessionId}
            sessionTitle={activePanelTab.sessionTitle}
          />
        )}

        {!activePanelTab && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground/70">
            <GlobeIcon className="size-9 opacity-40" />
            <button
              type="button"
              onClick={handleNewTab}
              className="rounded-md bg-foreground/5 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
            >
              New Tab
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
