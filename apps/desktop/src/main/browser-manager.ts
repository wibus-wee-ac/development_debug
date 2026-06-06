// FILE: browser-manager.ts
// Purpose: Owns Cradle's desktop in-app browser runtime and maps owner/tab state onto Electron WebContentsView.
// Layer: Desktop runtime manager
// Depends on: Electron BrowserWindow/WebContentsView, browser IPC contracts

import * as Crypto from 'node:crypto'

import type { BrowserWindow, WebContents } from 'electron'
import { clipboard, nativeImage, shell, WebContentsView } from 'electron'

import { resolveDesktopBrowserPanelPreloadPath } from './desktop-assets'

export type ThreadId = string

export interface BrowserPanelBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserTabState {
  id: string
  url: string
  title: string
  status: 'live' | 'suspended'
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  faviconUrl: string | null
  lastCommittedUrl: string | null
  lastError: string | null
}

export interface ThreadBrowserState {
  threadId: ThreadId
  version: number
  open: boolean
  activeTabId: string | null
  tabs: BrowserTabState[]
  lastError: string | null
}

export interface BrowserOpenInput {
  threadId: ThreadId
  initialUrl?: string
}

export interface BrowserThreadInput {
  threadId: ThreadId
}

export interface BrowserSetPanelBoundsInput {
  threadId: ThreadId
  bounds: BrowserPanelBounds | null
  surface?: 'native'
}

export interface BrowserTabInput {
  threadId: ThreadId
  tabId?: string
}

export interface BrowserNavigateInput extends BrowserTabInput {
  url: string
}

export interface BrowserNewTabInput extends BrowserThreadInput {
  url?: string
  activate?: boolean
}

export interface BrowserCaptureScreenshotResult {
  name: string
  mimeType: 'image/png'
  sizeBytes: number
  bytes: Uint8Array
}

export interface BrowserExecuteCdpInput extends BrowserTabInput {
  method: string
  params?: Record<string, unknown>
}

export interface BrowserAnnotationElementStyle {
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

export interface BrowserAnnotationElement {
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

export interface BrowserAnnotationDesignChange {
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

export interface BrowserAnnotationElementInput extends BrowserTabInput {
  selector: string
}

export interface BrowserAnnotationDesignInput extends BrowserAnnotationElementInput {
  designChange: BrowserAnnotationDesignChange
}

export interface BrowserPromptAttachmentInput {
  filename?: string
  mediaType?: string
  url: string
}

export interface BrowserPromptRequest {
  threadId: ThreadId
  tabId: string
  text: string
  attachments: BrowserPromptAttachmentInput[]
  sourceUrl: string | null
  sourceTitle: string | null
}

export interface BrowserLocalServer {
  port: number
  url: string
  title: string
  statusCode: number | null
}

const ABOUT_BLANK_URL = 'about:blank'
const BROWSER_SESSION_PARTITION = 'persist:cradle-browser'
const BROWSER_ERROR_ABORTED = -3
const SEARCH_URL_PREFIX = 'https://www.google.com/search?q='
const LOCAL_SERVER_DISCOVERY_TIMEOUT_MS = 650
const LOCAL_SERVER_DISCOVERY_LIMIT = 12
const LOCAL_SERVER_CANDIDATE_PORTS = [
  3000,
  3001,
  3002,
  3003,
  3333,
  4000,
  4173,
  5000,
  5173,
  5174,
  5175,
  5176,
  6006,
  7000,
  7331,
  8000,
  8080,
  8787,
  9000,
  10000,
  21423,
  21424,
] as const

type BrowserStateListener = (state: ThreadBrowserState) => void
type BrowserWebContentsListener = (webContents: WebContents, tabId: string) => void
type BrowserPromptRequestListener = (request: BrowserPromptRequest) => void

interface LiveTabRuntime {
  key: string
  threadId: ThreadId
  tabId: string
  webContents: WebContents
  view: WebContentsView
  listenerDisposers: Array<() => void>
}

interface NativeBrowserViewVisibility {
  setVisible?: (visible: boolean) => void
}

interface PendingRuntimeSync {
  threadId: ThreadId
  tabId: string
  faviconUrls?: string[]
}

const LIVE_TAB_STATUS: BrowserTabState['status'] = 'live'
const SUSPENDED_TAB_STATUS: BrowserTabState['status'] = 'suspended'
const BROWSER_PROMPT_ATTACHMENT_LIMIT = 16

interface BrowserPerformanceSnapshot {
  counters: {
    setPanelBoundsCalls: number
    setPanelBoundsNoopSkips: number
    setPanelBoundsViewportUpdates: number
    stateEmitCalls: number
    stateEmitSkips: number
    stateCloneCount: number
    runtimeSyncQueueFlushes: number
    syncRuntimeStateCalls: number
  }
  trackedProcessIds: number[]
}

export interface BrowserUseSnapshot {
  threadId: ThreadId
  state: ThreadBrowserState
}

export interface BrowserUseCdpEvent {
  method: string
  params?: unknown
}

function createBrowserTab(url = ABOUT_BLANK_URL): BrowserTabState {
  return {
    id: Crypto.randomUUID(),
    url,
    title: defaultTitleForUrl(url),
    status: SUSPENDED_TAB_STATUS,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    lastCommittedUrl: null,
    lastError: null,
  }
}

function defaultThreadBrowserState(threadId: ThreadId): ThreadBrowserState {
  return {
    threadId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  }
}

function cloneThreadState(state: ThreadBrowserState): ThreadBrowserState {
  return {
    ...state,
    tabs: state.tabs.map(tab => ({ ...tab })),
  }
}

function defaultTitleForUrl(url: string): string {
  if (url === ABOUT_BLANK_URL) {
    return 'New tab'
  }

  try {
    const parsed = new URL(url)
    return parsed.hostname || url
  }
 catch {
    return url
  }
}

function screenshotFileNameForUrl(url: string): string {
  const fallback = 'browser'
  try {
    const hostname = new URL(url).hostname.trim().toLowerCase()
    const normalizedHost = hostname.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return `${normalizedHost || fallback}-${Date.now()}.png`
  }
 catch {
    return `${fallback}-${Date.now()}.png`
  }
}

function normalizeBounds(bounds: BrowserPanelBounds | null): BrowserPanelBounds | null {
  if (!bounds) { return null }
  if (
    !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.width)
    || !Number.isFinite(bounds.height)
  ) {
    return null
  }

