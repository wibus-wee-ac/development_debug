/**
 * Output: Cradle-owned AppShot attachment metadata readers and visual cards.
 * Input: AI SDK file parts and native AppShot capture metadata.
 * Position: Chat feature owns AppShot presentation while model input remains a normal file part.
 */

import type { FileUIPart } from 'ai'
import { XIcon } from 'lucide-react'
import { m } from 'motion/react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { cn } from '~/lib/cn'

export interface CradleAppshotMetadata {
  kind: 'cradle-appshot'
  appName: string | null
  windowTitle: string | null
  bundleIdentifier: string | null
  imageName: string
  imageDataUrl: string
  imagePath: string | null
  transitionSnapshotDataUrl: string | null
  transitionSnapshotHeight: number | null
  appIconDataUrl: string | null
  axTree: string
}

export type CradleAppshotFilePart = FileUIPart & {
  providerMetadata?: {
    cradle?: {
      appshot?: CradleAppshotMetadata
    }
  }
}

export interface CreateCradleAppshotFilePartInput {
  mediaType: FileUIPart['mediaType']
  filename: string
  imageDataUrl: string
  imagePath: string | null
  transitionSnapshotDataUrl: string | null
  transitionSnapshotHeight: number | null
  appName: string | null
  windowTitle: string | null
  bundleIdentifier: string | null
  appIconDataUrl?: string | null
  axTree?: string
}

interface AppshotAttachmentCardProps {
  variant: 'composer' | 'thread'
  metadata: CradleAppshotMetadata
  onRemove?: () => void
}

const APPSHOT_CARD_WIDTH = 232
const APPSHOT_FALLBACK_HEIGHT = 140
const APPSHOT_COMPOSER_VERTICAL_PADDING = 8
const APPSHOT_IDENTITY_HEIGHT = 22
const APPSHOT_CARD_TRANSITION = {
  type: 'spring' as const,
  duration: 0.3,
  bounce: 0,
}

export function createCradleAppshotFilePart(input: CreateCradleAppshotFilePartInput): CradleAppshotFilePart {
  return {
    type: 'file',
    mediaType: input.mediaType,
    filename: input.filename,
    url: input.imageDataUrl,
    providerMetadata: {
      cradle: {
        appshot: {
          kind: 'cradle-appshot',
          appName: input.appName,
          windowTitle: input.windowTitle,
          bundleIdentifier: input.bundleIdentifier,
          imageName: input.filename,
          imageDataUrl: input.imageDataUrl,
          imagePath: input.imagePath,
          transitionSnapshotDataUrl: input.transitionSnapshotDataUrl,
          transitionSnapshotHeight: input.transitionSnapshotHeight,
          appIconDataUrl: input.appIconDataUrl ?? null,
          axTree: input.axTree ?? '',
        },
      },
    },
  }
}

export function readCradleAppshotMetadata(part: FileUIPart): CradleAppshotMetadata | null {
  const metadata = readRecord(part.providerMetadata)
  const cradle = readRecord(metadata?.cradle)
  const appshot = readRecord(cradle?.appshot)
  if (!appshot || appshot.kind !== 'cradle-appshot') {
    return null
  }

  const imageDataUrl = readString(appshot.imageDataUrl) ?? part.url
  const imageName = readString(appshot.imageName) ?? part.filename ?? 'AppShot'
  return {
    kind: 'cradle-appshot',
    appName: readString(appshot.appName),
    windowTitle: readString(appshot.windowTitle),
    bundleIdentifier: readString(appshot.bundleIdentifier),
    imageName,
    imageDataUrl,
    imagePath: readString(appshot.imagePath),
    transitionSnapshotDataUrl: readString(appshot.transitionSnapshotDataUrl),
    transitionSnapshotHeight: readPositiveNumber(appshot.transitionSnapshotHeight),
    appIconDataUrl: readString(appshot.appIconDataUrl),
    axTree: readString(appshot.axTree) ?? '',
  }
}

