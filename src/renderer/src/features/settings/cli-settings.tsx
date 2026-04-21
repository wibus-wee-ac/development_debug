// Input: ipc proxy, CliAgent / DetectedCli types, coss UI primitives
// Output: CliSettings component — macOS-style grouped list for CLI agent management
// Position: Settings feature section for CLI agent management

import type { CliAgent, DetectedCli } from '@main/ipc-types'
import { Input } from '@renderer/components/ui/input'
import { ipc } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import {
  PlusIcon,
  RefreshCwIcon,
  TerminalIcon,
  Trash2Icon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

const WHITESPACE_RE = /\s+/

function useCliAgents() {
  const [agents, setAgents] = useState<CliAgent[]>([])
  const refresh = useCallback(async () => {
    setAgents((await ipc!.cli.listAgents()) as CliAgent[])
  }, [])
  useEffect(() => { refresh() }, [refresh])
  return { agents, refresh }
}

function EditPanel({
  agent,
  onSave,
  onClose,
}: {
  agent: CliAgent
  onSave: (patch: Partial<Pick<CliAgent, 'name' | 'executable' | 'args'>>) => Promise<void>
  onClose?: () => void
}) {
  const argsStr = (() => {
    try { return (JSON.parse(agent.args) as string[]).join(' ') }
    catch { return '' }
  })()
  const [name, setName] = useState(agent.name)
  const [executable, setExecutable] = useState(agent.executable)
  const [args, setArgs] = useState(argsStr)
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !executable.trim()) return
    setSaving(true)
    const arr = args.trim() ? args.trim().split(WHITESPACE_RE) : []
    await onSave({ name: name.trim(), executable: executable.trim(), args: JSON.stringify(arr) })
    setSaving(false)
    onClose?.()
  }

  return (
    <form onSubmit={handleSave} className="border-t bg-muted/30 px-4 py-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">名称</label>
          <Input size="sm" value={name} onChange={e => setName(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">可执行文件</label>
          <Input size="sm" value={executable} onChange={e => setExecutable(e.target.value)} required className="font-mono" />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">
            启动参数
            <span className="ml-1 font-normal opacity-50">（空格分隔，可留空）</span>
          </label>
          <Input size="sm" value={args} onChange={e => setArgs(e.target.value)} className="font-mono" placeholder="--flag value …" />
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            取消
          </button>
        )}
        <button
          type="submit"
          disabled={saving || !name.trim() || !executable.trim()}
          className="rounded-md bg-foreground px-3 py-1 text-xs text-background transition-opacity disabled:opacity-40"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  )
}

function AgentItem({
  agent,
  onSave,
  onRemove,
}: {
  agent: CliAgent
  onSave: (patch: Partial<Pick<CliAgent, 'name' | 'executable' | 'args'>>) => Promise<void>
  onRemove: () => void
}) {
  return (
    <div className="group">
      {/* Summary row */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <TerminalIcon className="size-4 text-muted-foreground" />
        </div>
        <span className="flex-1 text-sm font-medium">{agent.name}</span>
        <button
          type="button"
          onClick={onRemove}
          className="flex size-6 items-center justify-center rounded opacity-0 text-muted-foreground transition-opacity hover:text-destructive group-hover:opacity-100"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
      {/* Always-visible edit panel */}
      <EditPanel agent={agent} onSave={onSave} onClose={() => { }} />
    </div>
  )
}

function AddRow({ onAdd }: { onAdd: (name: string, executable: string, args: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [executable, setExecutable] = useState('')
  const [args, setArgs] = useState('')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const openForm = () => {
    setOpen(true)
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !executable.trim()) return
    setSaving(true)
    const arr = args.trim() ? args.trim().split(WHITESPACE_RE) : []
    await onAdd(name.trim(), executable.trim(), JSON.stringify(arr))
    setSaving(false)
    setOpen(false)
    setName(''); setExecutable(''); setArgs('')
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openForm}
        className="flex w-full items-center gap-3 px-4 py-3 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-dashed">
          <PlusIcon className="size-4" />
        </div>
        <span className="text-sm">添加 CLI Agent…</span>
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-muted/30 px-4 py-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">名称</label>
          <Input ref={nameRef} size="sm" value={name} onChange={e => setName(e.target.value)} placeholder="Claude Code" required />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">可执行文件</label>
          <Input size="sm" value={executable} onChange={e => setExecutable(e.target.value)} placeholder="claude" required className="font-mono" />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">
            启动参数
            <span className="ml-1 font-normal opacity-50">（可留空）</span>
          </label>
          <Input size="sm" value={args} onChange={e => setArgs(e.target.value)} className="font-mono" placeholder="--dangerously-skip-permissions" />
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim() || !executable.trim()}
          className="rounded-md bg-foreground px-3 py-1 text-xs text-background transition-opacity disabled:opacity-40"
        >
          {saving ? '添加中…' : '添加'}
        </button>
      </div>
    </form>
  )
}

