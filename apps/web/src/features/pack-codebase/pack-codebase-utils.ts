// Input: Pack-codebase path and token values
// Output: Pure helpers for include patterns and display labels
// Position: Utility layer owned by the pack-codebase feature

const SCOPE_PATH_SEPARATOR = /[,\n]+/

export function splitScopePathInput(input: string): string[] {
  return input
    .split(SCOPE_PATH_SEPARATOR)
    .map(path => path.trim())
    .filter(Boolean)
}

export function mergeScopePaths(currentPaths: string[], input: string): string[] {
  const nextPaths = splitScopePathInput(input)
  if (nextPaths.length === 0) {
    return currentPaths
  }

  const seen = new Set(currentPaths)
  const merged = [...currentPaths]
  for (const path of nextPaths) {
    if (!seen.has(path)) {
      seen.add(path)
      merged.push(path)
    }
  }
  return merged
}

export function pathToGlob(path: string): string {
  const lastSegment = path.split('/').pop() ?? ''
  const isFile = lastSegment.includes('.')
  return isFile ? path : `${path}/**`
}

export function pathsToInclude(paths: string[]): string {
  return paths.map(pathToGlob).join(',')
}

export function pathsToIncludeFromDraft(currentPaths: string[], input: string): string | undefined {
  const paths = mergeScopePaths(currentPaths, input)
  return paths.length > 0 ? pathsToInclude(paths) : undefined
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return String(value)
}
