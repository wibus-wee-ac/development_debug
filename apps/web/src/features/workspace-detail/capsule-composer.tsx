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
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'

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

interface CapsuleComposerState {
  expanded: boolean
  input: string
  sending: boolean
  mentionActive: boolean
  mentionQuery: string
  thinkingEffortProfileId: string | null
  thinkingEffort: 'low' | 'medium' | 'high' | null
}

type CapsuleComposerAction =
  | { type: 'expand' }
  | { type: 'collapse' }
  | { type: 'set-input', input: string }
  | { type: 'set-sending', sending: boolean }
  | { type: 'set-mention', query: string }
  | { type: 'clear-mention' }
  | { type: 'set-thinking-effort', profileId: string | null, thinkingEffort: 'low' | 'medium' | 'high' | null }
  | { type: 'send/success' }

const INITIAL_CAPSULE_COMPOSER_STATE: CapsuleComposerState = {
  expanded: false,
  input: '',
  sending: false,
  mentionActive: false,
  mentionQuery: '',
  thinkingEffortProfileId: null,
  thinkingEffort: null,
}

function capsuleComposerReducer(state: CapsuleComposerState, action: CapsuleComposerAction): CapsuleComposerState {
  switch (action.type) {
    case 'expand':
      return state.expanded ? state : { ...state, expanded: true }
    case 'collapse':
      return { ...state, expanded: false, mentionActive: false, mentionQuery: '' }
    case 'set-input':
      return { ...state, input: action.input }
    case 'set-sending':
      return { ...state, sending: action.sending }
    case 'set-mention':
      return { ...state, mentionActive: true, mentionQuery: action.query }
    case 'clear-mention':
      return { ...state, mentionActive: false, mentionQuery: '' }
    case 'set-thinking-effort':
      return {
        ...state,
        thinkingEffortProfileId: action.profileId,
        thinkingEffort: action.thinkingEffort,
      }
    case 'send/success':
      return {
        ...state,
        expanded: false,
        input: '',
        mentionActive: false,
        mentionQuery: '',
      }
    default:
      return state
  }
}

function useCapsuleComposerOwner({ workspaceId, onSend }: CapsuleComposerProps) {
  const [state, dispatch] = useReducer(capsuleComposerReducer, INITIAL_CAPSULE_COMPOSER_STATE)
  const mentionStartRef = useRef<number>(-1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const persistedProfileId = useNewChatStore(s => s.lastAgentProfileId)
  const lastModelByProfile = useNewChatStore(s => s.lastModelByProfile)
  const setLastAgentProfileId = useNewChatStore(s => s.setLastAgentProfileId)
  const setLastModelForProfile = useNewChatStore(s => s.setLastModelForProfile)

  const { profiles } = useAgentProfiles()
  const effectiveProfileId = useMemo(() => {
    if (persistedProfileId && profiles.some(profile => profile.id === persistedProfileId)) {
      return persistedProfileId
    }
    return profiles[0]?.id ?? null
  }, [persistedProfileId, profiles])

  const { models, isLoading: isLoadingModels } = useAgentModels(effectiveProfileId)
  const { files: workspaceFiles } = useWorkspaceFiles(workspaceId)

  const selectedProfile = profiles.find(p => p.id === effectiveProfileId) ?? null
  const selectedModelId = effectiveProfileId ? lastModelByProfile[effectiveProfileId] ?? null : null
  const selectedModel = models.find(m => m.id === selectedModelId) ?? models[0] ?? null
  const thinkingEffort = state.thinkingEffortProfileId === effectiveProfileId ? state.thinkingEffort : null

  const availableFiles: MentionItem[] = useMemo(
    () => workspaceFiles.map(file => ({ type: file.type, name: file.name, path: file.path })),
    [workspaceFiles],
  )

  useEffect(() => {
    if (!state.expanded) {
      return
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        dispatch({ type: 'collapse' })
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [state.expanded])

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) {
      return
    }
    if (state.expanded) {
      el.style.height = '0'
      const height = Math.min(el.scrollHeight, 240)
      el.style.height = `${height}px`
    }
    else {
      el.style.height = ''
    }
  }, [state.expanded])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    dispatch({ type: 'set-input', input: value })
    autoResize()
    const cursor = e.target.selectionStart ?? value.length
    const textBefore = value.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')

    if (atIdx >= 0) {
      const afterAt = textBefore.slice(atIdx + 1)
      if (!afterAt.includes('\n')) {
        dispatch({ type: 'set-mention', query: afterAt })
        mentionStartRef.current = atIdx
        return
      }
    }
    dispatch({ type: 'clear-mention' })
  }, [autoResize])

  const handleMentionSelect = useCallback((item: MentionItem) => {
    const start = mentionStartRef.current
    if (start < 0) {
      return
    }
    const before = state.input.slice(0, start)
    const cursor = textareaRef.current?.selectionStart ?? state.input.length
    const after = state.input.slice(cursor)
    const suffix = item.type === 'directory' ? '/' : ' '
    const insertText = `@${item.path}${suffix}`
    const newValue = `${before}${insertText}${after}`
    dispatch({ type: 'set-input', input: newValue })

    if (item.type === 'directory') {
      dispatch({ type: 'set-mention', query: `${item.path}/` })
      mentionStartRef.current = start
    }
    else {
      dispatch({ type: 'clear-mention' })
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
  }, [autoResize, state.input])

  const handleSend = useCallback(async () => {
    const text = state.input.trim()
    if (!text || !selectedProfile) {
      return
    }
    dispatch({ type: 'set-sending', sending: true })
    try {
      await onSend(text, {
        agentId: selectedProfile.id,
        modelId: selectedModel?.id,
        thinkingEffort: thinkingEffort ?? undefined,
      })
      dispatch({ type: 'send/success' })
    }
    finally {
      dispatch({ type: 'set-sending', sending: false })
    }
  }, [onSend, selectedModel, selectedProfile, state.input, thinkingEffort])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) {
      return
    }
    if (state.mentionActive && ['Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
    if (e.key === 'Escape') {
      dispatch({ type: 'collapse' })
      textareaRef.current?.blur()
    }
  }, [handleSend, state.mentionActive])

  const selectProfile = useCallback((profileId: string) => {
    setLastAgentProfileId(profileId)
  }, [setLastAgentProfileId])

  const selectModel = useCallback((next: { id: string } | null) => {
    if (next && effectiveProfileId) {
      setLastModelForProfile(effectiveProfileId, next.id)
    }
  }, [effectiveProfileId, setLastModelForProfile])

  const selectThinkingEffort = useCallback((nextThinkingEffort: 'low' | 'medium' | 'high' | null) => {
    dispatch({
      type: 'set-thinking-effort',
      profileId: effectiveProfileId,
      thinkingEffort: nextThinkingEffort,
    })
  }, [effectiveProfileId])

  const expand = useCallback(() => {
    dispatch({ type: 'expand' })
    requestAnimationFrame(() => {
      autoResize()
    })
  }, [autoResize])

  const collapse = useCallback(() => {
    dispatch({ type: 'collapse' })
  }, [])

  const closeMention = useCallback(() => {
    dispatch({ type: 'clear-mention' })
  }, [])

  const canSend = !!state.input.trim() && !!selectedProfile && !state.sending

  return {
    availableFiles,
    canSend,
    closeMention,
    collapse,
    containerRef,
    expand,
    handleInput,
    handleKeyDown,
    handleMentionSelect,
    handleSend,
    isLoadingModels,
    models,
    profiles,
    selectModel,
    selectProfile,
    selectedModel,
    selectedProfile,
    selectThinkingEffort,
    state,
    textareaRef,
    thinkingEffort,
  }
}