export function CliSettings() {
  const { agents, refresh } = useCliAgents()
  const [detected, setDetected] = useState<DetectedCli[] | null>(null)
  const [detecting, setDetecting] = useState(false)

  const handleDetect = async () => {
    setDetecting(true)
    try { setDetected((await ipc!.cli.detect()) as DetectedCli[]) }
    catch { /* noop */ }
    finally { setDetecting(false) }
  }

  const handleAddDetected = async (d: DetectedCli) => {
    await ipc!.cli.upsertAgent({ id: d.id, name: d.name, executable: d.executable, args: '[]' })
    await refresh()
    setDetected(prev => prev?.map(x => x.id === d.id ? { ...x, alreadyAdded: true } : x) ?? prev)
  }

  const handleAdd = async (name: string, executable: string, args: string) => {
    await ipc!.cli.upsertAgent({ id: name.toLowerCase().replace(WHITESPACE_RE, '-'), name, executable, args })
    await refresh()
  }

  const handleSave = async (agent: CliAgent, patch: Partial<Pick<CliAgent, 'name' | 'executable' | 'args'>>) => {
    await ipc!.cli.upsertAgent({ ...agent, ...patch })
    await refresh()
  }

  const handleRemove = async (id: string) => {
    await ipc!.cli.removeAgent(id)
    await refresh()
  }

  return (
    <div className="flex flex-col gap-6">

      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-heading text-base font-semibold">CLI Agents</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            配置系统中已安装的 CLI 工具，以全屏终端视图在当前工作区运行
          </p>
        </div>
        <button
          type="button"
          onClick={handleDetect}
          title="自动扫描 PATH"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCwIcon className={cn('size-4', detecting && 'animate-spin')} />
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border divide-y">
        {agents.map(agent => (
          <AgentItem
            key={agent.id}
            agent={agent}
            onSave={patch => handleSave(agent, patch)}
            onRemove={() => handleRemove(agent.id)}
          />
        ))}
        <AddRow onAdd={handleAdd} />
      </div>

      {detected !== null && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">检测结果</p>
          {detected.length === 0
            ? (
              <p className="py-4 text-center text-xs text-muted-foreground/60">
                未在 PATH 中检测到 claude、codex 或 opencode
              </p>
            )
            : (
              <div className="overflow-hidden rounded-xl border divide-y">
                {detected.map(d => (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <TerminalIcon className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium">{d.name}</span>
                      <code className="truncate font-mono text-[11px] text-muted-foreground/60">{d.path}</code>
                    </div>
                    {d.alreadyAdded
                      ? <span className="text-xs text-muted-foreground">已添加</span>
                      : (
                        <button
                          type="button"
                          onClick={() => handleAddDetected(d)}
                          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
                        >
                          <PlusIcon className="size-3" />
                          添加
                        </button>
                      )}
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

    </div>
  )
}
