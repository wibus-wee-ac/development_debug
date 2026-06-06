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
  FileDiffIcon,
  FileTextIcon,
  GlobeIcon,
  LoaderCircleIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Button } from '~/components/ui/button'
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

import type { BrowserAnnotationOverlaySubmitInput } from './browser-annotation-overlay'
import { BrowserAnnotationOverlay } from './browser-annotation-overlay'
import type { BrowserAddressSuggestion } from './browser-panel.logic'
import {
  browserAddressDisplayValue,
  buildBrowserAddressSuggestions,
  normalizeBrowserAddressInput,
  resolveBrowserAddressSync,
  resolveBrowserChromeStatus,
} from './browser-panel.logic'
import { SubagentOutputPanel } from './subagent-output-panel'
import { WorkspaceDiffViewer } from './workspace-diff-viewer'

interface BrowserPanelProps {
  ownerId?: string | null
  activeSessionId?: string | null
  activeSessionTitle?: string | null
  onCloseLastTab?: (ownerId: string) => void
}

const BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET = 2
const BROWSER_SCREENSHOT_CHUNK_SIZE = 0x8000
const EMPTY_BROWSER_PANEL_TABS: BrowserPanelTab[] = []
const BROWSER_ANNOTATION_ELEMENT_SCAN_EXPRESSION = `(() => {
  const MAX_ELEMENTS = 250;
  const MIN_AREA = 16;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const interactiveTags = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY']);

  function cssPath(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(tag + '#' + CSS.escape(current.id));
        break;
      }
      const classes = Array.from(current.classList || []).slice(0, 2).map((name) => '.' + CSS.escape(name)).join('');
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(tag + classes + ':nth-of-type(' + index + ')');
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function labelFor(element) {
    const aria = element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') || element.getAttribute('placeholder') || '';
    const value = typeof element.value === 'string' ? element.value : '';
    const text = aria || value || element.innerText || element.textContent || '';
    return text.replace(/\\s+/g, ' ').trim().slice(0, 140);
  }

  function implicitRole(element) {
    const explicit = element.getAttribute('role');
    if (explicit) {
      return explicit;
    }
    switch (element.tagName) {
      case 'A':
        return element.hasAttribute('href') ? 'link' : '';
      case 'BUTTON':
        return 'button';
      case 'IMG':
        return 'img';
      case 'INPUT': {
        const type = (element.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
        return 'textbox';
      }
      case 'TEXTAREA':
        return 'textbox';
      case 'SELECT':
        return 'combobox';
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        return 'heading';
      case 'NAV':
        return 'navigation';
      case 'MAIN':
        return 'main';
      case 'FORM':
        return 'form';
      case 'TABLE':
        return 'table';
      case 'VIDEO':
        return 'video';
      default:
        return '';
    }
  }

  function attributesFor(element) {
    const href = element instanceof HTMLAnchorElement ? element.href : element.getAttribute('href');
    const value = typeof element.value === 'string' ? element.value : '';
    return {
      id: element.id || undefined,
      className: element.className && typeof element.className === 'string' ? element.className.slice(0, 160) : undefined,
      ariaLabel: element.getAttribute('aria-label') || undefined,
      title: element.getAttribute('title') || undefined,
      alt: element.getAttribute('alt') || undefined,
      href: href || undefined,
      type: element.getAttribute('type') || undefined,
      name: element.getAttribute('name') || undefined,
      placeholder: element.getAttribute('placeholder') || undefined,
      value: value ? value.slice(0, 120) : undefined,
      testId: element.getAttribute('data-testid') || element.getAttribute('data-test-id') || undefined,
    };
  }

  function descriptionFor(element, attributes) {
    const parts = [];
    if (attributes.href) parts.push('href=' + attributes.href);
    if (attributes.placeholder) parts.push('placeholder=' + attributes.placeholder);
    if (attributes.name) parts.push('name=' + attributes.name);
    if (attributes.type) parts.push('type=' + attributes.type);
    if (attributes.testId) parts.push('testid=' + attributes.testId);
    return parts.join(' · ').slice(0, 220);
  }

  function semanticScore(element, label, role) {
    let score = 0;
    if (interactiveTags.has(element.tagName)) score += 80;
    if (role) score += 40;
    if (label) score += 30;
    if (element.getAttribute('data-testid') || element.getAttribute('data-test-id')) score += 20;
    if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(element.tagName)) score += 18;
    if (['IMG', 'SVG', 'VIDEO', 'CANVAS'].includes(element.tagName)) score += 14;
    return score;
  }

  function isCandidate(element, rect, style, label, role) {
    if (rect.width <= 0 || rect.height <= 0 || rect.width * rect.height < MIN_AREA) {
      return false;
    }
    if (rect.right < 0 || rect.bottom < 0 || rect.left > viewportWidth || rect.top > viewportHeight) {
      return false;
    }
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
      return false;
    }
    if (element.closest('[aria-hidden="true"], script, style, meta, link, noscript')) {
      return false;
    }
    const hasSemanticSignal = label
      || interactiveTags.has(element.tagName)
      || role
      || ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'IMG', 'SVG', 'VIDEO', 'CANVAS'].includes(element.tagName);
    return Boolean(hasSemanticSignal);
  }

  return Array.from(document.querySelectorAll('body *'))
    .map((element, index) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const label = labelFor(element);
      const role = implicitRole(element);
      if (!isCandidate(element, rect, style, label, role)) {
        return null;
      }
      const attributes = attributesFor(element);
      const area = Math.max(1, rect.width * rect.height);
      return {
        id: 'element-' + index,
        tagName: element.tagName,
        label,
        description: descriptionFor(element, attributes),
        role,
        selector: cssPath(element),
        attributes,
        score: semanticScore(element, label, role),
        rect: {
          x: Math.max(0, Math.min(viewportWidth, rect.left)),
          y: Math.max(0, Math.min(viewportHeight, rect.top)),
          width: Math.max(1, Math.min(viewportWidth, rect.right) - Math.max(0, rect.left)),
          height: Math.max(1, Math.min(viewportHeight, rect.bottom) - Math.max(0, rect.top)),
        },
        area,
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
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || (b.area - a.area))
    .map(({ score, area, ...element }) => element)
    .slice(0, MAX_ELEMENTS);
})()`