  const width = Math.max(0, Math.floor(bounds.width))
  const height = Math.max(0, Math.floor(bounds.height))
  if (width === 0 || height === 0) {
    return null
  }

  return {
    x: Math.max(0, Math.floor(bounds.x)),
    y: Math.max(0, Math.floor(bounds.y)),
    width,
    height,
  }
}

function looksLikeUrlInput(value: string): boolean {
  return (
    value.includes('.')
    || value.startsWith('localhost')
    || value.startsWith('127.0.0.1')
    || value.startsWith('0.0.0.0')
    || value.startsWith('[::1]')
  )
}

function normalizeUrlInput(input: string | undefined): string {
  const trimmed = input?.trim() ?? ''
  if (trimmed.length === 0) {
    return ABOUT_BLANK_URL
  }

  try {
    const withScheme = new URL(trimmed)
    if (withScheme.protocol === 'http:' || withScheme.protocol === 'https:') {
      return withScheme.toString()
    }
    if (withScheme.protocol === 'about:') {
      return withScheme.toString()
    }
  }
 catch {
    // Fall through to heuristics below.
  }

  if (trimmed.includes(' ')) {
    return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`
  }

  if (looksLikeUrlInput(trimmed)) {
    const prefersHttp
      = trimmed.startsWith('localhost')
        || trimmed.startsWith('127.0.0.1')
        || trimmed.startsWith('0.0.0.0')
        || trimmed.startsWith('[::1]')
    const scheme = prefersHttp ? 'http' : 'https'
    try {
      return new URL(`${scheme}://${trimmed}`).toString()
    }
 catch {
      return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`
    }
  }

  return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`
}

function isAbortedNavigationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return /ERR_ABORTED|\(-3\)/i.test(error.message)
}

function mapBrowserLoadError(errorCode: number): string {
  switch (errorCode) {
    case -102:
      return 'Connection refused.'
    case -105:
      return 'Couldn\'t resolve this address.'
    case -106:
      return 'You\'re offline.'
    case -118:
      return 'This page took too long to respond.'
    case -137:
      return 'A secure connection couldn\'t be established.'
    case -200:
      return 'A secure connection couldn\'t be established.'
    default:
      return 'Couldn\'t open this page.'
  }
}

function buildRuntimeKey(threadId: ThreadId, tabId: string): string {
  return `${threadId}:${tabId}`
}

function browserSessionPartition(threadId: ThreadId): string {
  return `${BROWSER_SESSION_PARTITION}-${Buffer.from(threadId).toString('base64url')}`
}

function normalizeBrowserPromptPayload(
  payload: unknown,
): Pick<BrowserPromptRequest, 'text' | 'attachments'> | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const candidate = payload as {
    attachments?: unknown
    text?: unknown
  }
  const text = typeof candidate.text === 'string' ? candidate.text : ''
  const attachments = Array.isArray(candidate.attachments)
    ? candidate.attachments.flatMap(normalizeBrowserPromptAttachment).slice(0, BROWSER_PROMPT_ATTACHMENT_LIMIT)
    : []

  if (!text.trim() && attachments.length === 0) {
    return null
  }

  return {
    text,
    attachments,
  }
}

function normalizeBrowserPromptAttachment(value: unknown): BrowserPromptAttachmentInput[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const candidate = value as {
    filename?: unknown
    mediaType?: unknown
    url?: unknown
  }
  if (typeof candidate.url !== 'string' || !candidate.url.trim()) {
    return []
  }

  return [{
    ...(typeof candidate.filename === 'string' && candidate.filename.trim()
      ? { filename: candidate.filename.trim() }
      : {}),
    ...(typeof candidate.mediaType === 'string' && candidate.mediaType.trim()
      ? { mediaType: candidate.mediaType.trim() }
      : {}),
    url: candidate.url.trim(),
  }]
}

function readWebContentsUrl(webContents: WebContents): string | null {
  const url = webContents.getURL()
  return url.trim() ? url : null
}

function readWebContentsTitle(webContents: WebContents): string | null {
  const title = webContents.getTitle()
  return title.trim() ? title : null
}

function browserBoundsSignature(bounds: BrowserPanelBounds | null): string {
  if (!bounds) {
    return 'hidden'
  }

  return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function decodeTitleEntity(entity: string): string {
  switch (entity) {
    case 'amp':
      return '&'
    case 'lt':
      return '<'
    case 'gt':
      return '>'
    case 'quot':
      return '"'
    case '#39':
    case 'apos':
      return '\''
    default:
      return `&${entity};`
  }
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const rawTitle = normalizeWhitespace(match?.[1] ?? '')
  if (!rawTitle) {
    return null
  }
  return rawTitle.replace(/&([a-z0-9#]+);/gi, (_match, entity: string) =>
    decodeTitleEntity(entity))
}

function fallbackLocalServerTitle(port: number): string {
  return `localhost:${port}`
}

async function probeLocalServer(port: number): Promise<BrowserLocalServer | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, LOCAL_SERVER_DISCOVERY_TIMEOUT_MS)
  timeout.unref?.()

  try {
    const response = await fetch(`http://localhost:${port}/`, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5',
      },
    })
    const contentType = response.headers.get('content-type') ?? ''
    const title = contentType.includes('text/html')
      ? extractHtmlTitle(await response.text().catch(() => ''))
      : null
    return {
      port,
      url: `http://localhost:${port}/`,
      title: title ?? fallbackLocalServerTitle(port),
      statusCode: response.status,
    }
  }
 catch {
    return null
  }
 finally {
    clearTimeout(timeout)
  }
}

export class DesktopBrowserManager {
  private window: BrowserWindow | null = null
  private activeThreadId: ThreadId | null = null
  private activeBounds: BrowserPanelBounds | null = null
  private activeBoundsThreadId: ThreadId | null = null
  private attachedRuntimeKey: string | null = null
  private attachedBoundsSignature: string | null = null
  private readonly states = new Map<ThreadId, ThreadBrowserState>()
  private readonly threadVersionById = new Map<ThreadId, number>()
  private readonly snapshotCacheByThreadId = new Map<
    ThreadId,
    { version: number, snapshot: ThreadBrowserState }
  >()

