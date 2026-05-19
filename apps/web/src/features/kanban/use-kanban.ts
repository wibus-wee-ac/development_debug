// Input: Generated API SDK, TanStack Query
// Output: Query hooks and mutations for Kanban boards, statuses, milestones, issues, comments, and relations
// Position: Data layer for the Kanban feature; all HTTP calls go through these hooks

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteIssueAgentSessionsByAgentSessionId,
  deleteKanbanBoardsById,
  deleteKanbanCommentsById,
  deleteKanbanIssuesById,
  deleteKanbanIssuesByIdContextRefsByIndex,
  deleteKanbanIssuesByIdDelegation,
  deleteKanbanMilestonesById,
  deleteKanbanRelationsById,
  deleteKanbanStatusesById,
  deleteSessionsByIdLinkedIssue,
  getIssueAgentSessionsByAgentSessionIdActivities,
  getKanbanBoards,
  getKanbanIssues,
  getKanbanIssuesById,
  getKanbanIssuesByIdAgentSessions,
  getKanbanIssuesByIdComments,
  getKanbanIssuesByIdRelations,
  getKanbanIssuesSearch,
  getKanbanMilestones,
  getKanbanStatuses,
  getSessionsByIdLinkedIssue,
  patchKanbanBoardsById,
  patchKanbanIssuesById,
  patchKanbanMilestonesById,
  patchKanbanStatusesById,
  postIssueAgentSessionsByAgentSessionIdRerun,
  postKanbanBoards,
  postKanbanIssues,
  postKanbanIssuesByIdComments,
  postKanbanIssuesByIdContextRefs,
  postKanbanIssuesByIdDelegation,
  postKanbanMilestones,
  postKanbanRelations,
  postKanbanStatuses,
  postKanbanStatusesReorder,
  postSessionsByIdLinkedIssue,
} from '~/api-gen/sdk.gen'
import type {
  GetKanbanIssuesByIdResponse,
  GetKanbanIssuesResponse,
  GetKanbanIssuesSearchResponse,
  PatchKanbanIssuesByIdResponse,
  PostKanbanIssuesResponse,
} from '~/api-gen/types.gen'
import type { AgentActivity, AgentSession, KanbanBoard, KanbanIssue, KanbanIssueComment, KanbanIssueRelation, KanbanMilestone, KanbanStatus } from '~/lib/types'

import { sessionsQueryKey } from '../workspace/use-session'

// ── Query keys ────────────────────────────────────────────────────────────────

export const kanbanKeys = {
  boards: (workspaceId?: string) => ['kanban', 'boards', workspaceId] as const,
  statuses: (workspaceId: string) => ['kanban', 'statuses', workspaceId] as const,
  milestones: (workspaceId: string) => ['kanban', 'milestones', workspaceId] as const,
  issues: (params: Record<string, unknown>) => ['kanban', 'issues', params] as const,
  searchIssues: (query: string, limit: number) => ['kanban', 'searchIssues', query, limit] as const,
  issue: (id: string) => ['kanban', 'issue', id] as const,
  comments: (issueId: string) => ['kanban', 'comments', issueId] as const,
  relations: (issueId: string) => ['kanban', 'relations', issueId] as const,
  agentSessions: (issueId: string) => ['kanban', 'agentSessions', issueId] as const,
  agentActivities: (sessionId: string) => ['kanban', 'agentActivities', sessionId] as const,
}

// ── Input types ───────────────────────────────────────────────────────────────

type CreateBoardInput = { workspaceId: string, name: string, filterConfig?: string | null }
type UpdateBoardInput = { id: string, patch: { name?: string, filterConfig?: string | null } }

type CreateStatusInput = { workspaceId: string, name: string, color?: string | null }
type UpdateStatusInput = { id: string, workspaceId: string, patch: { name?: string, color?: string | null } }
type ReorderStatusesInput = { workspaceId: string, orderedIds: string[] }
type DeleteStatusInput = { id: string, workspaceId: string }

type CreateMilestoneInput = { workspaceId: string, title: string, description?: string | null, dueDate?: number | null }
type UpdateMilestoneInput = {
  id: string
  workspaceId: string
  patch: { title?: string, description?: string | null, dueDate?: number | null, status?: 'open' | 'closed' }
}
type DeleteMilestoneInput = { id: string, workspaceId: string }

export type IssuePriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'

export type IssueFilterParams = {
  workspaceId: string
  milestoneId?: string | null
  parentIssueId?: string | null
  priority?: string | null
  labels?: string[] | null
  statusId?: string | null
}