interface BrowserAnnotationSession {
  imageDataUrl: string
  filePart: FileUIPart
  elements: BrowserAnnotationElement[]
  editingAnnotationId: string | null
  surfaceSize: {
    width: number
    height: number
  }
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

function isBrowserAnnotationElement(value: unknown): value is BrowserAnnotationElement {
  if (!isRecord(value) || !isRecord(value.rect) || !isRecord(value.styles)) {
    return false
  }
  return typeof value.id === 'string'
    && typeof value.tagName === 'string'
    && typeof value.label === 'string'
    && (value.description === undefined || typeof value.description === 'string')
    && typeof value.role === 'string'
    && typeof value.selector === 'string'
    && (value.attributes === undefined || isRecord(value.attributes))
    && typeof value.rect.x === 'number'
    && typeof value.rect.y === 'number'
    && typeof value.rect.width === 'number'
    && typeof value.rect.height === 'number'
    && typeof value.styles.color === 'string'
    && typeof value.styles.backgroundColor === 'string'
    && typeof value.styles.opacity === 'string'
    && typeof value.styles.fontFamily === 'string'
    && typeof value.styles.fontSize === 'string'
    && typeof value.styles.fontWeight === 'string'
    && typeof value.styles.lineHeight === 'string'
    && typeof value.styles.borderRadius === 'string'
    && (value.styles.borderColor === undefined || typeof value.styles.borderColor === 'string')
    && (value.styles.borderWidth === undefined || typeof value.styles.borderWidth === 'string')
    && (value.styles.display === undefined || typeof value.styles.display === 'string')
    && (value.styles.alignItems === undefined || typeof value.styles.alignItems === 'string')
    && (value.styles.justifyContent === undefined || typeof value.styles.justifyContent === 'string')
    && (value.styles.flexDirection === undefined || typeof value.styles.flexDirection === 'string')
    && (value.styles.width === undefined || typeof value.styles.width === 'string')
    && (value.styles.height === undefined || typeof value.styles.height === 'string')
    && (value.styles.marginTop === undefined || typeof value.styles.marginTop === 'string')
    && (value.styles.marginRight === undefined || typeof value.styles.marginRight === 'string')
    && (value.styles.marginBottom === undefined || typeof value.styles.marginBottom === 'string')
    && (value.styles.marginLeft === undefined || typeof value.styles.marginLeft === 'string')
    && (value.styles.paddingTop === undefined || typeof value.styles.paddingTop === 'string')
    && (value.styles.paddingRight === undefined || typeof value.styles.paddingRight === 'string')
    && (value.styles.paddingBottom === undefined || typeof value.styles.paddingBottom === 'string')
    && (value.styles.paddingLeft === undefined || typeof value.styles.paddingLeft === 'string')
    && (value.styles.rowGap === undefined || typeof value.styles.rowGap === 'string')
    && (value.styles.columnGap === undefined || typeof value.styles.columnGap === 'string')
}

function readRuntimeEvaluateValue(result: unknown): unknown {
  if (!isRecord(result) || !isRecord(result.result)) {
    return null
  }
  return result.result.value
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

async function readBrowserAnnotationElements(input: {
  bridge: NonNullable<ReturnType<typeof readBrowserBridge>>
  threadId: string
  tabId: string
}): Promise<BrowserAnnotationElement[]> {
  try {
    const result = await input.bridge.executeCdp({
      threadId: input.threadId,
      tabId: input.tabId,
      method: 'Runtime.evaluate',
      params: {
        expression: BROWSER_ANNOTATION_ELEMENT_SCAN_EXPRESSION,
        returnByValue: true,
        awaitPromise: false,
      },
    })
    const value = readRuntimeEvaluateValue(result)
    if (!Array.isArray(value)) {
      return []
    }
    return value.filter(isBrowserAnnotationElement)
  }
  catch {
    return []
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
  onCloseLastTab,
}: BrowserPanelProps) {
  const resolvedOwnerId = ownerId ?? DEFAULT_BROWSER_PANEL_OWNER_ID
  const browserState = useBrowserPanelStore(selectOwnerBrowserState(resolvedOwnerId))
  const recentHistory = useBrowserPanelStore(selectOwnerBrowserHistory(resolvedOwnerId))
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
  const saveAnnotation = useBrowserPanelStore(state => state.saveAnnotation)
  const markAnnotationSent = useBrowserPanelStore(state => state.markAnnotationSent)
  const deleteAnnotation = useBrowserPanelStore(state => state.deleteAnnotation)
  const clearAnnotations = useBrowserPanelStore(state => state.clearAnnotations)
  const setAnnotationInteractionMode = useBrowserPanelStore(
    state => state.setAnnotationInteractionMode,
  )
  const setAnnotationTrayCollapsed = useBrowserPanelStore(
    state => state.setAnnotationTrayCollapsed,
  )
  const dismissAnnotationCoachmark = useBrowserPanelStore(
    state => state.dismissAnnotationCoachmark,
  )
  const ownerAnnotations = useBrowserPanelStore(selectOwnerBrowserAnnotations(resolvedOwnerId))
  const annotationInteractionMode = useBrowserPanelStore(
    state => state.annotationInteractionModeByOwnerId[resolvedOwnerId] ?? 'browse',
  )
  const annotationTrayCollapsed = useBrowserPanelStore(
    state => state.annotationTrayCollapsedByOwnerId[resolvedOwnerId] ?? false,
  )
  const annotationCoachmarkDismissed = useBrowserPanelStore(
    state => state.annotationCoachmarkDismissedByOwnerId[resolvedOwnerId] ?? false,
  )

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const previousActiveTabIdRef = useRef<string | null>(null)
  const addressDraftByTabIdRef = useRef<Map<string, string>>(new Map())
  const lastSyncedAddressValueRef = useRef<string | undefined>(undefined)
  const stableBoundsFrameCountRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)

  const [addressValue, setAddressValue] = useState('')
  const [isEditingAddress, setIsEditingAddress] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [annotationSession, setAnnotationSession] = useState<BrowserAnnotationSession | null>(null)
  const [annotationSubmitting, setAnnotationSubmitting] = useState(false)

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
  const activeBrowserAnnotations = useMemo(
    () => ownerAnnotations.filter(annotation => annotation.tabId === activeBrowserTabId),
    [activeBrowserTabId, ownerAnnotations],
  )
  const isAnnotationCommentMode = annotationInteractionMode === 'comment'
  const shouldShowAnnotationCoachmark = Boolean(activeBrowserTabId)
    && !annotationCoachmarkDismissed
    && annotationSession === null
    && annotationInteractionMode === 'browse'
  const editingBrowserAnnotation = useMemo(
    () =>
      annotationSession?.editingAnnotationId
        ? activeBrowserAnnotations.find(annotation => annotation.id === annotationSession.editingAnnotationId) ?? null
        : null,
    [activeBrowserAnnotations, annotationSession?.editingAnnotationId],
  )
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
      setAnnotationInteractionMode('browse', resolvedOwnerId)
      setAnnotationSession(null)
      setAnnotationSubmitting(false)
      unsubscribe()
      void bridge.hide({ threadId: resolvedOwnerId }).catch(() => {})
    }
  }, [resolvedOwnerId, setAnnotationInteractionMode, upsertOwnerState])

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

  const syncBounds = useCallback(() => {
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
        && annotationSession === null
    if (!visible) {
      bridge.setBounds({ threadId: resolvedOwnerId, bounds: null, surface: 'native' })
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
  }, [activePanelTab?.kind, annotationSession, browserState?.open, resolvedOwnerId])

  const scheduleStableBoundsSync = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return
    }

    const tick = () => {
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
  }, [syncBounds])

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) {
      readBrowserBridge()?.setBounds({ threadId: resolvedOwnerId, bounds: null, surface: 'native' })
      return
    }

    scheduleStableBoundsSync()
    const resizeObserver = new ResizeObserver(scheduleStableBoundsSync)
    resizeObserver.observe(element)
    window.addEventListener('resize', scheduleStableBoundsSync)
    window.addEventListener('scroll', scheduleStableBoundsSync, true)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleStableBoundsSync)
      window.removeEventListener('scroll', scheduleStableBoundsSync, true)
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      readBrowserBridge()?.setBounds({ threadId: resolvedOwnerId, bounds: null, surface: 'native' })
    }
  }, [activePanelTab?.kind, resolvedOwnerId, scheduleStableBoundsSync])

  useEffect(() => {
    scheduleStableBoundsSync()
  }, [activePanelTab?.id, annotationSession, scheduleStableBoundsSync])

  useEffect(() => {
    setAnnotationSession(null)
    setAnnotationSubmitting(false)
    setAnnotationInteractionMode('browse', resolvedOwnerId)
  }, [activeBrowserTabId, resolvedOwnerId, setAnnotationInteractionMode])

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
    if (!activeBrowserTabId || !activeBrowserTab) {
      return
    }
    const bridge = readBrowserBridge()
    const viewport = viewportRef.current
    if (!bridge || !viewport) {
      return
    }
    const activeBrowserTabUrl = activeBrowserTab.lastCommittedUrl ?? activeBrowserTab.url
    void runBrowserAction(async () => {
      const rect = viewport.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        throw new Error('The browser viewport isn\'t ready for annotation.')
      }

      const filePart = await captureBrowserAnnotationScreenshot({
        bridge,
        threadId: resolvedOwnerId,
        tabId: activeBrowserTabId,
        url: activeBrowserTabUrl,
      })
      const elements = await readBrowserAnnotationElements({
        bridge,
        threadId: resolvedOwnerId,
        tabId: activeBrowserTabId,
      })

      bridge.setBounds({ threadId: resolvedOwnerId, bounds: null, surface: 'native' })
      setAnnotationInteractionMode('comment', resolvedOwnerId)
      dismissAnnotationCoachmark(resolvedOwnerId)
      setAnnotationSession({
        imageDataUrl: filePart.url,
        filePart,
        elements,
        editingAnnotationId: null,
        surfaceSize: {
          width: rect.width,
          height: rect.height,
        },
      })
    })
  }, [
    activeBrowserTab,
    activeBrowserTabId,
    dismissAnnotationCoachmark,
    resolvedOwnerId,
    runBrowserAction,
    setAnnotationInteractionMode,
  ])

  const handleCancelAnnotation = useCallback(() => {
    setAnnotationSession(null)
    setAnnotationSubmitting(false)
    setAnnotationInteractionMode('browse', resolvedOwnerId)
    scheduleStableBoundsSync()
  }, [resolvedOwnerId, scheduleStableBoundsSync, setAnnotationInteractionMode])

  const buildBrowserAnnotationRecordInput = useCallback((
    input: BrowserAnnotationOverlaySubmitInput,
  ): Omit<BrowserAnnotationRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'> | null => {
    if (!annotationSession || !activeBrowserTab) {
      return null
    }
    return {
      ownerId: resolvedOwnerId,
      tabId: activeBrowserTab.id,
      title: getTabTitle(activeBrowserTab),
      url: activeBrowserTab.lastCommittedUrl ?? activeBrowserTab.url,
      body: input.body,
      anchor: input.anchor,
      designChange: input.designChange,
      attachedImages: input.attachedImages,
      screenshot: annotationSession.filePart,
      elements: annotationSession.elements,
      surfaceSize: annotationSession.surfaceSize,
    }
  }, [activeBrowserTab, annotationSession, resolvedOwnerId])

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

  const handleSaveAnnotation = useCallback((input: BrowserAnnotationOverlaySubmitInput) => {
    const recordInput = buildBrowserAnnotationRecordInput(input)
    if (!recordInput) {
      return
    }
    saveAnnotation({
      ...recordInput,
      id: annotationSession?.editingAnnotationId ?? undefined,
      status: 'saved',
    }, resolvedOwnerId)
    setAnnotationSession(null)
    setAnnotationSubmitting(false)
    setAnnotationInteractionMode('browse', resolvedOwnerId)
    scheduleStableBoundsSync()
  }, [
    annotationSession?.editingAnnotationId,
    buildBrowserAnnotationRecordInput,
    resolvedOwnerId,
    saveAnnotation,
    scheduleStableBoundsSync,
    setAnnotationInteractionMode,
  ])

  const handleSubmitAnnotation = useCallback((input: BrowserAnnotationOverlaySubmitInput) => {
    const recordInput = buildBrowserAnnotationRecordInput(input)
    if (!recordInput) {
      return
    }
    const annotationId = saveAnnotation({
      ...recordInput,
      id: annotationSession?.editingAnnotationId ?? undefined,
      status: 'saved',
    }, resolvedOwnerId)
    const now = Date.now()
    const record: BrowserAnnotationRecord = {
      ...recordInput,
      id: annotationId,
      createdAt: now,
      updatedAt: now,
      status: 'saved',
    }
    void (async () => {
      setAnnotationSubmitting(true)
      const sent = await sendBrowserAnnotationRecord(record)
      if (!sent) {
        setAnnotationSubmitting(false)
        return
      }
      markAnnotationSent(annotationId, resolvedOwnerId)
      setAnnotationSession(null)
      setAnnotationSubmitting(false)
      setAnnotationInteractionMode('browse', resolvedOwnerId)
      scheduleStableBoundsSync()
    })()
  }, [
    buildBrowserAnnotationRecordInput,
    annotationSession?.editingAnnotationId,
    markAnnotationSent,
    resolvedOwnerId,
    saveAnnotation,
    scheduleStableBoundsSync,
    sendBrowserAnnotationRecord,
    setAnnotationInteractionMode,
  ])

  const handleEditSavedAnnotation = useCallback((annotation: BrowserAnnotationRecord) => {
    if (activeBrowserTabId !== annotation.tabId) {
      return
    }
    readBrowserBridge()?.setBounds({ threadId: resolvedOwnerId, bounds: null, surface: 'native' })
    setAnnotationInteractionMode('comment', resolvedOwnerId)
    setAnnotationSession({
      imageDataUrl: annotation.screenshot.url,
      filePart: annotation.screenshot,
      elements: annotation.elements,
      editingAnnotationId: annotation.id,
      surfaceSize: annotation.surfaceSize,
    })
  }, [activeBrowserTabId, resolvedOwnerId, setAnnotationInteractionMode])

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
    [activePanelTab, handleCloseTab, handleSelectTab, tabs],
  )

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
      </div>

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
        <div className="relative shrink-0">
          <button
            type="button"
            className={cn(
              'flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs transition-colors disabled:opacity-30',
              isAnnotationCommentMode
                ? 'bg-primary/12 text-primary hover:bg-primary/16'
                : 'text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground',
            )}
            disabled={!activeBrowserTabId}
            onClick={annotationSession ? handleCancelAnnotation : handleStartAnnotation}
            aria-pressed={isAnnotationCommentMode}
            aria-label={isAnnotationCommentMode ? 'Exit annotate mode' : 'Annotate browser'}
          >
            <MessageSquarePlusIcon className="size-3.5" />
            <span>Annotate</span>
          </button>
          {shouldShowAnnotationCoachmark && (
            <div className="absolute right-0 top-9 z-30 w-64 rounded-lg bg-primary p-3 text-primary-foreground shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Try Annotation Mode</div>
                  <div className="mt-1 text-xs leading-4 opacity-90">
                    Leave visual comments with a single click or drag to select an area.
                  </div>
                </div>
                <button
                  type="button"
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-primary-foreground/80 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
                  onClick={() => dismissAnnotationCoachmark(resolvedOwnerId)}
                  aria-label="Dismiss annotation coachmark"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

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
              {annotationSession && (
                <BrowserAnnotationOverlay
                  key={annotationSession.editingAnnotationId ?? 'new'}
                  imageDataUrl={annotationSession.imageDataUrl}
                  elements={annotationSession.elements}
                  surfaceSize={annotationSession.surfaceSize}
                  submitting={annotationSubmitting}
                  initialAnnotation={editingBrowserAnnotation}
                  onCancel={handleCancelAnnotation}
                  onSave={handleSaveAnnotation}
                  onSubmit={handleSubmitAnnotation}
                />
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
