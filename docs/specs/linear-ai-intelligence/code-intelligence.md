# Code Intelligence SPEC

## 直接结论

Cradle 的 Code Intelligence 应该是 `code-intelligence` owner 下的 permission-aware repository context system。它不是 workspace 文件搜索，也不是 coding agent。它的职责是把代码库转成受权限控制、可引用、可解释的产品上下文，让用户和 agent 能询问“产品实际如何实现”。

第一版应先支持本地 workspace repository 的 indexing 和代码问答；GitHub remote integration 可以作为第二阶段。权限、citation ledger、source redaction 和 guidance 必须从第一版开始设计。

## Linear 行为摘要

Linear Code Intelligence 的官方文档给出这些约束：

- 它通过 GitHub integration 给 Linear 受控 repository access。
- 它让 Product、Support、Sales、Engineering 在 Linear 内询问代码实现细节。
- 回答需要 grounded links，指向 files、commits 或 pull requests。
- 因为需要 deeper codebase analysis，响应可能慢于普通 workspace-data answer。
- 默认只搜索 GitHub integration 已连接且用户有权限访问的 repositories。
- Admin/owner 可以选择哪些 repositories 可用于 Code Intelligence。
- Admin 可以开启 extend access to all members，并限定 all repositories 或 selected repositories。
- Guest users 不可使用。
- Agent guidance 可以影响 code analysis 的解释方式，例如 repository conventions、architecture context 和 answer preference。

## Product Goal

Cradle 应支持这些问题：

- 这个功能在哪里实现？
- 这个 bug 可能关联哪些文件？
- 某个模块的架构约束是什么？
- 某个 issue 应该交给哪个 repository 或 agent？
- 某段逻辑是谁改的、何时改的？
- 当前 triage issue 是否与某个 code area 相关？

回答必须带 source refs，而不是只给模型猜测。

## Non-goals

- 不修改代码。Code Intelligence 只回答和提供 evidence，coding agent 另行消费这些 evidence。
- 不替代 workspace file explorer。
- 不默认读取所有 local files；必须通过 repository registry 和 access policy。
- 不把 repository index 写到 GitHub 或外部 provider。
- 不把 secret、env、credentials 纳入 index。

## Owner Boundary

`code-intelligence` owns：

- repository registry。
- access policy。
- indexing jobs。
- file chunks and symbol refs。
- commit / PR metadata cache。
- code answer runs。
- code citation ledger。
- repository guidance。

It reads：

- workspace path and git metadata through Workspace/Git modules。
- issue context through typed refs。
- agent guidance through guidance registry。

It writes：

- Cradle-owned code intelligence tables。
- answer artifacts and audit events。
- optional agent activity through `agent-interaction-runtime`。

It must not write：

- workspace files。
- Git history。
- foreign provider namespace。
- issue field suggestions directly。

## Repository Registry

```ts
export interface CodeRepository {
  id: string
  workspaceId: string | null
  sourceKind: 'local-git' | 'github'
  sourceId: string
  displayName: string
  rootPath: string | null
  defaultBranch: string | null
  status: 'enabled' | 'disabled' | 'indexing' | 'error'
  createdAt: number
  updatedAt: number
}

export interface RepositoryAccessPolicy {
  repositoryId: string
  mode: 'sourcePermissions' | 'allWorkspaceMembers' | 'selectedMembers'
  selectedPrincipalIds: string[]
  guestAccess: false
  configuredByUserId: string
  updatedAt: number
}
```

Local repository 第一版可以使用 workspace owner access；但仍应保留 policy shape，避免未来接 GitHub 时重构。

## Indexing Model

Index 不是一次性全文 dump。目标 index 至少包含：

- file path。
- file language。
- content hash。
- chunk range。
- chunk text。
- symbols。
- imports / dependencies。
- git blame summary。
- commit refs。
- PR refs if available。
- secret scan status。

```ts
export interface CodeChunk {
  id: string
  repositoryId: string
  filePath: string
  language: string | null
  startLine: number
  endLine: number
  contentHash: string
  text: string
  embeddingStatus: 'pending' | 'ready' | 'failed' | 'skipped'
  indexedAt: number
}

export interface CodeSymbolRef {
  id: string
  repositoryId: string
  filePath: string
  name: string
  kind: 'function' | 'class' | 'type' | 'variable' | 'module' | 'unknown'
  startLine: number
  endLine: number
}
```

## Indexing Standards

- Respect `.gitignore` and Cradle workspace ignore rules。
- Skip binary files。
- Skip files above configured size unless explicitly allowed。
- Skip secrets by default；redact suspicious values before chunk storage。
- Store content hashes to support incremental indexing。
- Keep repository index scoped to repository id, not global workspace blob。
- Record index run metrics and failures。
- Do not block UI while indexing；answer runs can degrade with partial index warning。

## Answer Run

```ts
export interface CodeAnswerRun {
  id: string
  workspaceId: string
  requesterUserId: string
  question: string
  status: 'queued' | 'retrieving' | 'generating' | 'completed' | 'failed' | 'redacted'
  repositoryScope: string[]
  guidanceSnapshotId: string | null
  createdAt: number
  completedAt: number | null
  errorText: string | null
}

export interface CodeCitation {
  id: string
  repositoryId: string
  sourceKind: 'file' | 'commit' | 'pull-request'
  sourceUri: string
  title: string
  filePath?: string
  startLine?: number
  endLine?: number
  commitSha?: string
  pullRequestId?: string
  excerptHash: string
}
```