export function AppshotAttachmentCard({
  variant,
  metadata,
  onRemove,
}: AppshotAttachmentCardProps) {
  const title = metadata.windowTitle ?? metadata.appName ?? 'AppShot'
  const identityLabel = metadata.appName ?? title
  const accessibilityText = metadata.axTree.trim()
  const snapshotHeight = metadata.transitionSnapshotHeight ?? APPSHOT_FALLBACK_HEIGHT
  const renderedComposerHeight = Math.max(
    APPSHOT_COMPOSER_VERTICAL_PADDING,
    snapshotHeight + APPSHOT_IDENTITY_HEIGHT + APPSHOT_COMPOSER_VERTICAL_PADDING,
  )
  const hasTransitionSnapshot = Boolean(metadata.transitionSnapshotDataUrl)
  const hasAccessibilityText = accessibilityText.length > 0
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMode, setPreviewMode] = useState<'visual' | 'text'>('visual')
  const [threadImageSize, setThreadImageSize] = useState<{ height: number, width: number } | null>(null)
  const threadScreenshotHeight = readThreadScreenshotHeight(threadImageSize)
  const openPreview = () => {
    setPreviewMode('visual')
    setPreviewOpen(true)
  }
  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }
    event.preventDefault()
    openPreview()
  }
  const handleRemoveClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onRemove?.()
  }

  return (
    <>
      <m.figure
        layout
        className={cn(
          'group/appshot relative m-0 flex w-[232px] shrink-0 flex-col items-center overflow-visible rounded-2xl pb-2 text-left text-xs',
          'cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
          onRemove ? 'hover:bg-muted/45' : 'hover:bg-muted/25',
          variant === 'thread' && 'my-1 pt-[10px]',
        )}
        style={{ height: variant === 'composer' ? renderedComposerHeight : undefined }}
        role="button"
        tabIndex={0}
        aria-label={title}
        onClick={openPreview}
        onKeyDown={handleCardKeyDown}
        data-chat-attachment-chip={variant === 'composer' ? true : undefined}
        data-chat-appshot-card
        data-testid="chat-appshot-card"
        initial={{ opacity: 0, scale: 0.98, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        whileHover={{ scale: 1.01 }}
        transition={APPSHOT_CARD_TRANSITION}
      >
        {variant === 'composer'
          ? (
              <div
                className="relative flex w-full items-center justify-center"
                style={{ height: snapshotHeight }}
              >
                {hasTransitionSnapshot
                  ? (
                      <img
                        src={metadata.transitionSnapshotDataUrl ?? undefined}
                        alt=""
                        aria-hidden="true"
                        className="object-contain"
                        style={{ height: snapshotHeight, width: APPSHOT_CARD_WIDTH }}
                        draggable={false}
                        data-testid="chat-appshot-image"
                      />
                    )
                  : (
                      <span
                        aria-hidden="true"
                        className="block"
                        style={{ height: snapshotHeight, width: APPSHOT_CARD_WIDTH }}
                        data-testid="chat-appshot-image"
                      />
                    )}
              </div>
            )
          : (
              <div
                className="relative flex items-end justify-center"
                style={{ height: APPSHOT_FALLBACK_HEIGHT, width: APPSHOT_CARD_WIDTH }}
              >
                <div
                  className="flex items-end justify-center"
                  style={{
                    filter: 'drop-shadow(0px 10px 5px rgba(0, 0, 0, 0.3))',
                    height: threadScreenshotHeight,
                    paddingInline: 12,
                    width: 256,
                    WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.21) 79%, rgba(0,0,0,0) 100%)',
                    maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.21) 79%, rgba(0,0,0,0) 100%)',
                  }}
                >
                  <img
                    src={metadata.imageDataUrl}
                    alt={title}
                    className="max-h-full max-w-full object-contain"
                    loading="lazy"
                    draggable={false}
                    onLoad={event => {
                      setThreadImageSize({
                        height: event.currentTarget.naturalHeight,
                        width: event.currentTarget.naturalWidth,
                      })
                    }}
                    data-testid="chat-appshot-image"
                  />
                </div>
                {metadata.appIconDataUrl && (
                  <img
                    src={metadata.appIconDataUrl}
                    alt=""
                    aria-hidden="true"
                    className="absolute bottom-0 left-1/2 size-6 -translate-x-1/2 object-contain"
                    draggable={false}
                  />
                )}
              </div>
            )}
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="pointer-events-none absolute right-1.5 top-1.5 z-20 size-6 bg-background/95 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/appshot:pointer-events-auto group-hover/appshot:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
            onClick={handleRemoveClick}
            aria-label={`Remove ${title}`}
            data-testid="chat-remove-attachment-btn"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </Button>
        )}
        <figcaption
          className={cn(
            'mt-1 flex w-full min-w-0 items-center justify-center gap-1.5 px-2 text-center text-[13px] font-medium leading-[17px] text-foreground',
            variant === 'composer' && 'h-[17px]',
          )}
          title={title}
          data-testid="chat-appshot-identity"
        >
          {metadata.appIconDataUrl && (
            <img
              src={metadata.appIconDataUrl}
              alt=""
              aria-hidden="true"
              className="size-4 shrink-0 object-contain"
              draggable={false}
              data-testid="chat-appshot-app-icon"
            />
          )}
          <span className="min-w-0 truncate">{identityLabel}</span>
        </figcaption>
      </m.figure>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="grid h-[min(82vh,44rem)] w-[min(86vw,64rem)] max-w-full grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[min(86vw,64rem)]"
          showCloseButton
          data-testid="chat-appshot-preview-dialog"
        >
          <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 px-4 py-3 pr-12">
            <DialogTitle className="min-w-0 truncate text-sm">{title}</DialogTitle>
            {hasAccessibilityText && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setPreviewMode(current => current === 'visual' ? 'text' : 'visual')}
                data-testid="chat-appshot-preview-toggle"
              >
                {previewMode === 'visual' ? 'View text' : 'Show screenshot'}
              </Button>
            )}
          </DialogHeader>
          {previewMode === 'text' && hasAccessibilityText
            ? (
                <div className="min-h-0 overflow-y-auto bg-background px-5 py-4">
                  <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                    {accessibilityText}
                  </pre>
                </div>
              )
            : (
                <div className="flex min-h-0 items-center justify-center bg-background p-4">
                  <img
                    src={metadata.imageDataUrl}
                    alt={title}
                    className="max-h-full max-w-full object-contain"
                    draggable={false}
                    data-testid="chat-appshot-preview-image"
                  />
                </div>
              )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function readThreadScreenshotHeight(size: { height: number, width: number } | null): number {
  if (!size || size.height <= 0 || size.width <= 0) {
    return APPSHOT_FALLBACK_HEIGHT
  }
  const scale = Math.min(APPSHOT_CARD_WIDTH / size.width, APPSHOT_FALLBACK_HEIGHT / size.height)
  return size.height * scale
}
