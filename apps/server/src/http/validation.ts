import type { ValidationError } from 'elysia'
import { t } from 'elysia'

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationErrorProfile {
  code: string
  message: string
  status?: number
}

export const validationIssueSchema = t.Object({
  path: t.String(),
  message: t.String(),
})

export const validationErrorDetailsSchema = t.Object({
  source: t.String(),
  issues: t.Array(validationIssueSchema),
})

const RE_LEADING_SLASHES = /^\/+/
const RE_SLASH = /\//g

export function normalizeTypeBoxPath(path: string | undefined): string {
  if (!path || path === '/' || path === 'root') {
    return 'root'
  }

  const normalized = path.replace(RE_LEADING_SLASHES, '').replace(RE_SLASH, '.')
  return normalized.length > 0 ? normalized : 'root'
}

export function normalizeValidationIssues(error: Readonly<ValidationError>): ValidationIssue[] {
  const issues = error.all.length > 0
    ? error.all
    : error.valueError
      ? [error.valueError]
      : []

  return issues.map((issue) => {
    const summary = 'summary' in issue && typeof issue.summary === 'string'
      ? issue.summary
      : undefined

    return {
      path: normalizeTypeBoxPath(issue.path),
      message: summary ?? issue.message,
    }
  })
}

export function normalizeValidationError(
  error: Readonly<ValidationError>,
  profile: ValidationErrorProfile,
) {
  return {
    status: profile.status ?? 400,
    body: {
      code: profile.code,
      message: profile.message,
      details: {
        source: error.type,
        issues: normalizeValidationIssues(error),
      },
    },
  }
}

export function createValidationErrorResponseSchema(profile: ValidationErrorProfile) {
  return t.Object({
    code: t.Literal(profile.code),
    message: t.Literal(profile.message),
    details: validationErrorDetailsSchema,
  })
}