type CreateIssueInput = {
  workspaceId: string
  title: string
  description?: string | null
  priority?: IssuePriority
  labels?: string[]
  milestoneId?: string | null
  parentIssueId?: string | null
  statusId?: string | null
}

type UpdateIssueInput = {
  id: string
  patch: Partial<{
    title: string
    description: string | null
    priority: IssuePriority
    labels: string[]
    milestoneId: string | null
    parentIssueId: string | null
    statusId: string | null
    assigneeKind: string | null
    assigneeId: string | null
  }>
}

type MoveIssueInput = { id: string, statusId: string | null }
type AddCommentInput = { issueId: string, content: string }
type DeleteCommentInput = { id: string, issueId: string }
type AddRelationInput = { sourceIssueId: string, targetIssueId: string, type: 'blocks' | 'duplicates' | 'relates_to' }
type DeleteRelationInput = { id: string, issueId: string }

type ApiKanbanIssue
  = | GetKanbanIssuesResponse[number]
    | GetKanbanIssuesSearchResponse[number]
    | GetKanbanIssuesByIdResponse
    | PostKanbanIssuesResponse
    | PatchKanbanIssuesByIdResponse

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toKanbanIssue(row: ApiKanbanIssue): KanbanIssue {
  return {
    ...row,
    number: (row as { number?: number }).number ?? 0,
    statusId: nullableString(row.statusId),
    milestoneId: nullableString(row.milestoneId),
    parentIssueId: nullableString(row.parentIssueId),
    description: nullableString(row.description),
    assigneeKind: nullableString(row.assigneeKind),
    assigneeId: nullableString(row.assigneeId),
    createdByKind: ((row as { createdByKind?: 'user' | 'agent' | 'system' }).createdByKind ?? 'user'),
    createdById: ((row as { createdById?: string }).createdById ?? '__self__'),
    delegateAgentId: nullableString((row as { delegateAgentId?: unknown }).delegateAgentId),
    delegateAgentProfileId: nullableString(row.delegateAgentProfileId),
  }
}

function readKanbanIssue(row: ApiKanbanIssue | undefined, action: string): KanbanIssue {
  if (!row) {
    throw new Error(`Failed to ${action} issue`)
  }
  return toKanbanIssue(row)
}

// ── Boards ────────────────────────────────────────────────────────────────────

export function useBoards(workspaceId?: string) {
  return useQuery({
    queryKey: kanbanKeys.boards(workspaceId),
    queryFn: async () => {
      const { data } = await getKanbanBoards({ query: { workspaceId } })
      return (data ?? []) as KanbanBoard[]
    },
  })
}

export function useAllBoards() {
  return useBoards()
}

export function useBoard(boardId: string) {
  const all = useBoards()
  return {
    ...all,
    data: all.data?.find(b => b.id === boardId),
  }
}

export function useCreateBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateBoardInput) => {
      const { data, error } = await postKanbanBoards({ body: input })
      if (error || !data) {
        throw new Error('Failed to create board')
      }
      return data as KanbanBoard
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'boards'] }),
  })
}

export function useUpdateBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: UpdateBoardInput) => {
      const { data } = await patchKanbanBoardsById({ path: { id: vars.id }, body: vars.patch })
      return data as KanbanBoard
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'boards'] }),
  })
}

export function useDeleteBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteKanbanBoardsById({ path: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'boards'] }),
  })
}

// ── Statuses ──────────────────────────────────────────────────────────────────

export function useStatuses(workspaceId: string) {
  return useQuery({
    queryKey: kanbanKeys.statuses(workspaceId),
    queryFn: async () => {
      const { data } = await getKanbanStatuses({ query: { workspaceId } })
      return (data ?? []) as KanbanStatus[]
    },
    enabled: !!workspaceId,
  })
}

export function useCreateStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateStatusInput) => {
      const { data } = await postKanbanStatuses({ body: input })
      return data as KanbanStatus
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.statuses(vars.workspaceId) }),
  })
}

export function useUpdateStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: UpdateStatusInput) => {
      const { data } = await patchKanbanStatusesById({ path: { id: vars.id }, body: vars.patch })
      return data as KanbanStatus
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.statuses(vars.workspaceId) }),
  })
}

export function useReorderStatuses() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: ReorderStatusesInput) => {
      await postKanbanStatusesReorder({ body: vars })
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.statuses(vars.workspaceId) }),
  })
}

export function useDeleteStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: DeleteStatusInput) => {
      await deleteKanbanStatusesById({ path: { id: vars.id } })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.statuses(vars.workspaceId) })
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
    },
  })
}