Answer output：

```ts
export interface CodeAnswer {
  summary: string
  findings: Array<{
    claim: string
    citationIds: string[]
    confidence: 'low' | 'medium' | 'high'
  }>
  nextQuestions: string[]
  limitations: string[]
}
```

## Retrieval Pipeline

```text
Question
  -> Permission filter repositories
  -> Parse intent
  -> Retrieve lexical chunks
  -> Retrieve semantic chunks
  -> Retrieve symbols
  -> Retrieve commit/PR metadata
  -> Rerank
  -> Generate answer
  -> Validate citations
  -> Redact inaccessible refs
```

Retrieval should combine:

- exact path / symbol match。
- lexical search。
- embeddings。
- dependency graph expansion。
- git history。
- issue context refs。
- repository guidance。

## Permission Standards

- Guest users cannot create answer runs。
- Repository policy is evaluated before retrieval。
- If policy is `sourcePermissions`, adapter must prove requester access。
- If policy is `allWorkspaceMembers`, admin decision must be audited。
- Citation list must be filtered by requester permissions。
- If no accessible repository remains, return a permission-aware refusal。
- Redaction must happen before model answer generation when possible, not only after generation。

## Guidance

Code guidance examples：

- Which repository owns which product area。
- Monorepo package conventions。
- Architecture boundaries。
- Naming conventions。
- How to explain code to non-engineering users。
- What code areas should not be used as examples。

Guidance must be stored with scope and owner：

```ts
export interface CodeGuidanceDocument {
  id: string
  scope: 'workspace' | 'repository' | 'team' | 'personal'
  scopeId: string
  body: string
  updatedByUserId: string
  updatedAt: number
}
```

## Relationship to Coding Agents

Code Intelligence answers questions and emits evidence. Coding agents act on tasks.

Allowed handoff:

- Code Intelligence suggests candidate repository for an issue。
- Code Intelligence supplies source refs to an agent prompt。
- Coding agent publishes activity with file changes and PR links。

Disallowed coupling:

- Code Intelligence directly edits files。
- Coding agent bypasses repository access policy by reading Code Intelligence cache。
- Code Intelligence stores provider-native agent transcripts。

## Relationship to Triage Intelligence

Triage can consume Code Intelligence evidence when:

- issue references a file path、stack trace、module、commit or PR。
- historical related issues share code areas。
- repository guidance maps product area to team/project。

Code evidence must be typed:

```ts
export interface CodeEvidenceRef {
  kind: 'code-reference'
  repositoryId: string
  filePath: string
  startLine?: number
  endLine?: number
  summary: string
  accessPolicy: 'requester-visible' | 'redacted'
}
```

## UI Contract

Code Intelligence surface should show:

- repository scope。
- analysis progress。
- answer summary。
- cited files/commits/PRs。
- inaccessible repository warning。
- partial index warning。
- guidance source indicator。

For Support/Sales/Product users, answer should default to product-language explanation. For Engineering users, it can show lower-level symbols and code snippets when permission allows。

## API Targets

```text
GET /code-intelligence/repositories
POST /code-intelligence/repositories
PATCH /code-intelligence/repositories/:repositoryId
GET /code-intelligence/repositories/:repositoryId/access-policy
PUT /code-intelligence/repositories/:repositoryId/access-policy
POST /code-intelligence/repositories/:repositoryId/index-runs
GET /code-intelligence/repositories/:repositoryId/index-runs
POST /code-intelligence/answer-runs
GET /code-intelligence/answer-runs/:answerRunId
GET /code-intelligence/answer-runs/:answerRunId/citations
GET /code-intelligence/guidance
PUT /code-intelligence/guidance/:scopeId
```

## Tests and Evals

Unit tests：

- repository policy denies guest。
- selected repository scope filters retrieval。
- citation validator rejects missing source。
- secret redaction removes suspicious values before chunk storage。
- incremental index skips unchanged chunks。

Integration tests：

- local repository can be registered and indexed。
- answer run returns citations。
- no-access repository is not retrieved。
- partial index returns warning。
- guidance snapshot affects answer style but not permissions。

Eval：

- known implementation questions。
- architecture boundary questions。
- bug-to-file localization。
- permission redaction adversarial cases。
- stale index cases。

## Implementation Order

1. Add `code-intelligence` module and repository registry。
2. Add local-git indexer with fake embedding provider。
3. Add chunk/symbol/citation tables。
4. Add answer run API with fake answer generator。
5. Add permission policy and redaction tests。
6. Add UI answer surface。
7. Add GitHub adapter。
8. Connect Triage and agent prompts through typed evidence refs。

## Completion Criteria

- A registered repository can be indexed incrementally。
- A code question returns grounded answer with source refs。
- Unauthorized users cannot retrieve or cite restricted repository content。
- Code Intelligence can produce repository suggestions for agent delegation。
- Triage can consume code evidence without owning code index data。
