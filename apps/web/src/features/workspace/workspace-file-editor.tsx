// Output: Monaco-backed workspace file editor content.
// Input: Workspace id and workspace-relative file path tab params.
// Position: Workspace file viewing surface rendered inside BrowserPanel workspace file tabs.

import Editor from '@monaco-editor/react'
import { Loader2Icon } from 'lucide-react'

import { useThemeStore } from '~/store/theme'

import { useWorkspaceFileContent } from './use-workspace-file-content'
import { getMonacoLanguage } from './workspace-file-language'

function useMonacoTheme(): 'vs' | 'vs-dark' {
  const mode = useThemeStore(s => s.mode)
  if (mode === 'dark') {
    return 'vs-dark'
  }
  if (mode === 'light') {
    return 'vs'
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'vs-dark'
  }
  return 'vs'
}

export function WorkspaceFileEditor({ workspaceId, path }: { workspaceId: string, path: string }) {
  const fileQuery = useWorkspaceFileContent(workspaceId, path)
  const monacoTheme = useMonacoTheme()
  const content = fileQuery.data?.content

  if (fileQuery.isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground/50" aria-hidden="true" />
      </div>
    )
  }

  if (fileQuery.isError || content === null || content === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">Unable to read this file as text.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* We dont need this */}
      {/* <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{path}</span>
      </div> */}
      <div className="min-h-0 flex-1">
        <Editor
          key={`${workspaceId}:${path}`}
          value={content}
          language={getMonacoLanguage(path)}
          theme={monacoTheme}
          path={`${workspaceId}/${path}`}
          loading={null}
          options={{
            automaticLayout: true,
            folding: true,
            fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
            fontSize: 13,
            lineNumbers: 'on',
            minimap: { enabled: false },
            readOnly: true,
            renderLineHighlight: 'line',
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            wordWrap: 'off',
          }}
        />
      </div>
    </div>
  )
}
