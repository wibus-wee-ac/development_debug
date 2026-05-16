// Input: JSON text stored in SQLite text columns
// Output: defensive parsers for common text-encoded metadata shapes
// Position: app-level helper for modules that read legacy JSON text columns

export function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  }
  catch {
    return []
  }
}
