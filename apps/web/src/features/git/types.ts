import type {
  GetWorkspacesByIdGitBranchesResponse,
  GetWorkspacesByIdGitGraphResponse,
  GetWorkspacesByIdGitRemotesResponse,
  GetWorkspacesByIdGitRepositoriesResponse,
  GetWorkspacesByIdGitStatusResponse,
} from '~/api-gen/types.gen'

export type GitFileStatus = GetWorkspacesByIdGitStatusResponse['files'][number]
export type GitStatus = GetWorkspacesByIdGitStatusResponse
export type GitRepository = GetWorkspacesByIdGitRepositoriesResponse[number]
export type GitBranches = GetWorkspacesByIdGitBranchesResponse
export type GitRemote = GetWorkspacesByIdGitRemotesResponse[number]
export type GitGraphCommit = GetWorkspacesByIdGitGraphResponse[number]
