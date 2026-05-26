/**
 * Output: Cradle-owned AppShot attachment metadata readers and visual cards.
 * Input: AI SDK file parts and native AppShot capture metadata.
 * Position: Chat feature owns AppShot presentation while model input remains a normal file part.
 */

import { AppWindowIcon, XIcon } from 'lucide-react'
import { m } from 'motion/react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { cn } from '~/lib/cn'

import type { CradleAppshotMetadata } from './appshot-attachment-model'

interface AppshotAttachmentCardProps {
  variant: 'composer' | 'thread'
  metadata: CradleAppshotMetadata
  onRemove?: () => void
}

const APPSHOT_CARD_WIDTH = 232
const APPSHOT_THREAD_IMAGE_CANVAS_WIDTH = 256
const APPSHOT_THREAD_IMAGE_INLINE_PADDING = 12
const APPSHOT_FALLBACK_HEIGHT = 140
const APPSHOT_COMPOSER_VERTICAL_PADDING = 8
const APPSHOT_TITLE_HEIGHT = 18

export function AppshotAttachmentCard({
  variant,
  metadata,
  onRemove,
}: AppshotAttachmentCardProps) {
  const title = metadata.windowTitle ?? metadata.appName ?? 'AppShot'
  const accessibilityText = metadata.axTree.trim()
  const snapshotHeight = metadata.transitionSnapshotHeight ?? APPSHOT_FALLBACK_HEIGHT
  const [threadImageSize, setThreadImageSize] = useState<{ height: number, width: number } | null>(null)
  const threadImageHeight = readThreadImageHeight(threadImageSize)
  const renderedComposerHeight = Math.max(
    APPSHOT_COMPOSER_VERTICAL_PADDING,
    snapshotHeight + APPSHOT_COMPOSER_VERTICAL_PADDING + APPSHOT_TITLE_HEIGHT,
  )
  const hasAccessibilityText = accessibilityText.length > 0
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMode, setPreviewMode] = useState<'visual' | 'text'>('visual')
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
      <m.div
        layout
        className={cn(
          'group/appshot relative flex w-[232px] shrink-0 flex-col items-center overflow-visible rounded-2xl pb-2 transition-colors duration-200',
          'cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
          onRemove ? 'hover:bg-muted/45' : 'hover:bg-muted/25',
          variant === 'thread' && 'pt-[10px]',
        )}
        style={{ height: variant === 'composer' ? renderedComposerHeight : undefined }}
        role="button"
        tabIndex={0}
        aria-label={title}
        initial={variant === 'composer' ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
        onClick={openPreview}
        onKeyDown={handleCardKeyDown}
        data-chat-attachment-chip={variant === 'composer' ? true : undefined}
        data-chat-appshot-card
        data-testid="chat-appshot-card"
      >
        {variant === 'composer'
          ? (
              <ComposerAppshotTransitionImage
                alt={title}
                appIconDataUrl={metadata.appIconDataUrl}
                imageDataUrl={metadata.transitionSnapshotDataUrl}
                imageHeight={snapshotHeight}
                title={title}
              />
            )
          : (
              <AppshotImageFrame
                alt={title}
                appIconDataUrl={metadata.appIconDataUrl}
                imageDataUrl={metadata.imageDataUrl}
                imageHeight={APPSHOT_FALLBACK_HEIGHT}
                renderedImageHeight={threadImageHeight}
                slotWidth={APPSHOT_CARD_WIDTH}
                visualWidth={APPSHOT_THREAD_IMAGE_CANVAS_WIDTH}
                imageInlinePadding={APPSHOT_THREAD_IMAGE_INLINE_PADDING}
                usesThreadTreatment
                onImageSize={setThreadImageSize}
              />
            )}
        {variant === 'thread' && (
          <div className="mt-1 w-full truncate text-center text-[13px] font-medium leading-[17px] text-foreground">
            {title}
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
        <span className="sr-only" data-testid="chat-appshot-identity">{title}</span>
      </m.div>
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

function ComposerAppshotTransitionImage({
  alt,
  appIconDataUrl,
  imageDataUrl,
  imageHeight,
  title,
}: {
  alt: string
  appIconDataUrl: string | null
  imageDataUrl: string | null
  imageHeight: number
  title: string
}) {
  return (
    <div className="flex w-full flex-col items-center">
      <div
        className="relative flex w-full items-center justify-center"
        style={{ height: imageHeight }}
      >
        {imageDataUrl
          ? (
              <img
                src={imageDataUrl}
                alt={alt}
                className="object-contain"
                style={{ height: imageHeight, width: APPSHOT_CARD_WIDTH }}
                draggable={false}
                data-testid="chat-appshot-image"
              />
            )
          : (
              <span
                aria-hidden="true"
                className="block"
                style={{ height: imageHeight, width: APPSHOT_CARD_WIDTH }}
                data-testid="chat-appshot-empty-snapshot"
              />
            )}
        <AppshotAppIcon appIconDataUrl={appIconDataUrl} />
      </div>
      <div className="mt-1 w-full truncate text-center text-[13px] font-medium leading-[17px] text-foreground">
        {title}
      </div>
    </div>
  )
}

function AppshotImageFrame({
  alt,
  appIconDataUrl,
  imageDataUrl,
  imageHeight,
  renderedImageHeight = imageHeight,
  imageInlinePadding = 0,
  onImageSize,
  slotWidth,
  usesThreadTreatment = false,
  visualWidth,
}: {
  alt: string
  appIconDataUrl: string | null
  imageDataUrl: string
  imageHeight: number
  renderedImageHeight?: number
  imageInlinePadding?: number
  onImageSize?: (size: { height: number, width: number }) => void
  slotWidth: number
  usesThreadTreatment?: boolean
  visualWidth: number
}) {
  return (
    <div
      className="relative flex items-end justify-center overflow-visible"
      style={{ height: imageHeight, width: slotWidth }}
    >
      <div
        className="relative flex shrink-0 items-end justify-center"
        style={{
          filter: usesThreadTreatment ? 'drop-shadow(0px 10px 5px rgba(0, 0, 0, 0.3))' : undefined,
          height: renderedImageHeight,
          paddingInline: imageInlinePadding,
          width: visualWidth,
          WebkitMaskImage: usesThreadTreatment
            ? 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.21) 79%, rgba(0,0,0,0) 100%)'
            : undefined,
          maskImage: usesThreadTreatment
            ? 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.21) 79%, rgba(0,0,0,0) 100%)'
            : undefined,
        }}
      >
        <img
          src={imageDataUrl}
          alt={alt}
          className="max-h-full max-w-full object-contain"
          loading="lazy"
          draggable={false}
          onLoad={(event) => {
            onImageSize?.({
              height: event.currentTarget.naturalHeight,
              width: event.currentTarget.naturalWidth,
            })
          }}
          data-testid="chat-appshot-image"
        />
      </div>
      <AppshotAppIcon appIconDataUrl={appIconDataUrl} />
    </div>
  )
}

function AppshotAppIcon({ appIconDataUrl }: { appIconDataUrl: string | null }) {
  if (appIconDataUrl) {
    return (
      <img
        src={appIconDataUrl}
        alt=""
        aria-hidden="true"
        className="absolute bottom-0 left-1/2 size-6 -translate-x-1/2 object-contain"
        draggable={false}
        data-testid="chat-appshot-app-icon"
      />
    )
  }

  return (
    <span
      className="absolute bottom-0 left-1/2 flex size-6 -translate-x-1/2 items-center justify-center rounded-[6px] bg-background/95 text-muted-foreground shadow-sm"
      aria-hidden="true"
      data-testid="chat-appshot-app-icon"
    >
      <AppWindowIcon className="size-4" />
    </span>
  )
}

function readThreadImageHeight(size: { height: number, width: number } | null): number {
  if (!size || size.height <= 0 || size.width <= 0) {
    return APPSHOT_FALLBACK_HEIGHT
  }
  const scale = Math.min(APPSHOT_CARD_WIDTH / size.width, APPSHOT_FALLBACK_HEIGHT / size.height)
  return size.height * scale
}