  private readonly lastEmittedVersionByThreadId = new Map<ThreadId, number>()
  private readonly runtimes = new Map<string, LiveTabRuntime>()
  private readonly pendingRuntimeSyncs = new Map<string, PendingRuntimeSync>()
  private readonly listeners = new Set<BrowserStateListener>()
  private readonly webContentsListeners = new Set<BrowserWebContentsListener>()
  private readonly promptRequestListeners = new Set<BrowserPromptRequestListener>()
  private runtimeSyncFlushScheduled = false
  private readonly perfCounters = {
    setPanelBoundsCalls: 0,
    setPanelBoundsNoopSkips: 0,
    setPanelBoundsViewportUpdates: 0,
    stateEmitCalls: 0,
    stateEmitSkips: 0,
    stateCloneCount: 0,
    runtimeSyncQueueFlushes: 0,
    syncRuntimeStateCalls: 0,
  }

  setWindow(window: BrowserWindow | null): void {
    this.window = window
    if (window) {
      const bounds = this.activeThreadId
        ? this.getVisibleBoundsForThread(this.activeThreadId)
        : null
      if (this.activeThreadId && bounds) {
        this.attachActiveTab(this.activeThreadId, bounds)
      }
      return
    }

    this.detachAttachedRuntime()
    this.destroyAllRuntimes()
  }

  subscribe(listener: BrowserStateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeToWebContentsCreated(listener: BrowserWebContentsListener): () => void {
    this.webContentsListeners.add(listener)
    return () => {
      this.webContentsListeners.delete(listener)
    }
  }

  subscribeToPromptRequests(listener: BrowserPromptRequestListener): () => void {
    this.promptRequestListeners.add(listener)
    return () => {
      this.promptRequestListeners.delete(listener)
    }
  }

  dispose(): void {
    this.detachAttachedRuntime()
    this.destroyAllRuntimes()
    this.pendingRuntimeSyncs.clear()
    this.listeners.clear()
    this.webContentsListeners.clear()
    this.promptRequestListeners.clear()
    this.states.clear()
    this.threadVersionById.clear()
    this.snapshotCacheByThreadId.clear()
    this.lastEmittedVersionByThreadId.clear()
    this.window = null
    this.activeThreadId = null
    this.activeBounds = null
    this.activeBoundsThreadId = null
    this.attachedBoundsSignature = null
    this.runtimeSyncFlushScheduled = false
  }

  getPerformanceSnapshot(): BrowserPerformanceSnapshot {
    return {
      counters: { ...this.perfCounters },
      trackedProcessIds: this.getTrackedProcessIds(),
    }
  }

  getBrowserUseSnapshot(): BrowserUseSnapshot | null {
    if (this.activeThreadId) {
      const activeState = this.states.get(this.activeThreadId)
      if (activeState?.open) {
        return {
          threadId: this.activeThreadId,
          state: this.snapshotThreadState(this.activeThreadId, activeState),
        }
      }
    }

    for (const [threadId, state] of this.states) {
      if (state.open) {
        return {
          threadId,
          state: this.snapshotThreadState(threadId, state),
        }
      }
    }
    return null
  }

  async discoverLocalServers(): Promise<BrowserLocalServer[]> {
    const results = await Promise.all(LOCAL_SERVER_CANDIDATE_PORTS.map(probeLocalServer))
    return results
      .filter((server): server is BrowserLocalServer => server !== null)
      .slice(0, LOCAL_SERVER_DISCOVERY_LIMIT)
  }

  open(input: BrowserOpenInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId, input.initialUrl)
    const didChange = !state.open
    state.open = true
    const nextDidChange = syncThreadLastError(state) || didChange
    const activeTab = this.getActiveTab(state)
    if (activeTab) {
      const runtime = this.ensureLiveRuntime(input.threadId, activeTab.id)
      void this.loadTab(input.threadId, activeTab.id, { runtime })
    }

    if (
      this.activeBounds
      && this.activeBoundsThreadId === input.threadId
      && (this.activeThreadId === null || this.activeThreadId === input.threadId)
    ) {
      this.activateThread(input.threadId, this.activeBounds)
    }

    if (nextDidChange) {
      this.markThreadStateChanged(input.threadId)
    }
    this.emitState(input.threadId)
    return this.snapshotThreadState(input.threadId, state)
  }

  close(input: BrowserThreadInput): ThreadBrowserState {
    if (this.activeThreadId === input.threadId) {
      this.detachAttachedRuntime()
      this.activeThreadId = null
    }
    this.clearActiveBoundsForThread(input.threadId)

    this.destroyThreadRuntimes(input.threadId)

    const state = this.getOrCreateState(input.threadId)
    state.open = false
    state.activeTabId = null
    state.tabs = []
    state.lastError = null
    this.markThreadStateChanged(input.threadId)
    this.lastEmittedVersionByThreadId.delete(input.threadId)
    this.emitState(input.threadId)
    return this.snapshotThreadState(input.threadId, state)
  }

  hide(input: BrowserThreadInput): void {
    if (this.activeThreadId === input.threadId) {
      this.detachAttachedRuntime()
      this.activeThreadId = null
    }
  }

  getState(input: BrowserThreadInput): ThreadBrowserState {
    return this.snapshotThreadState(input.threadId)
  }

  setPanelBounds(input: BrowserSetPanelBoundsInput): void {
    this.perfCounters.setPanelBoundsCalls += 1
    const state = this.getOrCreateState(input.threadId)
    const nextBounds = normalizeBounds(input.bounds)
    const nextBoundsSignature = browserBoundsSignature(nextBounds)
    const activeTabId = this.getActiveTab(state)?.id ?? null
    const activeRuntimeKey = activeTabId ? buildRuntimeKey(input.threadId, activeTabId) : null
    this.setActiveBounds(input.threadId, nextBounds)

    if (!state.open || nextBounds === null) {
      if (this.activeThreadId === input.threadId) {
        this.detachAttachedRuntime()
        this.activeThreadId = null
      }
      return
    }

    // Bounds sync fires often during panel motion. If the visible runtime and
    // applied viewport are already current, avoid waking the browser stack again.
    if (
      this.activeThreadId === input.threadId
      && this.attachedRuntimeKey === activeRuntimeKey
      && this.attachedBoundsSignature === nextBoundsSignature
    ) {
      this.perfCounters.setPanelBoundsNoopSkips += 1
      return
    }

    if (this.activeThreadId === input.threadId) {
      if (activeRuntimeKey && this.attachedRuntimeKey === activeRuntimeKey) {
        const runtime = this.runtimes.get(activeRuntimeKey)
        if (runtime) {
          this.perfCounters.setPanelBoundsViewportUpdates += 1
          this.attachRuntime(runtime, nextBounds)
          return
        }
      }
      this.attachActiveTab(input.threadId, nextBounds)
      return
    }

    this.activateThread(input.threadId, nextBounds)
  }

