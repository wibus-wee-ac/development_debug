// Input: workspaceId prop, REST API, useAgents, MarkdownEditor, Avatar
// Output: WorkspaceWorkflowRules — workflow rules editor scoped to a workspace (Tiptap Markdown)
// Position: Tab content within the workspace detail page

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BotIcon, GlobeIcon } from 'lucide-react'
import { startTransition, useEffect, useState } from 'react'

import { getWorkflowRulesByWorkspaceId, putWorkflowRulesByWorkspaceId } from '~/api-gen'
import { MarkdownEditor } from '~/components/editor/markdown-editor'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { cn } from '~/lib/cn'

function useWorkflowRule(workspaceId: string, agentId: string | null) {
  return useQuery({
    queryKey: ['workflow-rules', workspaceId, agentId],
    queryFn: async () => {
      const { data } = await getWorkflowRulesByWorkspaceId({
        path: { workspaceId },
        query: agentId ? { agentProfileId: agentId } : {},
      })
      return data as { global: string | null, profileSpecific: string | null }
    },
    enabled: !!workspaceId,
  })
}

function useSaveWorkflowRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { workspaceId: string, agentId: string | null, content: string }) => {
      await putWorkflowRulesByWorkspaceId({
        path: { workspaceId: params.workspaceId },
        body: { agentProfileId: params.agentId, content: params.content },
      })
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

  const content = data === undefined
    ? null
    : agentId
      ? (data.profileSpecific ?? null)
      : (data.global ?? null)

  const handleSave = (md: string) => {
    saveMutation.mutate({ workspaceId, agentId, content: md })
  }

  return (
    <div
      data-testid="workspace-workflow-rules-editor"
      data-workflow-scope={agentId ?? 'global'}
    >
      <MarkdownEditor
        content={content}
        onSave={handleSave}
        placeholder={placeholder}
      />
    </div>
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
    <div className="space-y-6" data-testid="workspace-workflow-rules-page">
      {/* Scope selector */}
      <div className="flex gap-1.5" data-testid="workspace-workflow-rules-scope-selector">
        <button
          type="button"
          onClick={() => setSelectedAgentId(null)}
          data-testid="workspace-workflow-rules-scope-global"
          data-scope-active={!selectedAgentId ? 'true' : 'false'}
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
            data-testid={`workspace-workflow-rules-scope-agent-${agent.id}`}
            data-scope-active={selectedAgentId === agent.id ? 'true' : 'false'}
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
              key="workflow-rule-global"
              workspaceId={workspaceId}
              agentId={null}
              placeholder="Define what agents should do when assigned a task..."
            />
          )
          : activeScope && (
            <RuleEditor
              key={`workflow-rule-agent-${selectedAgentId}`}
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
