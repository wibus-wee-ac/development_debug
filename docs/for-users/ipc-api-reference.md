# IPC API Reference

This reference documents the renderer-facing IPC namespaces exposed through `window.ipc`.

## 1. Usage Model

Renderer code uses the typed proxy:

```ts
import { ipc } from '@renderer/lib/ipc'
```

Each namespace maps to a main-process service group.

## 2. `workspace`

- `selectDirectory(): Promise<string | null>`
- `addFromDirectory(dirPath: string): Promise<Workspace>`
- `openInFinder(dirPath: string): void`
- `openInDefaultApp(dirPath: string): Promise<void>`
- `list(): Workspace[]`
- `get(id: string): Workspace | undefined`
- `resolveByPath(path: string): Workspace | undefined`
- `create(input: { name: string, path: string }): Workspace`
- `update(input: { id: string, name: string }): Workspace | undefined`
- `delete(id: string): void`
- `listFiles(workspaceId: string): Promise<Array<{ type: 'file' | 'directory', name: string, path: string }>>`
- `readTextFile(workspaceId: string, relativePath: string): Promise<string | null>`
- `writeTextFile(workspaceId: string, relativePath: string, content: string): Promise<boolean>`

## 3. `session`

- `list(workspaceId: string): Session[]`
- `get(id: string): Session | undefined`
- `create(input: { workspaceId: string, title: string, agentProfileId: string, id?: string }): Session`
- `delete(id: string): void`
- `updateTitle(input: { id: string, title: string }): void`
- `getMessages(sessionId: string): Message[]`
- `togglePin(id: string): boolean`
- `exportAsMarkdown(sessionId: string): string`

## 4. `chat`

- `createAndSend(opts: { agentId: string, workspaceId: string, cwd: string, text: string, modelId?: string, thinkingEffort?: 'low' | 'medium' | 'high', agentIdentityId?: string }): Promise<string>`
- `send(chatSessionId: string, text: string): Promise<void>`
- `abort(chatSessionId: string): Promise<void>`
- `getSessionTimeline(chatSessionId: string): ChatTimelineGroup[]`
- `hasActiveTurn(chatSessionId: string): boolean`
- `ensureLive(chatSessionId: string): Promise<EnsureLiveResult>`
- `watchSession(chatSessionId: string): void`
- `unwatchSession(chatSessionId: string): void`

## 5. `agentRuntime`

- `listProfiles(): AgentProfile[]`
- `getProfile(id: string): AgentProfile | undefined`
- `upsertProfile(input: EditableAgentProfile): AgentProfile`
- `removeProfile(id: string): void`
- `probeProfile(id: string): Promise<ProviderProbeResult>`
- `listModels(id: string): Promise<ModelDescriptor[]>`
- `saveCredential(input: SaveCredentialInput): CredentialMetadata`
- `removeCredential(id: string): void`
- `listCredentials(): CredentialMetadata[]`

## 6. `agent`

- `list(): Agent[]`
- `get(id: string): Agent | undefined`
- `create(input: CreateAgentInput): Agent`
- `update(id: string, patch: UpdateAgentInput): Agent`
- `remove(id: string): void`

## 7. `acp`

- `fetchRegistry(): Promise<RegistryAgent[]>`
- `getDistributionTypes(agentId: string): Promise<Array<'binary' | 'npx' | 'uvx'>>`
- `listInstalled(): AcpAgent[]`
- `getInstalled(agentId: string): AcpAgent | undefined`
- `install(agentId: string, distributionType: 'binary' | 'npx' | 'uvx'): Promise<AcpAgent>`
- `cancelInstall(agentId: string): void`
- `uninstall(agentId: string): Promise<void>`
- `getAuditLog(agentId?: string): AcpAuditEntry[]`
- `getAgentInstallPath(agentId: string): string`
- `startAgent(agentId: string): Promise<Record<string, unknown>>`
- `stopAgent(agentId: string): Promise<void>`
- `isAgentRunning(agentId: string): boolean`
- `createSession(agentId: string, cwd: string): Promise<Record<string, unknown>>`
- `sendPrompt(agentId: string, sessionId: string, message: string): Promise<Record<string, unknown>>`
- `cancelPrompt(agentId: string, sessionId: string): Promise<void>`
- `getSessionState(agentId: string, sessionId: string): AcpSessionState | null`
- `setSessionModel(agentId: string, sessionId: string, modelId: string): Promise<void>`
- `setSessionConfigOption(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void>`
- `getRunningAgentMetrics(): ProcessMetrics[]`

