// Input: ipc proxy, TanStack Query
// Output: Query hooks and mutations for Kanban boards, statuses, milestones, issues, comments, and relations
// Position: Data layer for the Kanban feature; all IPC calls go through these hooks

import { ipc } from '@renderer/lib/ipc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// ── Query keys ────────────────────────────────────────────────────────────────

export const kanbanKeys = {
  boards: (workspaceId?: string) => ['kanban', 'boards', workspaceId] as const,
  statuses: (workspaceId: string) => ['kanban', 'statuses', workspaceId] as const,
  milestones: (workspaceId: string) => ['kanban', 'milestones', workspaceId] as const,
  issues: (params: Record<string, unknown>) => ['kanban', 'issues', params] as const,
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

// ── Boards ────────────────────────────────────────────────────────────────────

export function useBoards(workspaceId?: string) {
  return useQuery({
    queryKey: kanbanKeys.boards(workspaceId),
    queryFn: () => ipc ? ipc.kanban.listBoards(workspaceId) : Promise.resolve([]),
  })
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
    mutationFn: (input: CreateBoardInput) => ipc!.kanban.createBoard(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'boards'] }),
  })
}

export function useUpdateBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: UpdateBoardInput) => ipc!.kanban.updateBoard(vars.id, vars.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'boards'] }),
  })
}

export function useDeleteBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => ipc!.kanban.deleteBoard(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'boards'] }),
  })
}

// ── Statuses ──────────────────────────────────────────────────────────────────

export function useStatuses(workspaceId: string) {
  return useQuery({
    queryKey: kanbanKeys.statuses(workspaceId),
    queryFn: () => ipc ? ipc.kanban.listStatuses(workspaceId) : Promise.resolve([]),
    enabled: !!workspaceId,
  })
}

export function useCreateStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateStatusInput) => ipc!.kanban.createStatus(input),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.statuses(vars.workspaceId) }),
  })
}

export function useUpdateStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: UpdateStatusInput) => ipc!.kanban.updateStatus(vars.id, vars.patch),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.statuses(vars.workspaceId) }),
  })
}

export function useReorderStatuses() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: ReorderStatusesInput) => ipc!.kanban.reorderStatuses(vars.workspaceId, vars.orderedIds),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.statuses(vars.workspaceId) }),
  })
}

export function useDeleteStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: DeleteStatusInput) => ipc!.kanban.deleteStatus(vars.id),
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
    queryFn: () => ipc ? ipc.kanban.listMilestones(workspaceId) : Promise.resolve([]),
    enabled: !!workspaceId,
  })
}

export function useCreateMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateMilestoneInput) => ipc!.kanban.createMilestone(input),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.milestones(vars.workspaceId) }),
  })
}

export function useUpdateMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: UpdateMilestoneInput) => ipc!.kanban.updateMilestone(vars.id, vars.patch),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.milestones(vars.workspaceId) }),
  })
}

export function useDeleteMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: DeleteMilestoneInput) => ipc!.kanban.deleteMilestone(vars.id),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.milestones(vars.workspaceId) }),
  })
}

// ── Issues ────────────────────────────────────────────────────────────────────

export function useIssues(params: IssueFilterParams) {
  return useQuery({
    queryKey: kanbanKeys.issues(params),
    queryFn: () => ipc ? ipc.kanban.listIssues(params) : Promise.resolve([]),
    enabled: !!params.workspaceId,
  })
}

export function useIssue(id: string) {
  return useQuery({
    queryKey: kanbanKeys.issue(id),
    queryFn: () => ipc ? ipc.kanban.getIssue(id) : Promise.resolve(undefined),
    enabled: !!id,
  })
}

export function useCreateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateIssueInput) => ipc!.kanban.createIssue(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'issues'] }),
  })
}

export function useUpdateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: UpdateIssueInput) => ipc!.kanban.updateIssue(vars.id, vars.patch),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.id) })
    },
  })
}

export function useMoveIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: MoveIssueInput) => ipc!.kanban.moveIssue(vars.id, vars.statusId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'issues'] }),
  })
}

export function useDeleteIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => ipc!.kanban.deleteIssue(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'issues'] }),
  })
}

// ── Comments ──────────────────────────────────────────────────────────────────

export function useComments(issueId: string) {
  return useQuery({
    queryKey: kanbanKeys.comments(issueId),
    queryFn: () => ipc ? ipc.kanban.listComments(issueId) : Promise.resolve([]),
    enabled: !!issueId,
  })
}

export function useAddComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AddCommentInput) => ipc!.kanban.addComment(input),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) }),
  })
}

export function useDeleteComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: DeleteCommentInput) => ipc!.kanban.deleteComment(vars.id),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) }),
  })
}

// ── Relations ─────────────────────────────────────────────────────────────────

export function useRelations(issueId: string) {
  return useQuery({
    queryKey: kanbanKeys.relations(issueId),
    queryFn: () => ipc ? ipc.kanban.listRelations(issueId) : Promise.resolve([]),
    enabled: !!issueId,
  })
}

export function useAddRelation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AddRelationInput) => ipc!.kanban.addRelation(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.relations(vars.sourceIssueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.relations(vars.targetIssueId) })
    },
  })
}

export function useDeleteRelation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: DeleteRelationInput) => ipc!.kanban.deleteRelation(vars.id),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: kanbanKeys.relations(vars.issueId) }),
  })
}

// ── Delegation ────────────────────────────────────────────────────────────────

export function useDelegateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { issueId: string, agentProfileId: string }) => {
      const session = await ipc!.kanban.delegateIssue(vars.issueId, vars.agentProfileId)
      return session
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
      // Stop any running agent first
      await ipc!.kanban.undelegateIssue(vars.issueId)
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
    mutationFn: (vars: { agentSessionId: string, issueId: string }) =>
      ipc!.kanban.stopAgentSession(vars.agentSessionId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.agentSessions(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) })
    },
  })
}

export function useStartAgentSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { issueId: string, agentSessionId: string, agentProfileId: string }) => {
      await ipc!.kanban.runDelegatedIssue(vars.issueId, vars.agentSessionId, vars.agentProfileId)
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.agentSessions(vars.issueId) })
    },
  })
}

// ── Agent Sessions & Activities ───────────────────────────────────────────────

export function useAgentSessions(issueId: string) {
  return useQuery({
    queryKey: kanbanKeys.agentSessions(issueId),
    queryFn: () => ipc ? ipc.kanban.getAgentSessions(issueId) : Promise.resolve([]),
    enabled: !!issueId,
  })
}

export function useAgentActivities(agentSessionId: string | null) {
  return useQuery({
    queryKey: kanbanKeys.agentActivities(agentSessionId ?? ''),
    queryFn: () => agentSessionId && ipc ? ipc.kanban.getAgentActivities(agentSessionId) : Promise.resolve([]),
    enabled: !!agentSessionId,
  })
}

// ── Context Refs ──────────────────────────────────────────────────────────────

export function useAddContextRef() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { issueId: string, ref: string }) =>
      ipc!.kanban.addContextRef(vars.issueId, vars.ref),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.issueId) })
    },
  })
}

export function useRemoveContextRef() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { issueId: string, index: number }) =>
      ipc!.kanban.removeContextRef(vars.issueId, vars.index),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.issueId) })
    },
  })
}
