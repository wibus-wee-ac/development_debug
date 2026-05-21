import {
  CheckIcon,
  ClipboardCopyIcon,
  Loader2Icon,
  PackageIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react'
import { useCallback, useReducer, useRef } from 'react'

import { postWorkspacesByIdPack } from '~/api-gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import { cn } from '~/lib/cn'

import { formatTokens, mergeScopePaths, pathsToIncludeFromDraft } from './pack-codebase-utils'

type PackStyle = 'xml' | 'markdown' | 'plain'

interface PackCodebaseDialogProps {
  workspaceId: string
  workspaceName: string
  /** Pre-selected paths from file tree (relative to workspace root). Empty = whole workspace. */
  initialPaths?: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

const FORMAT_OPTIONS: { value: PackStyle, label: string, description: string }[] = [
  { value: 'xml', label: 'XML', description: 'Claude 推荐' },
  { value: 'markdown', label: 'Markdown', description: '通用' },
  { value: 'plain', label: 'Plain', description: '纯文本' },
]

const EMPTY_PATHS: string[] = []

interface PackCodebaseDialogState {
  style: PackStyle
  compress: boolean
  removeComments: boolean
  scopePaths: string[]
  pathInput: string
  ignore: string
  status: 'idle' | 'packing' | 'done' | 'error'
  result: { totalFiles: number, totalTokens: number } | null
  errorMsg: string
}

type PackCodebaseDialogAction
  = | { type: 'set-style', style: PackStyle }
    | { type: 'set-compress', compress: boolean }
    | { type: 'set-remove-comments', removeComments: boolean }
    | { type: 'set-path-input', pathInput: string }
    | { type: 'add-paths', input: string }
    | { type: 'remove-path', path: string }
    | { type: 'set-ignore', ignore: string }
    | { type: 'pack/start' }
    | { type: 'pack/success', result: { totalFiles: number, totalTokens: number } }
    | { type: 'pack/error', errorMsg: string }
    | { type: 'reset-status' }
    | { type: 'pop-last-path' }
    | { type: 'commit-path-input' }

function createInitialPackCodebaseDialogState(initialPaths: string[]): PackCodebaseDialogState {
  return {
    style: 'xml',
    compress: true,
    removeComments: false,
    scopePaths: initialPaths,
    pathInput: '',
    ignore: '',
    status: 'idle',
    result: null,
    errorMsg: '',
  }
}

function packCodebaseDialogReducer(state: PackCodebaseDialogState, action: PackCodebaseDialogAction): PackCodebaseDialogState {
  switch (action.type) {
    case 'set-style':
      return { ...state, style: action.style }
    case 'set-compress':
      return { ...state, compress: action.compress }
    case 'set-remove-comments':
      return { ...state, removeComments: action.removeComments }
    case 'set-path-input':
      return { ...state, pathInput: action.pathInput }
    case 'add-paths':
      return { ...state, scopePaths: mergeScopePaths(state.scopePaths, action.input), pathInput: '' }
    case 'remove-path':
      return { ...state, scopePaths: state.scopePaths.filter(path => path !== action.path) }
    case 'set-ignore':
      return { ...state, ignore: action.ignore }
    case 'pack/start':
      return { ...state, status: 'packing', result: null, errorMsg: '' }
    case 'pack/success':
      return { ...state, status: 'done', result: action.result }
    case 'pack/error':
      return { ...state, status: 'error', errorMsg: action.errorMsg }
    case 'reset-status':
      return { ...state, status: 'idle', result: null, errorMsg: '' }
    case 'pop-last-path':
      return { ...state, scopePaths: state.scopePaths.slice(0, -1) }
    case 'commit-path-input':
      return { ...state, scopePaths: mergeScopePaths(state.scopePaths, state.pathInput), pathInput: '' }
    default:
      return state
  }
}

function PackCodebaseDialogContent({
  workspaceId,
  workspaceName,
  initialPaths,
}: {
  workspaceId: string
  workspaceName: string
  initialPaths: string[]
}) {
  const [state, dispatch] = useReducer(packCodebaseDialogReducer, initialPaths, createInitialPackCodebaseDialogState)
  const pathInputRef = useRef<HTMLTextAreaElement>(null)

  const addPath = useCallback((raw: string) => {
    dispatch({ type: 'add-paths', input: raw })
  }, [])

  const handlePathKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === ',') {
      e.preventDefault()
      addPath(state.pathInput)
    }
    if (e.key === 'Backspace' && !state.pathInput && state.scopePaths.length > 0) {
      dispatch({ type: 'pop-last-path' })
    }
  }, [addPath, state.pathInput, state.scopePaths.length])

  const handlePack = useCallback(async () => {
    dispatch({ type: 'pack/start' })

    try {
      const include = pathsToIncludeFromDraft(state.scopePaths, state.pathInput)
      if (state.pathInput.trim()) {
        dispatch({ type: 'commit-path-input' })
      }
      const res = await postWorkspacesByIdPack({
        path: { id: workspaceId },
        body: {
          style: state.style,
          compress: state.compress,
          removeComments: state.removeComments,
          include,
          ignore: state.ignore.trim() || undefined,
        },
      })

      if (!res.data) {
        throw new Error('No response from server')
      }

      await navigator.clipboard.writeText(res.data.content)
      dispatch({
        type: 'pack/success',
        result: { totalFiles: res.data.totalFiles, totalTokens: res.data.totalTokens },
      })
    }
    catch (err) {
      dispatch({ type: 'pack/error', errorMsg: err instanceof Error ? err.message : '未知错误' })
    }
  }, [state.compress, state.ignore, state.pathInput, state.removeComments, state.scopePaths, state.style, workspaceId])

  return (
    <div className="space-y-5 py-1">
      {state.status === 'done' && state.result && (
        <div
          className="flex items-start gap-3 rounded-lg bg-muted/60 px-4 py-3"
          data-testid="pack-codebase-success"
        >
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">已复制到剪贴板</p>
            <p
              className="mt-0.5 text-xs text-muted-foreground"
              data-testid="pack-codebase-result-summary"
            >
              {state.result.totalFiles}
              {' 个文件 · '}
              {formatTokens(state.result.totalTokens)}
              {' tokens'}
            </p>
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{state.errorMsg || '打包失败'}</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        工作区：
        <span className="font-medium text-foreground">{workspaceName}</span>
      </p>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">输出格式</Label>
        <div className="flex gap-1.5">
          {FORMAT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => dispatch({ type: 'set-style', style: opt.value })}
              className={cn(
                'flex-1 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                state.style === opt.value
                  ? 'border-foreground/40 bg-foreground/5 text-foreground'
                  : 'border-border bg-transparent text-muted-foreground hover:border-border/80 hover:text-foreground/70',
              )}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="mt-0.5 text-[11px] leading-tight opacity-70">{opt.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="flex cursor-pointer items-center gap-1.5 text-sm" htmlFor="compress-toggle">
              <ZapIcon className="size-3 text-muted-foreground" />
              智能压缩
            </Label>
            <p className="text-xs text-muted-foreground">Tree-sitter 提取结构，减少约 70% tokens</p>
          </div>
          <Switch
            id="compress-toggle"
            size="sm"
            checked={state.compress}
            onCheckedChange={value => dispatch({ type: 'set-compress', compress: value })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="cursor-pointer text-sm" htmlFor="comments-toggle">移除注释</Label>
          <Switch
            id="comments-toggle"
            size="sm"
            checked={state.removeComments}
            onCheckedChange={value => dispatch({ type: 'set-remove-comments', removeComments: value })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground" htmlFor="pack-scope-paths">
          打包范围
          <span className="ml-1 opacity-50">（空 = 整个工作区）</span>
        </Label>
        <div
          role="group"
          className={cn(
            'flex min-h-9 flex-wrap gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-xs transition-colors focus-within:ring-1 focus-within:ring-ring',
            state.scopePaths.length === 0 && 'items-center',
          )}
          onMouseDown={(event) => {
            const target = event.target
            if (target instanceof HTMLElement && target.closest('button, textarea')) {
              return
            }
            pathInputRef.current?.focus()
          }}
        >
          {state.scopePaths.map(path => (
            <span
              key={path}
              className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground"
            >
              <span className="max-w-52 truncate">{path}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'remove-path', path })
                }}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={`移除 ${path}`}
              >
                <XIcon className="size-2.5" />
              </button>
            </span>
          ))}
          <textarea
            id="pack-scope-paths"
            ref={pathInputRef}
            value={state.pathInput}
            onChange={e => dispatch({ type: 'set-path-input', pathInput: e.target.value })}
            onKeyDown={handlePathKeyDown}
            onBlur={() => addPath(state.pathInput)}
            placeholder={state.scopePaths.length === 0 ? 'src/renderer, packages/ipc …' : ''}
            rows={2}
            data-testid="pack-codebase-scope-input"
            className="min-h-8 min-w-24 flex-1 resize-none bg-transparent font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground/40"
          />
        </div>
        <p className="text-[11px] text-muted-foreground/50">
          每行或逗号分隔；从文件树右键"Pack & Copy"可自动填入
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">排除 (glob)</Label>
        <Input
          placeholder="**/*.test.ts,docs/**"
          value={state.ignore}
          onChange={e => dispatch({ type: 'set-ignore', ignore: e.target.value })}
          data-testid="pack-codebase-ignore-input"
          className="h-8 font-mono text-xs"
        />
      </div>

      <div className="flex gap-2">
        {state.status === 'done'
          ? (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => dispatch({ type: 'reset-status' })}
                data-testid="pack-codebase-reset-btn"
              >
                重新配置
              </Button>
            )
          : (
              <Button
                className="flex-1"
                onClick={handlePack}
                disabled={state.status === 'packing'}
                data-testid="pack-codebase-submit-btn"
              >
                {state.status === 'packing'
                  ? (
                      <>
                        <Loader2Icon className="size-3.5 animate-spin" />
                        正在打包...
                      </>
                    )
                  : (
                      <>
                        <ClipboardCopyIcon className="size-3.5" />
                        打包并复制
                      </>
                    )}
              </Button>
            )}
      </div>
    </div>
  )
}

export function PackCodebaseDialog({
  workspaceId,
  workspaceName,
  initialPaths = EMPTY_PATHS,
  open,
  onOpenChange,
}: PackCodebaseDialogProps) {
  const dialogSessionKey = open ? `${workspaceId}:${initialPaths.join(',')}` : `closed:${workspaceId}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" showCloseButton data-testid="pack-codebase-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PackageIcon className="size-4 text-muted-foreground" />
            复制代码库
          </DialogTitle>
        </DialogHeader>
        <PackCodebaseDialogContent
          key={dialogSessionKey}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          initialPaths={initialPaths}
        />
      </DialogContent>
    </Dialog>
  )
}
