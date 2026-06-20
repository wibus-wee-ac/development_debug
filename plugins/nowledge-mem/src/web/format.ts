/* Display formatting helpers for the Nowledge Mem panel. */

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit, ms: number }> = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
]

const rtf = typeof Intl !== 'undefined'
  ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  : null

export function formatRelativeTime(input?: string | null): string | null {
  if (!input) { return null }
  const date = new Date(input)
  const ms = date.getTime()
  if (Number.isNaN(ms)) { return null }
  const diff = ms - Date.now()
  const absDiff = Math.abs(diff)
  for (const { unit, ms: unitMs } of RELATIVE_UNITS) {
    if (absDiff >= unitMs || unit === 'minute') {
      const value = Math.round(diff / unitMs)
      if (rtf) { return rtf.format(value, unit) }
      return `${value} ${unit}${Math.abs(value) === 1 ? '' : 's'}`
    }
  }
  return null
}

export function formatDateTime(input?: string | null): string | null {
  if (!input) { return null }
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) { return null }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatShortDate(input?: string | null): string | null {
  if (!input) { return null }
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) { return null }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function firstLine(content?: string): string {
  if (!content) { return '' }
  const trimmed = content.trim()
  const newlineIdx = trimmed.indexOf('\n')
  const line = newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx)
  return line.length > 100 ? `${line.slice(0, 100)}…` : line
}

export function truncate(text: string, max = 200): string {
  if (text.length <= max) { return text }
  return `${text.slice(0, max).trimEnd()}…`
}

export function deriveMcpUrl(apiUrl: string): string {
  const DEFAULT_API_URL = 'http://127.0.0.1:14242'
  return `${apiUrl.trim().replace(/\/+$/, '') || DEFAULT_API_URL}/mcp`
}