## 8. `pty`

- `startPty(sessionId: string, cols: number, rows: number): void`
- `stopPty(sessionId: string): void`
- `writePty(sessionId: string, data: string): void`
- `resizePty(sessionId: string, cols: number, rows: number): void`
- `isPtyRunning(sessionId: string): boolean`
- `getPtyBuffer(sessionId: string): string`
- `startShell(ptyId: string, cwd: string, cols: number, rows: number): void`

## 9. `kanban`

Status:

- `listStatuses(workspaceId: string): KanbanStatus[]`
- `createStatus(input: { workspaceId: string, name: string, color?: string | null }): KanbanStatus`
- `updateStatus(id: string, patch: { name?: string, color?: string | null }): KanbanStatus`
- `reorderStatuses(workspaceId: string, orderedIds: string[]): void`
- `deleteStatus(id: string): void`

Board:

- `listBoards(workspaceId?: string): KanbanBoard[]`
- `createBoard(input: { workspaceId: string, name: string, filterConfig?: string | null }): KanbanBoard`
- `updateBoard(id: string, patch: { name?: string, filterConfig?: string | null }): KanbanBoard`
- `deleteBoard(id: string): void`

Milestone:

- `listMilestones(workspaceId: string): KanbanMilestone[]`
- `createMilestone(input: { workspaceId: string, title: string, description?: string | null, dueDate?: number | null }): KanbanMilestone`
- `updateMilestone(id: string, patch: { title?: string, description?: string | null, dueDate?: number | null, status?: 'open' | 'closed' }): KanbanMilestone`
- `deleteMilestone(id: string): void`

Issue:

- `listIssues(params: { workspaceId: string, milestoneId?: string | null, parentIssueId?: string | null, priority?: string | null, labels?: string[] | null, statusId?: string | null }): KanbanIssue[]`
- `searchIssues(query: string, limit?: number): KanbanIssue[]`
- `getIssue(id: string): KanbanIssue | undefined`
- `createIssue(input: { workspaceId: string, title: string, description?: string | null, priority?: KanbanIssue['priority'], labels?: string[], milestoneId?: string | null, parentIssueId?: string | null, statusId?: string | null }): KanbanIssue`
- `updateIssue(id: string, patch: Partial<{ title: string, description: string | null, priority: KanbanIssue['priority'], labels: string[], milestoneId: string | null, parentIssueId: string | null, statusId: string | null, assigneeKind: string | null, assigneeId: string | null }>): KanbanIssue`
- `moveIssue(id: string, statusId: string | null): KanbanIssue`
- `deleteIssue(id: string): void`

Comment:

- `listComments(issueId: string): KanbanIssueComment[]`
- `addComment(input: { issueId: string, content: string, authorKind?: KanbanIssueComment['authorKind'], authorId?: string | null }): KanbanIssueComment`
- `deleteComment(id: string): void`

Relation:

- `listRelations(issueId: string): KanbanIssueRelation[]`
- `addRelation(input: { sourceIssueId: string, targetIssueId: string, type: 'blocks' | 'duplicates' | 'relates_to' }): KanbanIssueRelation`
- `deleteRelation(id: string): void`

Context refs and linking:

- `updateContextRefs(issueId: string, refs: string): void`
- `addContextRef(issueId: string, ref: string): void`
- `removeContextRef(issueId: string, index: number): void`
- `getLinkedIssue(chatSessionId: string): { issue: KanbanIssue, status: KanbanStatus | null, agentSession: AgentSession | null } | null`
- `linkIssueToSession(chatSessionId: string, issueId: string): void`
- `unlinkIssueFromSession(chatSessionId: string): void`

## 10. `issueAgent`

- `delegateIssue(issueId: string, agentProfileId: string, agentId?: string): Promise<AgentSession>`
- `runDelegatedIssue(issueId: string, agentSessionId: string, agentProfileId: string, agentId?: string): Promise<void>`
- `stopAgentSession(agentSessionId: string): Promise<void>`
- `undelegateIssue(issueId: string): Promise<void>`
- `getAgentSessions(issueId: string): AgentSession[]`
- `getAgentActivities(agentSessionId: string): AgentActivity[]`