function CapsuleComposerToolbar({ owner }: { owner: ReturnType<typeof useCapsuleComposerOwner> }) {
  const { canSend, handleSend, isLoadingModels, models, profiles, selectModel, selectProfile, selectedModel, selectedProfile, selectThinkingEffort, state, thinkingEffort } = owner

  return (
    <div className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-t border-border/20 px-3 py-2">
        <div className="flex items-center gap-1" />
        <div className="flex items-center gap-1">
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
                      <MenuItem key={profile.id} onClick={() => selectProfile(profile.id)}>
                        <BotIcon className="size-3" aria-hidden="true" />
                        <span className="flex-1">{profile.name}</span>
                      </MenuItem>
                    ))}
              </MenuGroup>
            </MenuPopup>
          </Menu>

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
                  itemToStringLabel={model => model.label}
                  isItemEqualToValue={(a, b) => a.id === b.id}
                  onValueChange={selectModel}
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
                  <MenuItem onClick={() => selectThinkingEffort(null)}>默认</MenuItem>
                  <MenuItem onClick={() => selectThinkingEffort('low')}>低思考</MenuItem>
                  <MenuItem onClick={() => selectThinkingEffort('medium')}>中等</MenuItem>
                  <MenuItem onClick={() => selectThinkingEffort('high')}>深度思考</MenuItem>
                </MenuGroup>
              </MenuPopup>
            </Menu>
          )}

          <Button
            variant="default"
            size="icon-xs"
            disabled={!canSend}
            onClick={() => void handleSend()}
            aria-label="发送"
          >
            {state.sending
              ? <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
              : <SendHorizonalIcon className="size-3" aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function CapsuleComposer({ workspaceId, onSend }: CapsuleComposerProps) {
  const owner = useCapsuleComposerOwner({ workspaceId, onSend })

  return (
    <div ref={owner.containerRef} className="relative">
      {owner.state.expanded && (
        <MentionPanel
          items={owner.availableFiles}
          query={owner.state.mentionQuery}
          onSelect={owner.handleMentionSelect}
          onClose={owner.closeMention}
          visible={owner.state.mentionActive}
        />
      )}

      <div
        className={cn(
          'bg-background/70 backdrop-blur-xl border border-border overflow-hidden',
          'transition-[border-radius,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          owner.state.expanded
            ? 'rounded-2xl shadow-lg'
            : 'rounded-[22px] shadow-sm',
        )}
      >
        <textarea
          ref={owner.textareaRef}
          value={owner.state.input}
          onChange={owner.handleInput}
          onFocus={owner.expand}
          onKeyDown={owner.handleKeyDown}
          placeholder="在此工作区开始新对话..."
          disabled={owner.state.sending}
          rows={1}
          className={cn(
            'block w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none disabled:opacity-50',
            'transition-[padding,min-height,max-height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            owner.state.expanded
              ? 'px-4 pt-3.5 pb-2 min-h-16 max-h-60'
              : 'px-5 py-3 min-h-11 max-h-11',
          )}
        />

        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            owner.state.expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <CapsuleComposerToolbar owner={owner} />
        </div>
      </div>
    </div>
  )
}
