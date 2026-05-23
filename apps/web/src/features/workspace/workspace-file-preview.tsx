// Output: Embedded workspace file preview content for the right-side panel.
// Input: Workspace id, workspace-relative file path, and editor-open callback.
// Position: Workspace-owned file rendering surface reused by BrowserPanel tabs.

import { StaticRender } from '@cradle/streamdown'
import { Loader2Icon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BundledLanguage } from 'shiki'

import { DARK_THEME, getHighlighter, LIGHT_THEME, loadLanguage } from '~/components/editor/shiki-highlighter'
import { cn } from '~/lib/cn'

import { useWorkspaceFileContent } from './use-workspace-file-content'
import { getShikiLanguage, isWorkspaceMarkdownFile } from './workspace-file-language'

interface WorkspaceFilePreviewProps {
  workspaceId: string
  path: string
  onOpenEditor: (path: string) => void
}

export function WorkspaceFilePreview({ workspaceId, path, onOpenEditor }: WorkspaceFilePreviewProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const fileQuery = useWorkspaceFileContent(workspaceId, path)
  const content = fileQuery.data?.content

  useEffect(() => {
    panelRef.current?.focus()
  }, [path])

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onDoubleClick={() => onOpenEditor(path)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onOpenEditor(path)
        }
      }}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background outline-none"
      data-testid="workspace-file-preview"
    >
      <div className="min-h-0 flex-1 overflow-y-auto bg-background/80">
        {fileQuery.isLoading && (
          <div className="flex h-32 items-center justify-center">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground/50" aria-hidden="true" />
          </div>
        )}
        {(fileQuery.isError || content === null) && (
          <div className="flex h-32 items-center justify-center px-6 text-center">
            <p className="text-sm text-muted-foreground">Unable to preview this file as text.</p>
          </div>
        )}
        {typeof content === 'string' && (
          isWorkspaceMarkdownFile(path)
            ? <MarkdownPreview content={content} />
            : <CodePreview path={path} content={content} />
        )}
      </div>
    </div>
  )
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="streamdown-root px-5 py-4 text-sm leading-relaxed">
      <StaticRender content={content} />
    </div>
  )
}

function CodePreview({ path, content }: { path: string, content: string }) {
  const [html, setHtml] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHtml('')
    setFailed(false)

    async function renderHighlightedCode() {
      const language = getShikiLanguage(path)
      const loaded = await loadLanguage(language)
      const highlighter = await getHighlighter()
      const lang = loaded ? language : 'plaintext'
      const highlighted = highlighter.codeToHtml(content, {
        lang: lang as BundledLanguage,
        themes: { dark: DARK_THEME, light: LIGHT_THEME },
      })
      if (!cancelled) {
        setHtml(highlighted)
      }
    }

    renderHighlightedCode().catch(() => {
      if (!cancelled) {
        setFailed(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [content, path])

  return (
    <div
      className={cn(
        'tool-call-code-highlight max-h-[calc(100vh-8rem)] overflow-auto p-0 text-[12px] leading-relaxed',
        '[&_.shiki]:!m-0 [&_.shiki]:!bg-transparent [&_.shiki]:!p-4 [&_.shiki]:font-mono [&_.shiki]:text-[12px] [&_.shiki]:leading-relaxed',
      )}
      data-wrap="false"
    >
      {html && !failed
        // Shiki generates escaped token markup from plain text file content.
        // eslint-disable-next-line react-dom/no-dangerously-set-innerhtml
        ? <div dangerouslySetInnerHTML={{ __html: html }} />
        : (
          <pre className="m-0 overflow-auto p-4 font-mono text-[12px] leading-relaxed text-foreground">
            <code>{content}</code>
          </pre>
          )}
    </div>
  )
}
