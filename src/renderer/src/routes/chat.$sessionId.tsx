// Input: ChatView from chat feature, ChatSessionManager, AppLayout, TanStack Router
// Output: Chat session route — thin page that reads session from manager and renders ChatView
// Position: Route page for /chat/$sessionId, protocol-driven (no session creation here)

import { AppLayout } from '@renderer/components/layout/app-layout'
import { Button } from '@renderer/components/ui/button'
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '@renderer/components/ui/menu'
import { ChatView } from '@renderer/features/chat'
import { useChatSessionManager } from '@renderer/features/chat/chat-session-manager'
import { useInstalledAcpAgents } from '@renderer/features/workspace/use-acp-agents'
import { useAcpSessionState } from '@renderer/features/workspace/use-acp-session-state'
import { sessionsQueryKey } from '@renderer/features/workspace/use-session'
import { useWorkspaceFiles } from '@renderer/features/workspace/use-workspace-files'
import { ipc } from '@renderer/lib/ipc'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  ChevronDownIcon,
  LoaderCircleIcon,
  PlusIcon,
} from 'lucide-react'
import { useEffect, useMemo } from 'react'

const WORD_SPLIT = /\s+/

function agentInitials(name: string): string {
  const parts = name.trim().split(WORD_SPLIT)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

interface FlatConfigOpt {
  value: string
  name: string
}

function flatConfigOptions(opts: unknown): FlatConfigOpt[] {
  if (!Array.isArray(opts)) {
    return []
  }
  return opts.filter(
    (o): o is FlatConfigOpt =>
      typeof o === 'object' && o !== null && 'value' in o && 'name' in o,
  )
}

export const Route = createFileRoute('/chat/$sessionId')({
  component: ChatSessionPage,
})

function ChatSessionPage() {
  const { sessionId } = Route.useParams()
  const queryClient = useQueryClient()

  // Read session metadata from the protocol-driven manager
  const { sessions, loadSession } = useChatSessionManager()
  const session = sessions[sessionId]

  // Ensure session is loaded (from DB if needed)
  useEffect(() => {
    loadSession(sessionId)
  }, [sessionId, loadSession])

  const agentId = session?.agentId ?? null
  const workspaceId = session?.workspaceId ?? null
  // ACP transport session ID — separate from the stable chat session ID
  const acpSessionId = session?.acpSessionId ?? null

  const { agents } = useInstalledAcpAgents()
  const { files: workspaceFiles } = useWorkspaceFiles(workspaceId)

  const availableFiles = useMemo(
    () => workspaceFiles.map(f => ({ type: f.type, name: f.name, path: f.path })),
    [workspaceFiles],
  )

  const selectedAgent = agents.find(a => a.id === agentId) ?? null

  // Model + config pickers — keyed against acpSessionId (null = no live ACP session)
  const { models, configOptions, setModel, setConfigOption } = useAcpSessionState(
    agentId,
    acpSessionId,
  )

  const thoughtLevelOption = configOptions.find(o => o.category === 'thought_level')
  const thoughtLevelOpts = flatConfigOptions(
    thoughtLevelOption?.type === 'select' ? thoughtLevelOption.options : null,
  )

  // Listen for ACP session title updates (events carry the ACP session ID)
  useEffect(() => {
    if (!acpSessionId) {
      return
    }
    const handler = (_event: unknown, data: { sessionId: string, title: string }) => {
      if (data.sessionId === acpSessionId && workspaceId) {
        ipc?.session.updateTitle({ id: sessionId, title: data.title })
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
      }
    }

    window.electron.ipcRenderer.on('acp:session-title', handler)
    return () => {
      window.electron.ipcRenderer.removeListener('acp:session-title', handler)
    }
  }, [sessionId, acpSessionId, workspaceId, queryClient])

  const composerToolbar = useMemo(() => (
    <Button variant="ghost" size="icon-xs" aria-label="添加文件">
      <PlusIcon aria-hidden="true" />
    </Button>
  ), [])

  const composerContextBar = useMemo(() => (
    <>
      {/* Agent badge (read-only) */}
      {selectedAgent && (
        <Button variant="ghost" size="xs" disabled className="pointer-events-none">
          <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[9px] font-semibold text-primary leading-none">
            {agentInitials(selectedAgent.name)}
          </span>
          {selectedAgent.name}
        </Button>
      )}

      {/* Model picker — live when active ACP session, else read-only snapshot */}
      {models && models.availableModels.length > 0
        ? (
          <Menu>
            <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/70 hover:text-foreground" />}>
              {models.currentModelId}
              <ChevronDownIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup>
              {models.availableModels.map(m => (
                <MenuItem key={m.modelId} onClick={() => setModel(m.modelId)}>
                  {m.name}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        )
        : session?.modelId
          ? (
            <Button variant="ghost" size="xs" disabled className="pointer-events-none text-muted-foreground/60">
              {session.modelId}
            </Button>
          )
          : null}

      {/* Thinking effort — only available with active ACP session */}
      {thoughtLevelOpts.length > 0 && thoughtLevelOption && (
        <Menu>
          <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/70 hover:text-foreground" />}>
            {thoughtLevelOption.type === 'select' ? thoughtLevelOption.currentValue : thoughtLevelOption.name}
            <ChevronDownIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup>
            <MenuGroup>
              <MenuGroupLabel>{thoughtLevelOption.name}</MenuGroupLabel>
              <MenuSeparator />
              {thoughtLevelOpts.map(opt => (
                <MenuItem
                  key={opt.value}
                  onClick={() => setConfigOption({ configId: thoughtLevelOption.id, value: opt.value })}
                >
                  {opt.name}
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      )}
    </>
  ), [selectedAgent, session?.modelId, models, thoughtLevelOpts, thoughtLevelOption, setModel, setConfigOption])

  if (!session) {
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center">
          <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground/50" />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <ChatView
        sessionId={sessionId}
        availableFiles={availableFiles}
        composerToolbar={composerToolbar}
        composerContextBar={composerContextBar}
      />
    </AppLayout>
  )
}
