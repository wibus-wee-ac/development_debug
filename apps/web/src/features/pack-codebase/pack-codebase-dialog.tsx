// Input: ipc, PackCodebaseOptions/PackCodebaseResult types, dialog/switch/button ui components
// Output: PackCodebaseDialog — configurable dialog for packing workspace into clipboard
// Position: Feature UI component for pack-codebase; triggered from workspace sidebar or file tree context menu

import {
  CheckIcon,
  ClipboardCopyIcon,
  Loader2Icon,
  PackageIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

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

/** Convert a file-tree path to a repomix include glob pattern. */
function pathToGlob(p: string): string {
  const lastSegment = p.split('/').pop() ?? ''
  const isFile = lastSegment.includes('.')
  return isFile ? p : `${p}/**`
}

/** Convert array of paths to comma-separated glob include string. */
function pathsToInclude(paths: string[]): string {
  return paths.map(pathToGlob).join(',')
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`
  }
  return String(n)
}

const EMPTY_PATHS: string[] = []

export function PackCodebaseDialog({
  workspaceId,
  workspaceName,
  initialPaths = EMPTY_PATHS,
  open,
  onOpenChange,
}: PackCodebaseDialogProps) {
  const [style, setStyle] = useState<PackStyle>('xml')
  const [compress, setCompress] = useState(true)
  const [removeComments, setRemoveComments] = useState(false)
  const [scopePaths, setScopePaths] = useState<string[]>(initialPaths)
  const [pathInput, setPathInput] = useState('')
  const [ignore, setIgnore] = useState('')
  const pathInputRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<'idle' | 'packing' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ totalFiles: number, totalTokens: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  // Reset scope paths when the dialog opens with new initials (render-time adjustment)
  const prevOpenRef = useRef(open)
  if (open && !prevOpenRef.current) {
    prevOpenRef.current = open
    setScopePaths(initialPaths)
    setStatus('idle')
    setResult(null)
    setErrorMsg('')
  }
  if (!open && prevOpenRef.current) {
    prevOpenRef.current = open
  }

  const addPath = useCallback((raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      return
    }
    setScopePaths(prev => prev.includes(trimmed) ? prev : [...prev, trimmed])
    setPathInput('')
  }, [])

  const removePath = useCallback((p: string) => {
    setScopePaths(prev => prev.filter(x => x !== p))
  }, [])

  const handlePathKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addPath(pathInput)
    }
    if (e.key === 'Backspace' && !pathInput && scopePaths.length > 0) {
      setScopePaths(prev => prev.slice(0, -1))
    }
  }, [addPath, pathInput, scopePaths.length])

  const handlePack = useCallback(async () => {
    setStatus('packing')
    setResult(null)
    setErrorMsg('')

    try {
      const include = scopePaths.length > 0 ? pathsToInclude(scopePaths) : undefined
      const res = await postWorkspacesByIdPack({
        path: { id: workspaceId },
        body: {
          style,
          compress,
          removeComments,
          include,
          ignore: ignore.trim() || undefined,
        },
      })

      if (!res.data) {
        throw new Error('No response from server')
      }

      await navigator.clipboard.writeText(res.data.content)
      setResult({ totalFiles: res.data.totalFiles, totalTokens: res.data.totalTokens })
      setStatus('done')
    }
    catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '未知错误')
      setStatus('error')
    }
  }, [workspaceId, style, compress, removeComments, scopePaths, ignore])

  const handleReset = useCallback(() => {
    setStatus('idle')
    setResult(null)
    setErrorMsg('')
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PackageIcon className="size-4 text-muted-foreground" />
            复制代码库
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Result state */}
          {status === 'done' && result && (
            <div className="flex items-start gap-3 rounded-lg bg-muted/60 px-4 py-3">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">已复制到剪贴板</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {result.totalFiles}
                  {' 个文件 · '}
                  {formatTokens(result.totalTokens)}
                  {' tokens'}
                </p>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-destructive">{errorMsg || '打包失败'}</p>
            </div>
          )}

          {/* Workspace label */}
          <p className="text-xs text-muted-foreground">
            工作区：
            <span className="font-medium text-foreground">{workspaceName}</span>
          </p>

          {/* Format selector */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">输出格式</Label>
            <div className="flex gap-1.5">
              {FORMAT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStyle(opt.value)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                    style === opt.value
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

          {/* Options */}
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
                checked={compress}
                onCheckedChange={setCompress}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="cursor-pointer text-sm" htmlFor="comments-toggle">移除注释</Label>
              <Switch
                id="comments-toggle"
                size="sm"
                checked={removeComments}
                onCheckedChange={setRemoveComments}
              />
            </div>
          </div>

          {/* Scope (include paths) — chip input */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              打包范围
              <span className="ml-1 opacity-50">（空 = 整个工作区）</span>
            </Label>
            <div
              role="group"
              className={cn(
                'flex min-h-9 flex-wrap gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-xs transition-colors focus-within:ring-1 focus-within:ring-ring',
                scopePaths.length === 0 && 'items-center',
              )}
              onClick={() => pathInputRef.current?.focus()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') pathInputRef.current?.focus() }}
              tabIndex={0}
            >
              {scopePaths.map(p => (
                <span
                  key={p}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                >
                  <span className="max-w-52 truncate">{p}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removePath(p)
                    }}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={`移除 ${p}`}
                  >
                    <XIcon className="size-2.5" />
                  </button>
                </span>
              ))}
              <input
                ref={pathInputRef}
                value={pathInput}
                onChange={e => setPathInput(e.target.value)}
                onKeyDown={handlePathKeyDown}
                onBlur={() => addPath(pathInput)}
                placeholder={scopePaths.length === 0 ? 'src/renderer, packages/ipc …' : ''}
                className="min-w-24 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/40"
              />
            </div>
            <p className="text-[11px] text-muted-foreground/50">
              每行或逗号分隔；从文件树右键"Pack & Copy"可自动填入
            </p>
          </div>

          {/* Ignore pattern */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">排除 (glob)</Label>
            <Input
              placeholder="**/*.test.ts,docs/**"
              value={ignore}
              onChange={e => setIgnore(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>

          {/* Action */}
          <div className="flex gap-2">
            {status === 'done'
              ? (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleReset}
                  >
                    重新配置
                  </Button>
                )
              : (
                  <Button
                    className="flex-1"
                    onClick={handlePack}
                    disabled={status === 'packing'}
                  >
                    {status === 'packing'
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
      </DialogContent>
    </Dialog>
  )
}