// ── Milestones ────────────────────────────────────────────────────────────────

export function useMilestones(workspaceId: string) {
  return useQuery({
    queryKey: kanbanKeys.milestones(workspaceId),
    queryFn: async () => {
      const { data } = await getKanbanMilestones({ query: { workspaceId } })
      return (data ?? []) as KanbanMilestone[]
    },
    enabled: !!workspaceId,
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useCreateMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateMilestoneInput) => {
      const { data } = await postKanbanMilestones({ body: input })
      return data as KanbanMilestone
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.milestones(vars.workspaceId) }),
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useUpdateMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: UpdateMilestoneInput) => {
      const { data } = await patchKanbanMilestonesById({ path: { id: vars.id }, body: vars.patch })
      return data as KanbanMilestone
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.milestones(vars.workspaceId) }),
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useDeleteMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: DeleteMilestoneInput) => {
      await deleteKanbanMilestonesById({ path: { id: vars.id } })
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.milestones(vars.workspaceId) }),
  })
}

// ── Issues ────────────────────────────────────────────────────────────────────

export function useIssues(params: IssueFilterParams) {
  return useQuery({
    queryKey: kanbanKeys.issues(params),
    queryFn: async () => {
      const { data } = await getKanbanIssues({
        query: {
          workspaceId: params.workspaceId,
          milestoneId: params.milestoneId ?? undefined,
          parentIssueId: params.parentIssueId ?? undefined,
          priority: params.priority ?? undefined,
          statusId: params.statusId ?? undefined,
          labels: params.labels?.length ? params.labels.join(',') : undefined,
        },
      })
      return (data ?? []).map(toKanbanIssue)
    },
    enabled: !!params.workspaceId,
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useSearchIssues(query: string, limit = 20, enabled = true) {
  const trimmed = query.trim()

  return useQuery({
    queryKey: kanbanKeys.searchIssues(trimmed, limit),
    queryFn: async () => {
      const { data } = await getKanbanIssuesSearch({
        query: { q: trimmed, limit: String(limit) },
      })
      return (data ?? []).map(toKanbanIssue)
    },
    enabled: enabled && trimmed.length > 0,
    staleTime: 5_000,
  })
}

export function useIssue(id: string) {
  return useQuery({
    queryKey: kanbanKeys.issue(id),
    queryFn: async () => {
      const { data } = await getKanbanIssuesById({ path: { id } })
      return data ? toKanbanIssue(data) : undefined
    },
    enabled: !!id,
  })
}

export function useCreateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateIssueInput) => {
      const { data, error } = await postKanbanIssues({ body: input })
      if (error || !data) {
        throw new Error('Failed to create issue')
      }
      return readKanbanIssue(data, 'create')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'issues'] }),
  })
}

export function useUpdateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: UpdateIssueInput) => {
      const { data } = await patchKanbanIssuesById({ path: { id: vars.id }, body: vars.patch })
      return readKanbanIssue(data, 'update')
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.id) })
    },
  })
}

export function useMoveIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: MoveIssueInput) => {
      const { data } = await patchKanbanIssuesById({ path: { id: vars.id }, body: { statusId: vars.statusId } })
      return readKanbanIssue(data, 'move')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'issues'] }),
  })
}

export function useDeleteIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteKanbanIssuesById({ path: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'issues'] }),
  })
}

// ── Comments ──────────────────────────────────────────────────────────────────

export function useComments(issueId: string) {
  return useQuery({
    queryKey: kanbanKeys.comments(issueId),
    queryFn: async () => {
      const { data } = await getKanbanIssuesByIdComments({ path: { id: issueId } })
      return (data ?? []) as KanbanIssueComment[]
    },
    enabled: !!issueId,
  })
}

export function useAddComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddCommentInput) => {
      const { data } = await postKanbanIssuesByIdComments({
        path: { id: input.issueId },
        body: { content: input.content },
      })
      return data as KanbanIssueComment
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) }),
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useDeleteComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: DeleteCommentInput) => deleteKanbanCommentsById({ path: { id: vars.id } }),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) }),
  })
}

// ── Relations ─────────────────────────────────────────────────────────────────

export function useRelations(issueId: string) {
  return useQuery({
    queryKey: kanbanKeys.relations(issueId),
    queryFn: async () => {
      const { data } = await getKanbanIssuesByIdRelations({ path: { id: issueId } })
      return (data ?? []) as KanbanIssueRelation[]
    },
    enabled: !!issueId,
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useAddRelation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddRelationInput) => {
      const { data } = await postKanbanRelations({ body: input })
      return data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.relations(vars.sourceIssueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.relations(vars.targetIssueId) })
    },
  })
}

