// Input: useAgentProfiles, useAgentModels, useWorkspaceFiles, MentionPanel, ipc
// Output: CapsuleComposer — floating pill-to-expanded composer for workspace overview
// Position: Sub-component of WorkspaceDetailPage

import {
  BotIcon,
  BrainIcon,
  ChevronDownIcon,
  CpuIcon,
  Loader2Icon,
  SendHorizonalIcon,
} from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '~/components/ui/combobox'
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '~/components/ui/menu'
import { useAgentModels } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import type { MentionItem } from '~/features/chat'
import { MentionPanel } from '~/features/chat/mention-panel'
import { useWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { cn } from '~/lib/cn'
import { useNewChatStore } from '~/store/new-chat'

interface CapsuleComposerProps {
  workspaceId: string
  onSend: (text: string, opts: { agentId: string, modelId?: string, thinkingEffort?: 'low' | 'medium' | 'high' }) => void | Promise<void>
}

export function CapsuleComposer({ workspaceId, onSend }: CapsuleComposerProps) {
  const [expanded, setExpanded] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const mentionStartRef = useRef<number>(-1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [thinkingEffort, setThinkingEffort] = useState<'low' | 'medium' | 'high' | null>(null)
  const agentProfileId = useNewChatStore(s => s.lastAgentProfileId)
  const lastModelByProfile = useNewChatStore(s => s.lastModelByProfile)
  const setLastAgentProfileId = useNewChatStore(s => s.setLastAgentProfileId)
  const setLastModelForProfile = useNewChatStore(s => s.setLastModelForProfile)
  const reconcileProfiles = useNewChatStore(s => s.reconcileProfiles)

  const { profiles } = useAgentProfiles()
  const { models, isLoading: isLoadingModels } = useAgentModels(agentProfileId)
  const { files: workspaceFiles } = useWorkspaceFiles(workspaceId)

  const selectedProfile = profiles.find(p => p.id === agentProfileId) ?? null
  const selectedModelId = agentProfileId ? lastModelByProfile[agentProfileId] ?? null : null
  const selectedModel = models.find(m => m.id === selectedModelId) ?? models[0] ?? null

  useEffect(() => {
    reconcileProfiles(profiles.map(profile => profile.id))
    if (agentProfileId === null && profiles.length > 0) {
      setLastAgentProfileId(profiles[0].id)
    }
  }, [agentProfileId, profiles, reconcileProfiles, setLastAgentProfileId])

  useEffect(() => {
    setThinkingEffort(null)
  }, [agentProfileId])

  const availableFiles: MentionItem[] = useMemo(
    () => workspaceFiles.map(file => ({ type: file.type, name: file.name, path: file.path })),
    [workspaceFiles],
  )

  // Click outside to collapse
  useEffect(() => {
    if (!expanded) {
      return
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false)
        setMentionActive(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [expanded])

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) {
      return
    }
    if (expanded) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 240)}px`
    }
    else {
      el.style.height = ''
    }
  }, [expanded])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    autoResize()

    // Check for @ trigger
    const cursor = e.target.selectionStart ?? value.length
    const textBefore = value.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')

    if (atIdx >= 0) {
      const afterAt = textBefore.slice(atIdx + 1)
      if (!afterAt.includes('\n')) {
        setMentionActive(true)
        setMentionQuery(afterAt)
        mentionStartRef.current = atIdx
        return
      }
    }
    setMentionActive(false)
    setMentionQuery('')
  }, [autoResize])

  const handleMentionSelect = useCallback((item: MentionItem) => {
    const start = mentionStartRef.current
    if (start < 0) {
      return
    }
    const before = input.slice(0, start)
    const cursor = textareaRef.current?.selectionStart ?? input.length
    const after = input.slice(cursor)
    const suffix = item.type === 'directory' ? '/' : ' '
    const insertText = `@${item.path}${suffix}`
    const newValue = `${before}${insertText}${after}`
    setInput(newValue)

    if (item.type === 'directory') {
      setMentionQuery(`${item.path}/`)
      mentionStartRef.current = start
    }
    else {
      setMentionActive(false)
      setMentionQuery('')
      mentionStartRef.current = -1
    }

    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        const pos = before.length + insertText.length
        el.setSelectionRange(pos, pos)
        autoResize()
      }
    })
  }, [input, autoResize])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || !selectedProfile) {
      return
    }
    setSending(true)
    try {
      await onSend(text, {
        agentId: selectedProfile.id,
        modelId: selectedModel?.id,
        thinkingEffort: thinkingEffort ?? undefined,
      })
      setInput('')
      setExpanded(false)
    }
    finally {
      setSending(false)
    }
  }, [input, onSend, selectedModel, selectedProfile, thinkingEffort])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) {
      return
    }
    if (mentionActive && ['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
    if (e.key === 'Escape') {
      setExpanded(false)
      textareaRef.current?.blur()
    }
  }, [mentionActive, handleSend])

  const canSend = !!input.trim() && !!selectedProfile && !sending

  return (
    <div ref={containerRef} className="relative">
      {/* Mention panel */}
      {expanded && (
        <MentionPanel
          items={availableFiles}
          query={mentionQuery}
          onSelect={handleMentionSelect}
          onClose={() => setMentionActive(false)}
          visible={mentionActive}
        />
      )}

      {/* Composer card — CSS transitions for border-radius + shadow */}
      <div
        className={cn(
          'bg-background/70 backdrop-blur-xl border border-border overflow-hidden',
          'transition-[border-radius,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          expanded
            ? 'rounded-2xl shadow-lg'
            : 'rounded-[22px] shadow-sm',
        )}
      >
        {/* Textarea — CSS transition on padding + height */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onFocus={() => setExpanded(true)}
          onKeyDown={handleKeyDown}
          placeholder="在此工作区开始新对话..."
          disabled={sending}
          rows={1}
          className={cn(
            'block w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none disabled:opacity-50',
            'transition-[padding,min-height,max-height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            expanded
              ? 'px-4 pt-3.5 pb-2 min-h-16 max-h-60'
              : 'px-5 py-3 min-h-11 max-h-11',
          )}
        />

        {/* Action bar — CSS grid trick for smooth height 0→auto */}
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border/20">
              <div className="flex items-center gap-1" />
              <div className="flex items-center gap-1">
                {/* Agent picker */}
                <Menu>
                  <MenuTrigger render={<Button variant="ghost" size="xs" />}>
                    <BotIcon className="size-3" aria-hidden="true" />
                    {selectedProfile?.name ?? 'Agent'}
                    <ChevronDownIcon aria-hidden="true" />
                  </MenuTrigger>
                  <MenuPopup>
                    <MenuGroup>
                      <MenuGroupLabel>Agent Profiles</MenuGroupLabel>
                      <MenuSeparator />
                      {profiles.length === 0
                        ? <MenuItem disabled>没有 Agent Profile</MenuItem>
                            : profiles.map(profile => (
                              <MenuItem key={profile.id} onClick={() => setLastAgentProfileId(profile.id)}>
                            <BotIcon className="size-3" aria-hidden="true" />
                            <span>{profile.name}</span>
                              </MenuItem>
                        ))}
                    </MenuGroup>
                  </MenuPopup>
                </Menu>

                {/* Model picker */}
                {(isLoadingModels || models.length > 0) && (
                  isLoadingModels
                    ? (
                      <Button variant="ghost" size="xs" disabled>
                        <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
                      </Button>
                    )
                    : (
                      <Combobox
                        items={models}
                        value={selectedModel}
                        itemToStringLabel={m => m.label}
                        isItemEqualToValue={(a, b) => a.id === b.id}
                        onValueChange={(next) => {
                          if (next && agentProfileId) {
                            setLastModelForProfile(agentProfileId, next.id)
                          }
                        }}
                      >
                        <ComboboxTrigger
                          render={(
                            <Button variant="ghost" size="xs" className="text-muted-foreground/70 hover:text-foreground" />
                          )}
                        >
                          <CpuIcon className="size-3" aria-hidden="true" />
                          {selectedModel?.label ?? '模型'}
                          <ChevronDownIcon aria-hidden="true" />
                        </ComboboxTrigger>
                        <ComboboxContent aria-label="选择模型" className="min-w-60" side="top">
                          <div className="border-b p-2">
                            <ComboboxInput showTrigger={false} placeholder="搜索模型..." />
                          </div>
                          <ComboboxEmpty>未找到匹配的模型</ComboboxEmpty>
                          <ComboboxList>
                            {(item: { id: string, label: string }) => (
                              <ComboboxItem key={item.id} value={item}>
                                {item.label}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    )
                )}

                {/* Thinking effort */}
                {selectedProfile && selectedProfile.providerKind !== 'cli-tui' && (
                  <Menu>
                    <MenuTrigger render={<Button variant="ghost" size="xs" />}>
                      <BrainIcon className="size-3" aria-hidden="true" />
                      {thinkingEffort
                        ? ({ low: '低', medium: '中', high: '深' } as const)[thinkingEffort]
                        : '思考'}
                      <ChevronDownIcon aria-hidden="true" />
                    </MenuTrigger>
                    <MenuPopup>
                      <MenuGroup>
                        <MenuGroupLabel>思考深度</MenuGroupLabel>
                        <MenuSeparator />
                        <MenuItem onClick={() => setThinkingEffort(null)}>默认</MenuItem>
                        <MenuItem onClick={() => setThinkingEffort('low')}>低思考</MenuItem>
                        <MenuItem onClick={() => setThinkingEffort('medium')}>中等</MenuItem>
                        <MenuItem onClick={() => setThinkingEffort('high')}>深度思考</MenuItem>
                      </MenuGroup>
                    </MenuPopup>
                  </Menu>
                )}

                {/* Send button */}
                <Button
                  variant="default"
                  size="icon-xs"
                  disabled={!canSend}
                  onClick={() => void handleSend()}
                  aria-label="发送"
                >
                  {sending
                    ? <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
                    : <SendHorizonalIcon className="size-3" aria-hidden="true" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
