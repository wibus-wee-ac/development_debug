// Input: Preferred workspace id from routing, local selection state, workspace list
// Output: resolveSelectedWorkspaceId utility for launcher workspace selection
// Position: New-chat feature helper that keeps homepage workspace selection stable across navigation

interface WorkspaceIdentity {
  id: string
}

export function resolveSelectedWorkspaceId(
  preferredWorkspaceId: string | null | undefined,
  currentWorkspaceId: string | null,
  workspaces: WorkspaceIdentity[],
): string | null {
  if (preferredWorkspaceId && workspaces.some(workspace => workspace.id === preferredWorkspaceId)) {
    return preferredWorkspaceId
  }

  if (currentWorkspaceId && workspaces.some(workspace => workspace.id === currentWorkspaceId)) {
    return currentWorkspaceId
  }

  return workspaces[0]?.id ?? null
}
