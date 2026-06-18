import type { DiffReview, DiffReviewFile } from '@cradle/db'
import { diffReviewFiles } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import type { GitCommitFileGroupInput } from '../git/service'
import type { ReviewCommitPlanGroupInput, ReviewCommitPlanGroupView } from './types'

type CommitGroupKind = 'schema' | 'implementation' | 'tests' | 'docs' | 'generated'

function commitGroupKind(file: DiffReviewFile): CommitGroupKind {
  const path = file.path.toLowerCase()
  if (file.isGenerated) {
    return 'generated'
  }
  if (path.includes('test') || path.includes('spec')) {
    return 'tests'
  }
  if (path.endsWith('.md') || path.includes('/docs/')) {
    return 'docs'
  }
  if (path.includes('schema') || path.endsWith('.sql') || path.includes('config') || path.includes('migration')) {
    return 'schema'
  }
  return 'implementation'
}

function commitGroupTitle(kind: CommitGroupKind): string {
  if (kind === 'schema') {
    return 'Schema and configuration'
  }
  if (kind === 'implementation') {
    return 'Implementation'
  }
  if (kind === 'tests') {
    return 'Tests'
  }
  if (kind === 'docs') {
    return 'Documentation'
  }
  return 'Generated artifacts'
}

function commitMessage(kind: CommitGroupKind, review: DiffReview): string {
  if (kind === 'schema') {
    return 'diff-review: update persistence schema'
  }
  if (kind === 'implementation') {
    return `diff-review: implement ${review.sourceKind} review flow`
  }
  if (kind === 'tests') {
    return 'diff-review: cover review lifecycle'
  }
  if (kind === 'docs') {
    return 'docs: update Cradle Diffs coverage'
  }
  return 'chore: regenerate diff review artifacts'
}

export function buildCommitPlanGroups(
  review: DiffReview,
  files: DiffReviewFile[],
  strategy: 'single' | 'rule-based-groups',
): ReviewCommitPlanGroupView[] {
  if (strategy === 'single' || files.length <= 1) {
    return [{
      id: 'commit:all',
      title: 'All changes',
      message: `diff-review: ${review.title.toLowerCase()}`,
      rationale: 'All changed files are placed in one commit because the user requested a single-commit strategy or the revision has only one changed file.',
      fileIds: files.map(file => file.id),
      paths: files.map(file => file.path),
      dependsOn: [],
    }]
  }

  const order: CommitGroupKind[] = ['schema', 'implementation', 'tests', 'docs', 'generated']
  const filesByKind = new Map<CommitGroupKind, DiffReviewFile[]>()
  for (const file of files) {
    const kind = commitGroupKind(file)
    const current = filesByKind.get(kind) ?? []
    current.push(file)
    filesByKind.set(kind, current)
  }

  const groups: ReviewCommitPlanGroupView[] = []
  for (const kind of order) {
    const groupedFiles = filesByKind.get(kind)
    if (!groupedFiles || groupedFiles.length === 0) {
      continue
    }
    const previousGroup = groups.at(-1)
    groups.push({
      id: `commit:${kind}`,
      title: commitGroupTitle(kind),
      message: commitMessage(kind, review),
      rationale: `Files are grouped as ${commitGroupTitle(kind).toLowerCase()} based on path and status. This keeps reviewable commits ordered from data/config foundations through implementation, validation, documentation, and generated output.`,
      fileIds: groupedFiles.map(file => file.id),
      paths: groupedFiles.map(file => file.path),
      dependsOn: previousGroup ? [previousGroup.id] : [],
    })
  }

  return groups
}

export function normalizeCommitPlanGroups(
  revisionId: string,
  groups: ReviewCommitPlanGroupInput[],
): ReviewCommitPlanGroupView[] {
  if (groups.length === 0) {
    throw new AppError({
      code: 'diff_review_commit_plan_empty',
      status: 400,
      message: 'Diff review commit plan must include at least one group',
      details: { revisionId },
    })
  }

  const files = db().select().from(diffReviewFiles)
    .where(eq(diffReviewFiles.revisionId, revisionId))
    .all()
  const fileById = new Map(files.map(file => [file.id, file]))
  const groupIds = new Set<string>()
  const usedFileIds = new Set<string>()

  for (const group of groups) {
    if (groupIds.has(group.id)) {
      throw new AppError({
        code: 'diff_review_commit_plan_duplicate_group',
        status: 400,
        message: 'Diff review commit plan group ids must be unique',
        details: { revisionId, groupId: group.id },
      })
    }
    groupIds.add(group.id)
  }

  const normalized: ReviewCommitPlanGroupView[] = []
  for (const group of groups) {
    if (group.fileIds.length === 0) {
      throw new AppError({
        code: 'diff_review_commit_plan_group_empty',
        status: 400,
        message: 'Diff review commit plan groups must include at least one file',
        details: { revisionId, groupId: group.id },
      })
    }

    const paths: string[] = []
    for (const fileId of group.fileIds) {
      const file = fileById.get(fileId)
      if (!file) {
        throw new AppError({
          code: 'diff_review_commit_plan_file_not_found',
          status: 400,
          message: 'Diff review commit plan file does not belong to the plan revision',
          details: { revisionId, groupId: group.id, fileId },
        })
      }
      if (usedFileIds.has(fileId)) {
        throw new AppError({
          code: 'diff_review_commit_plan_duplicate_file',
          status: 400,
          message: 'Diff review commit plan files can only appear in one group',
          details: { revisionId, groupId: group.id, fileId },
        })
      }
      usedFileIds.add(fileId)
      paths.push(file.path)
    }

    const dependsOn = [...new Set(group.dependsOn)]
    for (const dependencyId of dependsOn) {
      if (dependencyId === group.id || !groupIds.has(dependencyId)) {
        throw new AppError({
          code: 'diff_review_commit_plan_dependency_not_found',
          status: 400,
          message: 'Diff review commit plan dependencies must reference another group',
          details: { revisionId, groupId: group.id, dependencyId },
        })
      }
    }

    normalized.push({
      id: group.id,
      title: group.title.trim(),
      message: group.message.trim(),
      rationale: group.rationale.trim(),
      fileIds: group.fileIds,
      paths,
      dependsOn,
    })
  }

  return normalized
}

export function commitGroupsForPlan(
  revisionId: string,
  groups: ReviewCommitPlanGroupView[],
): GitCommitFileGroupInput[] {
  const files = db().select().from(diffReviewFiles)
    .where(eq(diffReviewFiles.revisionId, revisionId))
    .all()
  const fileById = new Map(files.map(file => [file.id, file]))
  return groups.map(group => {
    const paths: string[] = []
    for (const fileId of group.fileIds) {
      const file = fileById.get(fileId)
      if (!file) {
        throw new AppError({
          code: 'diff_review_commit_plan_file_not_found',
          status: 400,
          message: 'Diff review commit plan file does not belong to the plan revision',
          details: { revisionId, commitGroupId: group.id, fileId },
        })
      }
      if (file.previousPath) {
        paths.push(file.previousPath)
      }
      paths.push(file.path)
    }
    return {
      message: group.message,
      paths: Array.from(new Set(paths)),
    }
  })
}