## 11. `skills`

- `list(params?: { workspaceId?: string | null, agentId?: string | null }): Promise<SkillInventoryEntry[]>`
- `get(params: { scope: SkillScope, name: string, workspaceId?: string | null, agentId?: string | null }): Promise<SkillDocument>`
- `create(params: { scope: SkillScope, name: string, description?: string, body: string, frontmatter?: string, workspaceId?: string | null, agentId?: string | null }): Promise<SkillDocument>`
- `update(params: { scope: SkillScope, name: string, document: SkillDocument, workspaceId?: string | null, agentId?: string | null }): Promise<SkillDocument>`
- `delete(params: { scope: SkillScope, name: string, workspaceId?: string | null, agentId?: string | null }): Promise<void>`
- `import(params: { scope: SkillScope, sourceDir: string, overwrite?: boolean, workspaceId?: string | null, agentId?: string | null }): Promise<SkillDocument>`
- `export(params: { scope: SkillScope, name: string, destinationDir: string, overwrite?: boolean, workspaceId?: string | null, agentId?: string | null }): Promise<string>`
- `fetchSource(params: { source: string }): Promise<{ sessionId: string, source: ParsedSkillSource, skills: DiscoveredSkill[] }>`
- `importFromFetch(params: { sessionId: string, selectedDirs: string[], scope: SkillScope, overwrite?: boolean, workspaceId?: string | null, agentId?: string | null }): Promise<{ imported: SkillDocument[], errors: Array<{ dir: string, error: string }> }>`
- `cancelFetch(params: { sessionId: string }): Promise<void>`

## 12. `workflowRules`

- `get(workspaceId: string, agentProfileId?: string): Promise<WorkflowRules>`
- `save(workspaceId: string, agentProfileId: string | null, content: string): Promise<void>`
- `delete(workspaceId: string, agentProfileId: string | null): Promise<void>`
- `list(workspaceId: string): Promise<WorkflowRuleEntry[]>`

## 13. `search`

- `searchThreads(params: ThreadSearchParams): ThreadSearchHit[]`

## 14. `usage`

- `getDailyUsage(opts?: { days?: number }): DailyUsage[]`
- `getUsageSummary(): UsageSummary`
- `getUsageStats(): { currentStreak: number, longestStreak: number, activeDays: number, avgDailyTokens: number, peakDay: { date: string, totalTokens: number } | null, todayTokens: number }`
- `getSessionUsage(chatSessionId: string): { totalTokens: number, promptTokens: number, completionTokens: number, count: number }`

## 15. `git`

- `getStatus(workspacePath: string): Promise<GitStatus>`
- `getFileStatuses(workspacePath: string): Promise<GitFileStatus[]>`
- `getBranches(workspacePath: string): Promise<GitBranches>`
- `getGraph(workspacePath: string, limit?: number): Promise<GitGraphCommit[]>`
- `checkout(workspacePath: string, branch: string): Promise<void>`
- `createBranch(workspacePath: string, name: string, from?: string): Promise<void>`
- `fetch(workspacePath: string): Promise<void>`

## 16. `preferences`

- `getChatPreferences(): StoredChatPreferences`
- `setChatPreferences(preferences: StoredChatPreferences): void`

## 17. `packCodebase`

- `pack(params: { workspaceId: string, style: 'xml' | 'markdown' | 'plain', compress: boolean, include?: string, ignore?: string, removeComments?: boolean, removeEmptyLines?: boolean }): Promise<PackCodebaseResult>`

## 18. `approval`

- `listPending(): PendingApproval[]`
- `respond(approvalId: string, response: ApprovalResponse): void`

## 19. `window`

- `tearOffSession(sessionId: string, x: number, y: number): void`

## 20. `ipcDevtool`

- `getSnapshot()`
- `clear(): void`
- `getAcpSnapshot()`
- `clearAcp(): void`
- `getAgentContextSnapshot()`
- `clearAgentContext(): void`
- `getObservabilitySnapshot()`
- `clearObservability(): void`
- `flushObservability(): Promise<void>`
- `exportObservabilityBundle(input: { chatSessionId?: string, runId?: string, sinceUnix?: number })`
- `openWindow(): { opened: boolean }`

## 21. `dev` (Development Only)

- `openUserData(): Promise<void>`
- `hardReload(): void`

These methods are no-ops outside development mode.
