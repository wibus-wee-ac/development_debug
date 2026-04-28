// Input: workspaceId prop, ipc, useAgents, MarkdownEditor, Avatar
// Output: WorkspaceWorkflowRules — workflow rules editor scoped to a workspace (Tiptap Markdown)
// Position: Tab content within the workspace detail page

import { MarkdownEditor } from '@renderer/components/editor/markdown-editor'
import { useAgents } from '@renderer/features/agent-runtime/use-agents'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BotIcon, GlobeIcon } from 'lucide-react'
import { startTransition, useEffect, useState } from 'react'

function useWorkflowRule(workspaceId: string, agentId: string | null) {
  return useQuery({
    queryKey: ['workflow-rules', workspaceId, agentId],
    queryFn: () => ipc!.workflowRules.get(workspaceId, agentId ?? undefined),
    enabled: !!workspaceId,
  })
}

function useSaveWorkflowRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { workspaceId: string, agentId: string | null, content: string }) => {
      await ipc!.workflowRules.save(params.workspaceId, params.agentId, params.content)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-rules'] })
    },
  })
}

function RuleEditor({
  workspaceId,
  agentId,
  placeholder,
}: {
  workspaceId: string
  agentId: string | null
  placeholder: string
}) {
  const { data } = useWorkflowRule(workspaceId, agentId)
  const saveMutation = useSaveWorkflowRule()

  const content = agentId ? (data?.profileSpecific ?? null) : (data?.global ?? null)

  const handleSave = (md: string) => {
    saveMutation.mutate({ workspaceId, agentId, content: md })
  }

  return (
    <MarkdownEditor
      content={content ?? ''}
      onSave={handleSave}
      placeholder={placeholder}
    />
  )
}

export function WorkspaceWorkflowRules({
  workspaceId,
  onContentChange,
}: {
  workspaceId: string
  onContentChange?: (content: string | null) => void
}) {
  const { agents } = useAgents()
  const enabledAgents = agents.filter(a => a.enabled)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  // Report active content to parent for TOC — deferred to avoid blocking tab switch
  const { data: activeRuleData } = useWorkflowRule(workspaceId, selectedAgentId)
  const activeContent = selectedAgentId
    ? (activeRuleData?.profileSpecific ?? null)
    : (activeRuleData?.global ?? null)

  useEffect(() => {
    startTransition(() => {
      onContentChange?.(activeContent)
    })
  }, [activeContent, onContentChange])

  const activeScope = selectedAgentId
    ? enabledAgents.find(a => a.id === selectedAgentId)
    : null

  return (
    <div className="space-y-6">
      {/* Scope selector */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setSelectedAgentId(null)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
            !selectedAgentId
              ? 'bg-accent text-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <GlobeIcon className="size-3" />
          All Agents
        </button>
        {enabledAgents.map(agent => (
          <button
            key={agent.id}
            type="button"
            onClick={() => setSelectedAgentId(agent.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
              selectedAgentId === agent.id
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {agent.avatarUrl
              ? (
                <img
                  src={agent.avatarUrl}
                  alt=""
                  className="size-3.5 rounded"
                  crossOrigin="anonymous"
                />
              )
              : <BotIcon className="size-3" />}
            {agent.name}
          </button>
        ))}
      </div>

      {/* Editor area */}
      <div>
        {!selectedAgentId
          ? (
            <RuleEditor
              workspaceId={workspaceId}
              agentId={null}
              placeholder="Define what agents should do when assigned a task..."
            />
          )
          : activeScope && (
            <RuleEditor
              workspaceId={workspaceId}
              agentId={selectedAgentId}
              placeholder={`Instructions specific to ${activeScope.name}...`}
            />
          )}
      </div>

      {/* Info note */}
      {enabledAgents.length === 0 && (
        <div className="py-8 text-center text-[11px] text-muted-foreground/40">
          No agents configured yet
        </div>
      )}
    </div>
  )
}