  navigate(input: BrowserNavigateInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const nextUrl = normalizeUrlInput(input.url)
    tab.url = nextUrl
    tab.title = defaultTitleForUrl(nextUrl)
    tab.lastCommittedUrl = null
    tab.lastError = null
    syncThreadLastError(state)
    this.markThreadStateChanged(input.threadId)

    const runtime = this.runtimes.get(buildRuntimeKey(input.threadId, tab.id))
    if (runtime) {
      const bounds = this.getVisibleBoundsForThread(input.threadId)
      if (state.activeTabId === tab.id && bounds) {
        this.attachRuntime(runtime, bounds)
      }
      void this.loadTab(input.threadId, tab.id, { force: true, runtime })
    }
 else if (this.activeThreadId === input.threadId) {
      // Load the target tab directly so we don't clobber its pending URL with a
      // thread-wide runtime sync from the old live page state.
      const nextRuntime = this.ensureLiveRuntime(input.threadId, tab.id)
      const bounds = this.getVisibleBoundsForThread(input.threadId)
      if (state.activeTabId === tab.id && bounds) {
        this.attachRuntime(nextRuntime, bounds)
      }
      void this.loadTab(input.threadId, tab.id, { force: true, runtime: nextRuntime })
    }

    this.emitState(input.threadId)
    return this.snapshotThreadState(input.threadId, state)
  }

  reload(input: BrowserTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const runtime = this.runtimes.get(buildRuntimeKey(input.threadId, tab.id))
    if (runtime) {
      runtime.webContents.reload()
    }
 else if (this.activeThreadId === input.threadId) {
      this.resumeThread(input.threadId)
      void this.loadTab(input.threadId, tab.id, { force: true })
    }
    return this.snapshotThreadState(input.threadId, state)
  }

  goBack(input: BrowserTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const runtime = this.runtimes.get(buildRuntimeKey(input.threadId, tab.id))
    if (runtime && canWebContentsGoBack(runtime.webContents)) {
      runtime.webContents.goBack()
    }
    return this.getState({ threadId: input.threadId })
  }

  goForward(input: BrowserTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const runtime = this.runtimes.get(buildRuntimeKey(input.threadId, tab.id))
    if (runtime && canWebContentsGoForward(runtime.webContents)) {
      runtime.webContents.goForward()
    }
    return this.getState({ threadId: input.threadId })
  }

  newTab(input: BrowserNewTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = createBrowserTab(normalizeUrlInput(input.url))
    state.tabs = [...state.tabs, tab]
    if (input.activate !== false || !state.activeTabId) {
      state.activeTabId = tab.id
    }

    if (this.activeThreadId === input.threadId) {
      const bounds = this.getVisibleBoundsForThread(input.threadId)
      if (state.activeTabId === tab.id) {
        const runtime = this.ensureLiveRuntime(input.threadId, tab.id)
        if (bounds) {
          this.attachRuntime(runtime, bounds)
        }
        void this.loadTab(input.threadId, tab.id, { force: true, runtime })
      }
    }
 else if (state.activeTabId === tab.id) {
      const runtime = this.ensureLiveRuntime(input.threadId, tab.id)
      void this.loadTab(input.threadId, tab.id, { force: true, runtime })
    }
 else {
      tab.status = 'suspended'
    }

    syncThreadLastError(state)
    this.markThreadStateChanged(input.threadId)
    this.emitState(input.threadId)
    return this.snapshotThreadState(input.threadId, state)
  }

  closeTab(input: BrowserTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const nextTabs = state.tabs.filter(candidate => candidate.id !== tab.id)
    if (nextTabs.length === state.tabs.length) {
      return this.snapshotThreadState(input.threadId, state)
    }

    this.destroyRuntime(input.threadId, tab.id)
    state.tabs = nextTabs

    if (nextTabs.length === 0) {
      state.open = false
      state.activeTabId = null
      state.lastError = null
      if (this.activeThreadId === input.threadId) {
        this.detachAttachedRuntime()
        this.activeThreadId = null
      }
      this.clearActiveBoundsForThread(input.threadId)
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
      return this.snapshotThreadState(input.threadId, state)
    }

    if (!state.activeTabId || state.activeTabId === input.tabId) {
      state.activeTabId = nextTabs[Math.max(0, nextTabs.length - 1)]?.id ?? null
    }

    const bounds = this.getVisibleBoundsForThread(input.threadId)
    if (this.activeThreadId === input.threadId && bounds) {
      this.attachActiveTab(input.threadId, bounds)
    }

    syncThreadLastError(state)
    this.markThreadStateChanged(input.threadId)
    this.emitState(input.threadId)
    return this.snapshotThreadState(input.threadId, state)
  }

  selectTab(input: BrowserTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id
      syncThreadLastError(state)
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
    }

    if (this.activeThreadId === input.threadId) {
      this.resumeThread(input.threadId)
      const bounds = this.getVisibleBoundsForThread(input.threadId)
      if (bounds) {
        this.attachActiveTab(input.threadId, bounds)
      }
    }

