// Input: sessionId, workspaceId
// Output: Placeholder for issue aside panel (to be implemented)
// Position: Right aside tab content for linked issues

export function IssueAsidePanel({ sessionId: _sessionId, workspaceId: _workspaceId }: {
  sessionId: string
  workspaceId: string | null
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-[11px] text-muted-foreground">Issue 面板</p>
    </div>
  )
}