export function useDeleteRelation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: DeleteRelationInput) => {
      await deleteKanbanRelationsById({ path: { id: vars.id } })
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.relations(vars.issueId) }),
  })
}

// ── Delegation ────────────────────────────────────────────────────────────────

export function useDelegateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { issueId: string, agentId: string, agentProfileId?: string | null }) => {
      const { data } = await postKanbanIssuesByIdDelegation({
        path: { id: vars.issueId },
        body: { agentProfileId: vars.agentProfileId, agentId: vars.agentId },
      })
      return data as AgentSession | null
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.issueId) })
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.agentSessions(vars.issueId) })
    },
  })
}

export function useUndelegateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { issueId: string }) => {
      await deleteKanbanIssuesByIdDelegation({ path: { id: vars.issueId } })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.issueId) })
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.agentSessions(vars.issueId) })
    },
  })
}

export function useStopAgentSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { agentSessionId: string, issueId: string }) => {
      await deleteIssueAgentSessionsByAgentSessionId({ path: { agentSessionId: vars.agentSessionId } })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.agentSessions(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) })
    },
  })
}

export function useStartAgentSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      issueId: string
      workspaceId?: string
      agentSessionId: string
    }) => {
      await postIssueAgentSessionsByAgentSessionIdRerun({
        path: { agentSessionId: vars.agentSessionId },
        body: {},
      })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.agentSessions(vars.issueId) })
      if (vars.workspaceId) {
        qc.invalidateQueries({ queryKey: sessionsQueryKey(vars.workspaceId) })
      }
    },
  })
}

// ── Agent Sessions & Activities ───────────────────────────────────────────────

export function useAgentSessions(issueId: string) {
  return useQuery({
    queryKey: kanbanKeys.agentSessions(issueId),
    queryFn: async () => {
      const { data } = await getKanbanIssuesByIdAgentSessions({ path: { id: issueId } })
      return (data ?? []) as AgentSession[]
    },
    enabled: !!issueId,
    refetchInterval: (query) => {
      const sessions = query.state.data ?? []
      const hasActive = sessions.some(s => s.status === 'active' || s.status === 'created')
      return hasActive ? 500 : false
    },
  })
}

export function useAgentActivities(agentSessionId: string | null, opts?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: kanbanKeys.agentActivities(agentSessionId ?? ''),
    queryFn: async () => {
      if (!agentSessionId) {
        return []
      }
      const { data } = await getIssueAgentSessionsByAgentSessionIdActivities({ path: { agentSessionId } })
      return (data ?? []) as AgentActivity[]
    },
    enabled: !!agentSessionId,
    refetchInterval: opts?.refetchInterval,
  })
}

// ── Context Refs ──────────────────────────────────────────────────────────────

// eslint-disable-next-line unused-imports/no-unused-vars
function useAddContextRef() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { issueId: string, ref: string }) => {
      await postKanbanIssuesByIdContextRefs({ path: { id: vars.issueId }, body: { ref: vars.ref } })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.issueId) })
    },
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useRemoveContextRef() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { issueId: string, index: number }) => {
      await deleteKanbanIssuesByIdContextRefsByIndex({ path: { id: vars.issueId, index: String(vars.index) } })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.issueId) })
    },
  })
}

// ── Session ↔ Issue Link ──────────────────────────────────────────────────────

type LinkedIssueView = {
  issue?: KanbanIssue | null
  status?: KanbanStatus | null
  agentSession?: AgentSession | null
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useLinkedIssue(chatSessionId: string | null) {
  return useQuery({
    queryKey: ['kanban', 'linkedIssue', chatSessionId] as const,
    queryFn: async () => {
      if (!chatSessionId) {
        return null
      }
      const { data } = await getSessionsByIdLinkedIssue({ path: { id: chatSessionId } })
      return (data ?? null) as LinkedIssueView | null
    },
    enabled: !!chatSessionId,
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useLinkIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { chatSessionId: string, issueId: string }) => {
      await postSessionsByIdLinkedIssue({ path: { id: vars.chatSessionId }, body: { issueId: vars.issueId } })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['kanban', 'linkedIssue', vars.chatSessionId] })
    },
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useUnlinkIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (chatSessionId: string) => {
      await deleteSessionsByIdLinkedIssue({ path: { id: chatSessionId } })
    },
    onSuccess: (_data, chatSessionId) => {
      qc.invalidateQueries({ queryKey: ['kanban', 'linkedIssue', chatSessionId] })
    },
  })
}
