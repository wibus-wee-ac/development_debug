import type {
  GetWorkspacesByIdGitBranchesResponse,
  GetWorkspacesByIdGitGraphResponse,
  GetWorkspacesByIdGitRemotesResponse,
  GetWorkspacesByIdGitStatusResponse,
} from '~/api-gen/types.gen'

export type GitFileStatus = GetWorkspacesByIdGitStatusResponse['files'][number]
export type GitStatus = GetWorkspacesByIdGitStatusResponse
export type GitBranches = GetWorkspacesByIdGitBranchesResponse
export type GitRemote = GetWorkspacesByIdGitRemotesResponse[number]
export type GitGraphCommit = GetWorkspacesByIdGitGraphResponse[number]
