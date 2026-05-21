type OpenTab = (type: string, params?: Record<string, string | undefined>) => unknown
type WriteText = (value: string) => Promise<void>

interface FileResultNotification {
  type: 'success' | 'error'
  title: string
  description?: string
}

interface SelectFileResultOptions {
  workspaceId: string
  filePath: string
  openTab: OpenTab
  close: () => void
  writeText?: WriteText
  notify?: (notification: FileResultNotification) => void
}

export async function selectFileSearchResult({
  workspaceId,
  filePath,
  openTab,
  close,
  writeText,
  notify,
}: SelectFileResultOptions): Promise<void> {
  close()
  openTab('workspace-detail', { workspaceId })

  if (!writeText) {
    return
  }

  try {
    await writeText(filePath)
    notify?.({
      type: 'success',
      title: 'File path copied',
      description: filePath,
    })
  }
  catch {
    notify?.({
      type: 'error',
      title: 'Copy failed',
      description: filePath,
    })
  }
}
