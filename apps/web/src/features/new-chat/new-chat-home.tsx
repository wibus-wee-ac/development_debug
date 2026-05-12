// Input: workspaces, Agent Runtime profiles + models (with ACP auto-connect), Composer, HTTP client, useNavigate
// Output: NewChatHome — empty-state composer with searchable model combobox + thinking picker, starts chat or terminal sessions
// Position: Main content area component for the home page (/ route)

import { useQueryClient } from '@tanstack/react-query'
import {
  BotIcon,
  BrainIcon,
  ChevronDownIcon,
  CpuIcon,
  FolderIcon,
  LoaderCircleIcon,
  PlusIcon,
  TerminalIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { postChatSessionsBySessionIdRuns, postSessions } from '~/api-gen/sdk.gen'
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
import { Composer } from '~/features/chat'
import { sessionsQueryKey } from '~/features/workspace/use-session'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { useWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { useNewChatStore } from '~/store/new-chat'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

import { resolveSelectedWorkspaceId } from './workspace-selection'

const WORD_SPLIT = /\s+/

const THINKING_EFFORT_LABELS: Record<'low' | 'medium' | 'high', string> = {
  low: '低思考',
  medium: '中等',
  high: '深度思考',
}

function profileInitials(name: string): string {
  const parts = name.trim().split(WORD_SPLIT)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

interface NewChatHomeProps {
  preferredWorkspaceId?: string | null
  onWorkspaceChange?: (workspace: { id: string, path: string } | null) => void
}

export function NewChatHome({ preferredWorkspaceId = null, onWorkspaceChange }: NewChatHomeProps) {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [thinkingEffort, setThinkingEffort] = useState<'low' | 'medium' | 'high' | null>(null)
  const [sending, setSending] = useState(false)
  const { workspaces } = useWorkspaces()
  const { profiles } = useAgentProfiles()
  const agentProfileId = useNewChatStore(s => s.lastAgentProfileId)
  const lastModelByProfile = useNewChatStore(s => s.lastModelByProfile)
  const setLastAgentProfileId = useNewChatStore(s => s.setLastAgentProfileId)
  const setLastModelForProfile = useNewChatStore(s => s.setLastModelForProfile)
  const reconcileProfiles = useNewChatStore(s => s.reconcileProfiles)
  const { models, isLoading: isLoadingModels } = useAgentModels(agentProfileId)
  const queryClient = useQueryClient()
  const { openTab } = useCradleNavigation()

  const selectedProfile = profiles.find(profile => profile.id === agentProfileId) ?? null
  const selectedWorkspace = workspaces.find(workspace => workspace.id === workspaceId) ?? null
  const effectiveWorkspaceId = selectedWorkspace?.id ?? null
  const { files: workspaceFiles } = useWorkspaceFiles(effectiveWorkspaceId)
  const selectedModelId = agentProfileId ? lastModelByProfile[agentProfileId] ?? null : null
  const selectedModel = models.find(m => m.id === selectedModelId) ?? models[0] ?? null

  useEffect(() => {
    onWorkspaceChange?.(selectedWorkspace ? { id: selectedWorkspace.id, path: selectedWorkspace.path } : null)
  }, [onWorkspaceChange, selectedWorkspace])

  useEffect(() => {
    setWorkspaceId((currentWorkspaceId) => {
      const nextWorkspaceId = resolveSelectedWorkspaceId(
        preferredWorkspaceId,
        currentWorkspaceId,
        workspaces,
      )

      return nextWorkspaceId === currentWorkspaceId ? currentWorkspaceId : nextWorkspaceId
    })
  }, [preferredWorkspaceId, workspaces])

  useEffect(() => {
    reconcileProfiles(profiles.map(profile => profile.id))
    if (agentProfileId === null && profiles.length > 0) {
      setLastAgentProfileId(profiles[0].id)
    }
  }, [agentProfileId, profiles, reconcileProfiles, setLastAgentProfileId])

  useEffect(() => {
    setThinkingEffort(null)
  }, [agentProfileId])

  const availableFiles = useMemo(
    () => workspaceFiles.map(file => ({ type: file.type, name: file.name, path: file.path })),
    [workspaceFiles],
  )

  const handleSend = useCallback(
    async (text: string) => {
      if (!selectedProfile || !effectiveWorkspaceId) {
        return
      }

      setSending(true)
      try {
        if (selectedProfile.providerKind === 'cli-tui') {
          const { data: sessionData } = await postSessions({
            body: {
              workspaceId: effectiveWorkspaceId,
              title: selectedProfile.name,
              agentProfileId: selectedProfile.id,
            },
          })
          const session = sessionData as { id: string } | null
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey(effectiveWorkspaceId) })
          openTab('chat', { sessionId: session?.id ?? '' })
          return
        }

        const { data: sessionData } = await postSessions({
          body: {
            workspaceId: effectiveWorkspaceId,
            title: text.slice(0, 80) || selectedProfile.name,
            agentProfileId: selectedProfile.id,
          },
        })
        const session = sessionData as { id: string } | null
        if (!session?.id) {
          return
        }
        await postChatSessionsBySessionIdRuns({
          path: { sessionId: session.id },
          body: {
            text,
            modelId: selectedModel?.id ?? undefined,
            thinkingEffort: thinkingEffort ?? undefined,
          },
        })

        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(effectiveWorkspaceId) })
        openTab('chat', { sessionId: session.id })
      }
      catch (err) {
        console.error('[NewChatHome] start session failed:', err)
        setSending(false)
      }
    },
    [effectiveWorkspaceId, openTab, queryClient, selectedModel, selectedProfile, thinkingEffort],
  )

  const composerToolbar = useMemo(
    () => (
      <Button variant="ghost" size="icon-xs" aria-label="添加文件">
        <PlusIcon aria-hidden="true" />
      </Button>
    ),
    [],
  )

  const composerContextBar = useMemo(
    () => (
      <>
        {/* Agent profile picker */}
        <Menu>
          <MenuTrigger render={<Button variant="ghost" size="xs" />}>
            {selectedProfile?.providerKind === 'cli-tui'
              ? <TerminalIcon className="size-3" aria-hidden="true" />
              : selectedProfile
                ? (
                  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[9px] font-semibold text-primary leading-none">
                    {profileInitials(selectedProfile.name)}
                  </span>
                )
                : <BotIcon className="size-3" aria-hidden="true" />}
            {selectedProfile?.name ?? '选择 Agent'}
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
                    {profile.providerKind === 'cli-tui'
                      ? <TerminalIcon className="size-3" aria-hidden="true" />
                      : <BotIcon className="size-3" aria-hidden="true" />}
                    <span>{profile.name}</span>
                      </MenuItem>
                ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>

        {/* Model picker — shown when loading or models are available */}
        {(isLoadingModels || models.length > 0) && (
          isLoadingModels
            ? (
              <Button variant="ghost" size="xs" disabled>
                <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
                加载模型...
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
                  {selectedModel?.label ?? '默认模型'}
                  <ChevronDownIcon aria-hidden="true" />
                </ComboboxTrigger>
                <ComboboxContent aria-label="选择模型" className="min-w-60" side="left">
                  <div className="border-b p-2">
                    <ComboboxInput
                      showTrigger={false}
                      placeholder="搜索模型..."
                    />
                  </div>
                  <ComboboxEmpty>未找到匹配的模型</ComboboxEmpty>
                  <ComboboxList>
                    {(item: import('~/lib/types').ModelDescriptor) => (
                      <ComboboxItem key={item.id} value={item}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            )
        )}

        {/* Thinking effort — only for non-CLI providers */}
        {selectedProfile && selectedProfile.providerKind !== 'cli-tui' && (
          <Menu>
            <MenuTrigger render={<Button variant="ghost" size="xs" />}>
              <BrainIcon className="size-3" aria-hidden="true" />
              {thinkingEffort ? THINKING_EFFORT_LABELS[thinkingEffort] : '思考深度'}
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

        {/* Workspace picker */}
        <Menu>
          <MenuTrigger render={<Button variant="ghost" size="xs" />}>
            <FolderIcon className="size-3" aria-hidden="true" />
            {selectedWorkspace?.name ?? '选择 Workspace'}
            <ChevronDownIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup>
            <MenuGroup>
              <MenuGroupLabel>Workspaces</MenuGroupLabel>
              <MenuSeparator />
              {workspaces.map(workspace => (
                <MenuItem key={workspace.id} onClick={() => setWorkspaceId(workspace.id)}>
                  <FolderIcon className="size-3" aria-hidden="true" />
                  <span>{workspace.name}</span>
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </>
    ),
    [agentProfileId, isLoadingModels, models, profiles, selectedModel, selectedProfile, selectedWorkspace, setLastAgentProfileId, setLastModelForProfile, thinkingEffort, workspaces],
  )

  return (
    <main className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-3xl flex-col gap-5">
        <div className="text-center">
          <h1 className="font-heading text-3xl font-semibold">Cradle</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            选择 workspace 和 Agent Profile 后开始运行。
          </p>
        </div>

        <Composer
          onSend={handleSend}
          disabled={sending || !selectedProfile || !effectiveWorkspaceId}
          isStreaming={sending}
          placeholder={selectedProfile ? '输入任务...' : '先在设置中添加 Agent Profile'}
          availableFiles={availableFiles}
          toolbar={composerToolbar}
          contextBar={composerContextBar}
        />

        {sending && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
            正在启动...
          </div>
        )}
      </div>
    </main>
  )
}
