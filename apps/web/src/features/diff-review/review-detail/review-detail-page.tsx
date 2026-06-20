import type { CodeViewItem } from '@pierre/diffs'
import { GitCompareLine as FileDiffIcon, LoadingLine as Loader2Icon } from '@mingcute/react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

import { ResizeHandle } from '~/components/layout/resize-handle'

import type { CodeViewLineSelection, DiffData, ThreadAnnotation } from '../shared/diff-items'
import { buildItemsFromPatch, EMPTY_DIFF_DATA } from '../shared/diff-items'
import { navigateToCommitView, navigateToGuideView } from '../shared/navigation'
import type { DiffStyle, ReviewFile, ReviewThread } from '../shared/types'
import { useReview } from '../shared/use-review'
import type { DiffStageHandle } from './diff-stage'
import { DiffStage } from './diff-stage'
import { FileListAside } from './file-tree-aside'
import { OpenThreadsRail } from './open-threads-rail'
import { ReviewTopBar } from './review-top-bar'

interface ReviewDetailPageProps {
  workspaceId: string
  repositoryPath?: string | null
  reviewId: string
  initialPath?: string | null
}

export function ReviewDetailPage({
  workspaceId,
  repositoryPath,
  reviewId,
  initialPath,
}: ReviewDetailPageProps) {
  const {
    review,
    isLoading,
    isError,
    isFetching,
    refreshMutation,
    viewedMutation,
    createThreadMutation,
    replyMutation,
    resolveThreadMutation,
    submitMutation,
    preferenceMutation,
  } = useReview({ workspaceId, repositoryPath, reviewId })

  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [selectedLineSelection, setSelectedLineSelection] = useState<CodeViewLineSelection | null>(null)
  const [composerAnchor, setComposerAnchor] = useState<CodeViewLineSelection | null>(null)
  const stageHandleRef = useRef<DiffStageHandle | null>(null)
  const pendingScrollRef = useRef<string | null>(initialPath ?? null)

  // Panel widths — Linear-style: panels are resizable, the diff stays the protagonist.
  // Right rail auto-hides when there are no open threads so the diff gets the room.
  const [fileTreeWidth, setFileTreeWidth] = useState(256)
  const [threadsRailWidth, setThreadsRailWidth] = useState(320)
  const [threadsRailCollapsed, setThreadsRailCollapsed] = useState(false)

  const files = useMemo(() => review?.files ?? [], [review?.files])
  const patch = review?.currentRevision?.patch ?? ''
  const deferredPatch = useDeferredValue(patch)

  const diffData: DiffData = useMemo(
    () => (deferredPatch.trim().length === 0 ? EMPTY_DIFF_DATA : buildItemsFromPatch(deferredPatch)),
    [deferredPatch],
  )

  const hideWhitespaceOnly = review?.preferences.hideWhitespaceOnly ?? false
  const collapseGeneratedFiles = review?.preferences.collapseGeneratedFiles ?? false

  const generatedPaths = useMemo(() => {
    const next = new Set<string>()
    for (const file of files) {
      if (file.isGenerated) {
        next.add(file.path)
        if (file.previousPath) {
          next.add(file.previousPath)
        }
      }
    }
    return next
  }, [files])

  const visibleFiles = useMemo(() => {
    if (!hideWhitespaceOnly && !collapseGeneratedFiles) {
      return files
    }
    return files.filter((file) => {
      if (collapseGeneratedFiles && file.isGenerated) {
        return false
      }
      return !hideWhitespaceOnly || !diffData.whitespaceOnlyPaths.has(file.path)
    })
  }, [collapseGeneratedFiles, diffData.whitespaceOnlyPaths, files, hideWhitespaceOnly])

  const visibleItems = useMemo(() => {
    if (!hideWhitespaceOnly && !collapseGeneratedFiles) {
      return diffData.items
    }
    return diffData.items.filter((item) => {
      if (item.type !== 'diff') {
        return true
      }
      const generated = generatedPaths.has(item.fileDiff.name)
        || (item.fileDiff.prevName ? generatedPaths.has(item.fileDiff.prevName) : false)
      if (collapseGeneratedFiles && generated) {
        return false
      }
      return !hideWhitespaceOnly || !diffData.whitespaceOnlyPaths.has(item.fileDiff.name)
    })
  }, [collapseGeneratedFiles, diffData.items, diffData.whitespaceOnlyPaths, generatedPaths, hideWhitespaceOnly])

  const visiblePathToItemId = useMemo(() => {
    if (!hideWhitespaceOnly && !collapseGeneratedFiles) {
      return diffData.pathToItemId
    }
    const next = new Map<string, string>()
    for (const [path, itemId] of diffData.pathToItemId) {
      if (
        (!collapseGeneratedFiles || !generatedPaths.has(path))
        && (!hideWhitespaceOnly || !diffData.whitespaceOnlyPaths.has(path))
      ) {
        next.set(path, itemId)
      }
    }
    return next
  }, [collapseGeneratedFiles, diffData.pathToItemId, diffData.whitespaceOnlyPaths, generatedPaths, hideWhitespaceOnly])

  useEffect(() => {
    if (review?.preferences.diffStyle) {
      setDiffStyle(review.preferences.diffStyle)
    }
  }, [review?.preferences.diffStyle])

  useEffect(() => {
    if (!selectedFileId && visibleFiles.length > 0) {
      setSelectedFileId(visibleFiles[0]!.id)
    }
    else if (selectedFileId && !visibleFiles.some(file => file.id === selectedFileId)) {
      setSelectedFileId(visibleFiles[0]?.id ?? null)
      setSelectedLineSelection(null)
    }
  }, [selectedFileId, visibleFiles])

  useEffect(() => {
    if (visibleItems.length === 0 || !pendingScrollRef.current) {
      return
    }
    const path = pendingScrollRef.current
    pendingScrollRef.current = null
    stageHandleRef.current?.scrollToPath(path)
  }, [visibleItems])

  const selectFile = (file: ReviewFile) => {
    setSelectedFileId(file.id)
    setSelectedLineSelection(null)
    stageHandleRef.current?.scrollToPath(file.path)
  }

  const jumpToThread = (thread: ReviewThread) => {
    stageHandleRef.current?.scrollToThread(thread)
  }

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center" data-testid="review-detail-loading">
        <Loader2Icon className="size-4 animate-spin !text-muted-foreground/40" aria-hidden />
      </div>
    )
  }

  if (isError || !review) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center" data-testid="review-detail-error">
        <FileDiffIcon className="size-5 !text-muted-foreground/30" aria-hidden />
        <p className="text-[12px] text-muted-foreground">Review unavailable</p>
      </div>
    )
  }

  const hiddenWhitespaceFileCount = hideWhitespaceOnly
    ? files.filter(file => (!collapseGeneratedFiles || !file.isGenerated) && diffData.whitespaceOnlyPaths.has(file.path)).length
    : 0
  const hiddenGeneratedFileCount = collapseGeneratedFiles ? files.filter(file => file.isGenerated).length : 0

  const openThreadCount = review.threads.filter(thread => thread.state !== 'resolved').length
  const showThreadsRail = !threadsRailCollapsed

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden" data-testid="review-detail-page">
      <ReviewTopBar
        review={review}
        diffStyle={diffStyle}
        onDiffStyleChange={(style) => {
          setDiffStyle(style)
          preferenceMutation.mutate({ diffStyle: style })
        }}
        onPreference={input => preferenceMutation.mutate(input)}
        preferencePending={preferenceMutation.isPending}
        onSubmit={(decision, bodyMarkdown) => submitMutation.mutate({ decision, bodyMarkdown })}
        submitPending={submitMutation.isPending}
        onRefresh={() => refreshMutation.mutate()}
        refreshPending={refreshMutation.isPending}
        isFetching={isFetching}
        onOpenGuide={() => navigateToGuideView(workspaceId, review.id, repositoryPath)}
        hasGuide={review.guide.steps.length > 0}
        onOpenCommit={() => navigateToCommitView(workspaceId, review.id, repositoryPath)}
        hasCommitPlan={review.commitPlans.length > 0}
        threadsRailCollapsed={threadsRailCollapsed}
        onToggleThreadsRail={() => setThreadsRailCollapsed(value => !value)}
        openThreadCount={openThreadCount}
      />

      <div className="flex min-h-0 flex-1">
        <FileListAside
          visibleFiles={visibleFiles}
          selectedFileId={selectedFileId}
          onSelectFile={selectFile}
          onToggleViewed={file => viewedMutation.mutate({ fileId: file.id, viewed: !file.isViewed })}
          viewedPending={viewedMutation.isPending}
          hiddenWhitespaceFileCount={hiddenWhitespaceFileCount}
          hiddenGeneratedFileCount={hiddenGeneratedFileCount}
          width={fileTreeWidth}
        />

        <ResizeHandle
          direction="horizontal"
          value={fileTreeWidth}
          onChange={setFileTreeWidth}
          min={200}
          max={420}
          className="w-1.25 h-full"
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DiffStage
            review={review}
            diffData={diffData}
            visibleItems={visibleItems as CodeViewItem<ThreadAnnotation>[]}
            visiblePathToItemId={visiblePathToItemId}
            diffStyle={diffStyle}
            selectedLineSelection={selectedLineSelection}
            onSelectLines={setSelectedLineSelection}
            onFileFromSelection={setSelectedFileId}
            composerAnchor={composerAnchor}
            onComposerOpen={setComposerAnchor}
            onComposerClose={() => setComposerAnchor(null)}
            onCreateThread={(input) => {
              createThreadMutation.mutate({
                fileId: input.fileId,
                anchor: { fileId: input.anchor.fileId, side: input.anchor.side, startLine: input.anchor.startLine, endLine: input.anchor.endLine },
                bodyMarkdown: input.bodyMarkdown,
              })
              setComposerAnchor(null)
              setSelectedLineSelection(null)
            }}
            createPending={createThreadMutation.isPending}
            onReply={(threadId, body) => replyMutation.mutate({ threadId, bodyMarkdown: body })}
            replyPending={replyMutation.isPending}
            onResolve={threadId => resolveThreadMutation.mutate(threadId)}
            resolvePending={resolveThreadMutation.isPending}
            files={files}
            handleRef={handle => stageHandleRef.current = handle}
          />
        </main>

        {showThreadsRail && (
          <>
            <ResizeHandle
              direction="horizontal"
              value={threadsRailWidth}
              onChange={setThreadsRailWidth}
              min={240}
              max={480}
              inverted
              className="w-1.25 h-full"
            />
            <OpenThreadsRail
              review={review}
              files={files}
              onJumpToThread={jumpToThread}
              onResolve={threadId => resolveThreadMutation.mutate(threadId)}
              resolvePending={resolveThreadMutation.isPending}
              onCollapse={() => setThreadsRailCollapsed(true)}
              width={threadsRailWidth}
            />
          </>
        )}
      </div>
    </div>
  )
}