    return this.snapshotThreadState(input.threadId, state)
  }

  openDevTools(input: BrowserTabInput): void {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id
      syncThreadLastError(state)
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
    }

    this.resumeThread(input.threadId)
    const runtime = this.ensureLiveRuntime(input.threadId, tab.id)
    const bounds = this.getVisibleBoundsForThread(input.threadId)
    if (bounds) {
      this.attachActiveTab(input.threadId, bounds)
    }
    runtime.webContents.openDevTools({ mode: 'detach' })
  }

  handlePromptRequest(sender: WebContents, payload: unknown): BrowserPromptRequest | null {
    const runtime = this.findRuntimeByWebContents(sender)
    if (!runtime) {
      return null
    }

    const normalizedPayload = normalizeBrowserPromptPayload(payload)
    if (!normalizedPayload) {
      return null
    }

    const request: BrowserPromptRequest = {
      threadId: runtime.threadId,
      tabId: runtime.tabId,
      text: normalizedPayload.text,
      attachments: normalizedPayload.attachments,
      sourceUrl: readWebContentsUrl(runtime.webContents),
      sourceTitle: readWebContentsTitle(runtime.webContents),
    }

    for (const listener of this.promptRequestListeners) {
      listener(request)
    }
    return request
  }

  // Ensures the requested tab is active/live, then returns a fresh PNG capture
  // from the native browser surface for whichever destination needs it next.
  private async captureScreenshotPng(input: BrowserTabInput): Promise<{
    name: string
    pngBytes: Buffer
  }> {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id
      syncThreadLastError(state)
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
    }

    this.resumeThread(input.threadId)
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS
    const runtime = this.ensureLiveRuntime(input.threadId, tab.id)
    const webContents = runtime.webContents
    const expectedUrl = normalizeUrlInput(tab.lastCommittedUrl ?? tab.url)
    const currentUrl = webContents.getURL()
    const bounds = this.getVisibleBoundsForThread(input.threadId)
    if (bounds) {
      this.attachActiveTab(input.threadId, bounds)
    }

    if (wasSuspended || currentUrl.length === 0 || currentUrl !== expectedUrl) {
      await this.loadTab(input.threadId, tab.id, { runtime })
    }
 else {
      this.queueRuntimeStateSync(input.threadId, tab.id)
    }

    const pngBytes = (await webContents.capturePage()).toPNG()
    if (pngBytes.byteLength === 0) {
      throw new Error('Couldn\'t capture a browser screenshot.')
    }

    return {
      name: screenshotFileNameForUrl(tab.lastCommittedUrl ?? tab.url),
      pngBytes,
    }
  }

  // Captures the current browser viewport as a PNG so the renderer can attach
  // it directly to the composer without introducing temp-file disk churn.
  async captureScreenshot(input: BrowserTabInput): Promise<BrowserCaptureScreenshotResult> {
    const { name, pngBytes } = await this.captureScreenshotPng(input)

    return {
      name,
      mimeType: 'image/png',
      sizeBytes: pngBytes.byteLength,
      bytes: Uint8Array.from(pngBytes),
    }
  }

  // Writes the current browser viewport screenshot straight to the native
  // clipboard so the renderer does not have to ferry image payloads over IPC.
  async copyScreenshotToClipboard(input: BrowserTabInput): Promise<void> {
    const { pngBytes } = await this.captureScreenshotPng(input)
    const image = nativeImage.createFromBuffer(pngBytes)
    if (image.isEmpty()) {
      throw new Error('Couldn\'t copy a browser screenshot to the clipboard.')
    }
    clipboard.writeImage(image)
  }

  // Runs a Chrome DevTools Protocol command against the requested tab so higher-level
  // browser automation can reuse the native browser runtime instead of scripting React.
  async executeCdp(input: BrowserExecuteCdpInput): Promise<unknown> {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id
      syncThreadLastError(state)
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
    }

    this.resumeThread(input.threadId)
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS
    const runtime = this.ensureLiveRuntime(input.threadId, tab.id)
    const webContents = runtime.webContents
    const bounds = this.getVisibleBoundsForThread(input.threadId)
    if (bounds) {
      this.attachActiveTab(input.threadId, bounds)
    }

    if (wasSuspended) {
      await this.loadTab(input.threadId, tab.id, { force: true, runtime })
    }
 else {
      this.queueRuntimeStateSync(input.threadId, tab.id)
    }

    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach('1.3')
    }

    try {
      return await webContents.debugger.sendCommand(input.method, input.params ?? {})
    }
 catch (error) {
      if (error instanceof Error) {
        throw new Error(`CDP ${input.method} failed: ${error.message}`)
      }
      throw error
    }
  }

  async attachBrowserUseTab(input: BrowserTabInput): Promise<void> {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id
      syncThreadLastError(state)
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
    }

    this.resumeThread(input.threadId)
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS
    const runtime = this.ensureLiveRuntime(input.threadId, tab.id)
    if (this.activeBounds && this.activeBoundsThreadId === input.threadId) {
      this.activateThread(input.threadId, this.activeBounds)
    }

    if (wasSuspended) {
      await this.loadTab(input.threadId, tab.id, { force: true, runtime })
    }
 else {
      this.queueRuntimeStateSync(input.threadId, tab.id)
    }

    if (!runtime.webContents.debugger.isAttached()) {
      runtime.webContents.debugger.attach('1.3')
    }
  }

  subscribeToCdpEvents(
    input: BrowserTabInput,
    listener: (event: BrowserUseCdpEvent) => void,
  ): () => void {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const runtime = this.runtimes.get(buildRuntimeKey(input.threadId, tab.id))
    if (!runtime) {
      return () => {}
    }

    const handleMessage = (_event: Electron.Event, method: string, params?: unknown) => {
      listener({
        method,
        ...(params !== undefined ? { params } : {}),
      })
    }

    runtime.webContents.debugger.on('message', handleMessage)
    return () => {
      runtime.webContents.debugger.removeListener('message', handleMessage)
    }
  }

  private activateThread(threadId: ThreadId, bounds: BrowserPanelBounds): void {
    this.activeThreadId = threadId
    this.activeBounds = bounds
    this.activeBoundsThreadId = threadId
    this.resumeThread(threadId)
    this.attachActiveTab(threadId, bounds)
  }

  private setActiveBounds(threadId: ThreadId, bounds: BrowserPanelBounds | null): void {
    if (!bounds) {
      this.clearActiveBoundsForThread(threadId)
      return
    }
    this.activeBounds = bounds
    this.activeBoundsThreadId = threadId
  }

  private clearActiveBoundsForThread(threadId: ThreadId): void {
    if (this.activeBoundsThreadId !== threadId) {
      return
    }
    this.activeBounds = null
    this.activeBoundsThreadId = null
  }

  private getVisibleBoundsForThread(threadId: ThreadId): BrowserPanelBounds | null {
    return this.activeBoundsThreadId === threadId ? this.activeBounds : null
  }

  private resumeThread(threadId: ThreadId): void {
    const state = this.ensureWorkspace(threadId)
    if (!state.open) {
      return
    }

    const activeTab = this.getActiveTab(state)
    let didChange = false

    // Only resume the visible tab. Waking every tab can fan out into several
    // Chromium renderer processes and background page activity at once.
    for (const tab of state.tabs) {
      if (tab.id !== activeTab?.id) {
        continue
      }
      const wasSuspended = tab.status === SUSPENDED_TAB_STATUS
      const runtime = this.ensureLiveRuntime(threadId, tab.id)
      if (wasSuspended) {
        void this.loadTab(threadId, tab.id, { force: true, runtime })
      }
 else {
        didChange = syncTabStateFromRuntime(state, tab, runtime.webContents) || didChange
      }
    }

    didChange = syncThreadLastError(state) || didChange
    if (didChange) {
      this.markThreadStateChanged(threadId)
      this.emitState(threadId)
    }
  }

  private attachActiveTab(threadId: ThreadId, bounds: BrowserPanelBounds): void {
    const state = this.ensureWorkspace(threadId)
    const activeTab = this.getActiveTab(state)
    if (!activeTab) {
      return
    }

    const wasSuspended = activeTab.status === SUSPENDED_TAB_STATUS
    const runtime = this.ensureLiveRuntime(threadId, activeTab.id)
    this.attachRuntime(runtime, bounds)
    if (wasSuspended) {
      void this.loadTab(threadId, activeTab.id, { force: true, runtime })
    }
 else {
      this.syncRuntimeState(threadId, activeTab.id)
    }
  }

  private attachRuntime(runtime: LiveTabRuntime, bounds: BrowserPanelBounds): void {
    const window = this.window
    if (!window) {
      return
    }

    const nextBoundsSignature = browserBoundsSignature(bounds)
    if (this.attachedRuntimeKey === runtime.key) {
      this.setRuntimeViewHidden(runtime, false)
      this.bringRuntimeViewToFront(runtime)
      if (this.attachedBoundsSignature === nextBoundsSignature) {
        return
      }
      runtime.view.setBounds(bounds)
      this.attachedBoundsSignature = nextBoundsSignature
      return
    }

    this.detachAttachedRuntime()
    this.setRuntimeViewHidden(runtime, false)
    this.bringRuntimeViewToFront(runtime)
    runtime.view.setBounds(bounds)
    this.attachedRuntimeKey = runtime.key
    this.attachedBoundsSignature = nextBoundsSignature
  }

  private bringRuntimeViewToFront(runtime: LiveTabRuntime): void {
    const window = this.window
    if (!window) {
      return
    }

    try {
      window.contentView.removeChildView(runtime.view)
    }
 catch {
      // Electron throws when the view is not attached yet; adding it below is the desired state.
    }
    window.contentView.addChildView(runtime.view)
  }

  private detachAttachedRuntime(): void {
    if (!this.window || !this.attachedRuntimeKey) {
      this.attachedRuntimeKey = null
      this.attachedBoundsSignature = null
      return
    }

    const runtime = this.runtimes.get(this.attachedRuntimeKey)
    if (runtime) {
      this.setRuntimeViewHidden(runtime, true)
      this.window.contentView.removeChildView(runtime.view)
    }
    this.attachedRuntimeKey = null
    this.attachedBoundsSignature = null
  }

  private setRuntimeViewHidden(runtime: LiveTabRuntime, hidden: boolean): void {
    const nativeView = runtime.view as typeof runtime.view & NativeBrowserViewVisibility
    if (hidden) {
      nativeView.setVisible?.(false)
      return
    }
    nativeView.setVisible?.(true)
  }

  private ensureLiveRuntime(threadId: ThreadId, tabId: string): LiveTabRuntime {
    const key = buildRuntimeKey(threadId, tabId)
    const existing = this.runtimes.get(key)
    if (existing) {
      if (existing.webContents.isDestroyed()) {
        this.destroyRuntime(threadId, tabId)
      }
 else {
        return existing
      }
    }

    const runtime = this.createLiveRuntime(threadId, tabId)
    this.runtimes.set(key, runtime)
    const state = this.ensureWorkspace(threadId)
    const tab = this.getTab(state, tabId)
    if (tab) {
      const didChange = tab.status !== 'live' || tab.lastError !== null
      tab.status = 'live'
      tab.lastError = null
      syncThreadLastError(state)
      if (didChange) {
        this.markThreadStateChanged(threadId)
      }
    }
    return runtime
  }

  private createLiveRuntime(threadId: ThreadId, tabId: string): LiveTabRuntime {
    const view = new WebContentsView({
      webPreferences: {
        partition: browserSessionPartition(threadId),
        preload: resolveDesktopBrowserPanelPreloadPath(__dirname),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(true)
    })
    view.webContents.session.setPermissionCheckHandler(() => true)
    const runtime: LiveTabRuntime = {
      key: buildRuntimeKey(threadId, tabId),
      threadId,
      tabId,
      webContents: view.webContents,
      view,
      listenerDisposers: [],
    }
    this.configureRuntimeWebContents(runtime)
    for (const listener of this.webContentsListeners) {
      listener(runtime.webContents, tabId)
    }
    return runtime
  }

  private findRuntimeByWebContents(webContents: WebContents): LiveTabRuntime | null {
    for (const runtime of this.runtimes.values()) {
      if (runtime.webContents === webContents) {
        return runtime
      }
    }
    return null
  }

  private configureRuntimeWebContents(runtime: LiveTabRuntime): void {
    const { threadId, tabId, webContents } = runtime

    webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url === ABOUT_BLANK_URL) {
        this.newTab({
          threadId,
          url,
          activate: true,
        })
        const bounds = this.getVisibleBoundsForThread(threadId)
        if (this.activeThreadId === threadId && bounds) {
          this.attachActiveTab(threadId, bounds)
        }
        return { action: 'deny' }
      }

      void shell.openExternal(url)
      return { action: 'deny' }
    })

    const pageTitleUpdated = (event: Electron.Event) => {
      event.preventDefault()
      this.queueRuntimeStateSync(threadId, tabId)
    }
    webContents.on('page-title-updated', pageTitleUpdated)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('page-title-updated', pageTitleUpdated)
    })

    const pageFaviconUpdated = (_event: Electron.Event, faviconUrls: string[]) => {
      this.queueRuntimeStateSync(threadId, tabId, faviconUrls)
    }
    webContents.on('page-favicon-updated', pageFaviconUpdated)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('page-favicon-updated', pageFaviconUpdated)
    })

    const didStartLoading = () => {
      this.queueRuntimeStateSync(threadId, tabId)
    }
    webContents.on('did-start-loading', didStartLoading)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('did-start-loading', didStartLoading)
    })

    const didStopLoading = () => {
      this.queueRuntimeStateSync(threadId, tabId)
    }
    webContents.on('did-stop-loading', didStopLoading)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('did-stop-loading', didStopLoading)
    })

    const didNavigate = () => {
      this.queueRuntimeStateSync(threadId, tabId)
    }
    webContents.on('did-navigate', didNavigate)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('did-navigate', didNavigate)
    })

    const didNavigateInPage = () => {
      this.queueRuntimeStateSync(threadId, tabId)
    }
    webContents.on('did-navigate-in-page', didNavigateInPage)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('did-navigate-in-page', didNavigateInPage)
    })

    const didFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      _errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame || errorCode === BROWSER_ERROR_ABORTED) {
        return
      }

      const state = this.states.get(threadId)
      const tab = state ? this.getTab(state, tabId) : null
      if (!state || !tab) {
        return
      }

      tab.url = validatedURL || tab.url
      tab.title = defaultTitleForUrl(tab.url)
      tab.isLoading = false
      tab.lastError = mapBrowserLoadError(errorCode)
      syncThreadLastError(state)
      this.markThreadStateChanged(threadId)
      this.emitState(threadId)
    }
    webContents.on('did-fail-load', didFailLoad)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('did-fail-load', didFailLoad)
    })

    const renderProcessGone = () => {
      const state = this.states.get(threadId)
      const tab = state ? this.getTab(state, tabId) : null
      this.destroyRuntime(threadId, tabId)
      if (state && tab) {
        tab.status = 'suspended'
        tab.isLoading = false
        tab.lastError = 'This tab stopped unexpectedly.'
        syncThreadLastError(state)
        this.markThreadStateChanged(threadId)
        this.emitState(threadId)
      }
      const bounds = this.getVisibleBoundsForThread(threadId)
      if (this.activeThreadId === threadId && bounds) {
        this.attachActiveTab(threadId, bounds)
      }
    }
    webContents.on('render-process-gone', renderProcessGone)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('render-process-gone', renderProcessGone)
    })
  }

  private async loadTab(
    threadId: ThreadId,
    tabId: string,
    options: { force?: boolean, runtime?: LiveTabRuntime } = {},
  ): Promise<void> {
    const state = this.ensureWorkspace(threadId)
    const tab = this.getTab(state, tabId)
    if (!tab) {
      return
    }

    const runtime = options.runtime ?? this.ensureLiveRuntime(threadId, tabId)
    const webContents = runtime.webContents
    const nextUrl = normalizeUrlInput(
      options.force === true ? tab.url : (tab.lastCommittedUrl ?? tab.url),
    )
    const currentUrl = webContents.getURL()
    const shouldLoad = options.force === true || currentUrl !== nextUrl || currentUrl.length === 0

    if (!shouldLoad) {
      this.queueRuntimeStateSync(threadId, tabId)
      return
    }

    tab.url = nextUrl
    tab.status = 'live'
    tab.isLoading = true
    tab.lastError = null
    syncThreadLastError(state)
    this.markThreadStateChanged(threadId)
    this.emitState(threadId)

    try {
      await webContents.loadURL(nextUrl)
      this.queueRuntimeStateSync(threadId, tabId)
    }
 catch (error) {
      if (isAbortedNavigationError(error)) {
        this.queueRuntimeStateSync(threadId, tabId)
        return
      }

      tab.isLoading = false
      tab.lastError = 'Couldn\'t open this page.'
      syncThreadLastError(state)
      this.markThreadStateChanged(threadId)
      this.emitState(threadId)
    }
  }

  private syncRuntimeState(threadId: ThreadId, tabId: string, faviconUrls?: string[]): void {
    this.perfCounters.syncRuntimeStateCalls += 1
    const state = this.states.get(threadId)
    const tab = state ? this.getTab(state, tabId) : null
    const runtime = this.runtimes.get(buildRuntimeKey(threadId, tabId))
    if (!state || !tab || !runtime) {
      return
    }

    const didChange = syncTabStateFromRuntime(state, tab, runtime.webContents, faviconUrls)
    const nextDidChange = syncThreadLastError(state) || didChange
    if (nextDidChange) {
      this.markThreadStateChanged(threadId)
      this.emitState(threadId)
    }
  }

  private queueRuntimeStateSync(threadId: ThreadId, tabId: string, faviconUrls?: string[]): void {
    const key = buildRuntimeKey(threadId, tabId)
    const existing = this.pendingRuntimeSyncs.get(key)
    const nextPendingSync: PendingRuntimeSync = {
      threadId,
      tabId,
    }
    const nextFaviconUrls = faviconUrls ?? existing?.faviconUrls
    if (nextFaviconUrls !== undefined) {
      nextPendingSync.faviconUrls = nextFaviconUrls
    }
    this.pendingRuntimeSyncs.set(key, nextPendingSync)

    if (this.runtimeSyncFlushScheduled) {
      return
    }

    this.runtimeSyncFlushScheduled = true
    queueMicrotask(() => {
      this.runtimeSyncFlushScheduled = false
      if (this.pendingRuntimeSyncs.size === 0) {
        return
      }

      this.perfCounters.runtimeSyncQueueFlushes += 1
      const pendingSyncs = [...this.pendingRuntimeSyncs.values()]
      this.pendingRuntimeSyncs.clear()
      for (const pendingSync of pendingSyncs) {
        this.syncRuntimeState(pendingSync.threadId, pendingSync.tabId, pendingSync.faviconUrls)
      }
    })
  }

  private destroyThreadRuntimes(threadId: ThreadId): void {
    const state = this.states.get(threadId)
    if (!state) {
      return
    }

    for (const tab of state.tabs) {
      this.destroyRuntime(threadId, tab.id)
    }
  }

  private destroyAllRuntimes(): void {
    for (const runtime of this.runtimes.values()) {
      this.destroyRuntime(runtime.threadId, runtime.tabId)
    }
  }

  private destroyRuntime(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId)
    this.pendingRuntimeSyncs.delete(key)
    const runtime = this.runtimes.get(key)
    if (!runtime) {
      return
    }

    if (this.attachedRuntimeKey === key) {
      this.detachAttachedRuntime()
    }

    this.runtimes.delete(key)
    const webContents = runtime.webContents
    for (const disposeListener of runtime.listenerDisposers.splice(0)) {
      disposeListener()
    }
    if (!webContents.isDestroyed()) {
      if (webContents.debugger.isAttached()) {
        try {
          webContents.debugger.detach()
        }
 catch {
          // The runtime is being torn down anyway; ignore stale-debugger cleanup noise.
        }
      }
      webContents.close({ waitForBeforeUnload: false })
    }
  }

  private getOrCreateState(threadId: ThreadId): ThreadBrowserState {
    const existing = this.states.get(threadId)
    if (existing) {
      return existing
    }

    const initial = defaultThreadBrowserState(threadId)
    this.states.set(threadId, initial)
    this.threadVersionById.set(threadId, 0)
    return initial
  }

  private markThreadStateChanged(threadId: ThreadId): void {
    const nextVersion = (this.threadVersionById.get(threadId) ?? 0) + 1
    this.threadVersionById.set(threadId, nextVersion)
    const state = this.states.get(threadId)
    if (state) {
      state.version = nextVersion
    }
  }

  private snapshotThreadState(
    threadId: ThreadId,
    state = this.getOrCreateState(threadId),
  ): ThreadBrowserState {
    const version = state.version
    const cached = this.snapshotCacheByThreadId.get(threadId)
    if (cached && cached.version === version) {
      return cached.snapshot
    }

    const snapshot = cloneThreadState(state)
    this.perfCounters.stateCloneCount += 1
    this.snapshotCacheByThreadId.set(threadId, {
      version,
      snapshot,
    })
    return snapshot
  }

  private getTrackedProcessIds(): number[] {
    const processIds = new Set<number>()
    for (const runtime of this.runtimes.values()) {
      const webContents = runtime.webContents
      if (webContents.isDestroyed()) {
        continue
      }
      processIds.add(webContents.getProcessId())
    }
    return [...processIds]
  }

  private ensureWorkspace(threadId: ThreadId, initialUrl?: string): ThreadBrowserState {
    const state = this.getOrCreateState(threadId)
    if (state.tabs.length === 0) {
      const initialTab = createBrowserTab(normalizeUrlInput(initialUrl))
      state.tabs = [initialTab]
      state.activeTabId = initialTab.id
    }

    if (!state.activeTabId || !state.tabs.some(tab => tab.id === state.activeTabId)) {
      state.activeTabId = state.tabs[0]?.id ?? null
    }

    return state
  }

  private resolveTab(state: ThreadBrowserState, tabId?: string): BrowserTabState {
    const resolvedTabId = tabId ?? state.activeTabId
    const existing
      = (resolvedTabId ? state.tabs.find(tab => tab.id === resolvedTabId) : undefined)
        ?? state.tabs[0]
    if (existing) {
      return existing
    }

    const fallback = createBrowserTab()
    state.tabs = [fallback]
    state.activeTabId = fallback.id
    return fallback
  }

  private getActiveTab(state: ThreadBrowserState): BrowserTabState | null {
    if (!state.activeTabId) {
      return state.tabs[0] ?? null
    }
    return state.tabs.find(tab => tab.id === state.activeTabId) ?? state.tabs[0] ?? null
  }

  private getTab(state: ThreadBrowserState, tabId: string): BrowserTabState | null {
    return state.tabs.find(tab => tab.id === tabId) ?? null
  }

  private emitState(threadId: ThreadId): void {
    this.perfCounters.stateEmitCalls += 1
    const state = this.getOrCreateState(threadId)
    const nextVersion = state.version
    if (this.lastEmittedVersionByThreadId.get(threadId) === nextVersion) {
      this.perfCounters.stateEmitSkips += 1
      return
    }
    this.lastEmittedVersionByThreadId.set(threadId, nextVersion)
    const snapshot = this.snapshotThreadState(threadId, state)
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

function setIfChanged<T>(current: T, next: T, apply: (value: T) => void): boolean {
  if (Object.is(current, next)) {
    return false
  }
  apply(next)
  return true
}

function syncTabStateFromRuntime(
  state: ThreadBrowserState,
  tab: BrowserTabState,
  webContents: WebContents,
  faviconUrls?: string[],
): boolean {
  const currentUrl = webContents.getURL()
  const nextUrl = currentUrl || tab.url
  const nextTitle = webContents.getTitle()
  let didChange = false
  didChange
    = setIfChanged(tab.status, LIVE_TAB_STATUS, (value) => {
      tab.status = value
    }) || didChange
  didChange
    = setIfChanged(tab.url, nextUrl, (value) => {
      tab.url = value
    }) || didChange
  const resolvedTitle
    = !nextTitle || nextTitle === ABOUT_BLANK_URL ? defaultTitleForUrl(nextUrl) : nextTitle
  didChange
    = setIfChanged(tab.title, resolvedTitle, (value) => {
      tab.title = value
    }) || didChange
  didChange
    = setIfChanged(tab.isLoading, webContents.isLoading(), (value) => {
      tab.isLoading = value
    }) || didChange
  didChange
    = setIfChanged(tab.canGoBack, canWebContentsGoBack(webContents), (value) => {
      tab.canGoBack = value
    }) || didChange
  didChange
    = setIfChanged(tab.canGoForward, canWebContentsGoForward(webContents), (value) => {
      tab.canGoForward = value
    }) || didChange
  didChange
    = setIfChanged(tab.lastCommittedUrl, currentUrl || tab.lastCommittedUrl, (value) => {
      tab.lastCommittedUrl = value
    }) || didChange
  if (faviconUrls) {
    didChange
      = setIfChanged(tab.faviconUrl, faviconUrls[0] ?? tab.faviconUrl, (value) => {
        tab.faviconUrl = value
      }) || didChange
  }
  if (tab.lastError && !tab.isLoading) {
    tab.lastError = null
    didChange = true
  }
  didChange = syncThreadLastError(state) || didChange
  return didChange
}

function canWebContentsGoBack(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoBack() ?? webContents.canGoBack()
}

function canWebContentsGoForward(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoForward() ?? webContents.canGoForward()
}

function syncThreadLastError(state: ThreadBrowserState): boolean {
  const activeTab
    = (state.activeTabId ? state.tabs.find(tab => tab.id === state.activeTabId) : undefined)
      ?? state.tabs[0]
  const nextLastError = activeTab?.lastError ?? null
  if (state.lastError === nextLastError) {
    return false
  }
  state.lastError = nextLastError
  return true
}
