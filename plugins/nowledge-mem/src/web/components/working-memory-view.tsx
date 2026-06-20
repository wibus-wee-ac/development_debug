/* Working Memory sections vary in shape; render any string-ish field we know. */

import type { ReferencedMemory, WorkingMemory, WorkingMemoryEntry } from '../types'

interface SectionProps {
  title: string
  items?: WorkingMemoryEntry[]
}

function entriesToText(entry: WorkingMemoryEntry): string {
  if (typeof entry === 'string') { return entry }
  const candidate = entry.content ?? entry.text ?? entry.summary ?? entry.title ?? entry.body ?? entry.note
  if (typeof candidate === 'string') { return candidate }
  // Fallback: stringify remaining fields
  try {
    return JSON.stringify(scrubEntry(entry))
  }
  catch {
    return ''
  }
}

function scrubEntry(entry: Extract<WorkingMemoryEntry, object>): Record<string, unknown> {
  const { content, text, summary, title, body, note, ...rest } = entry
  return rest
}

function entriesToTitle(entry: WorkingMemoryEntry): string | null {
  if (typeof entry === 'string') { return null }
  const candidate = entry.title
  return typeof candidate === 'string' ? candidate : null
}

export function WorkingMemorySection({ title, items }: SectionProps) {
  if (!items || items.length === 0) { return null }
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((entry, idx) => {
          const heading = entriesToTitle(entry)
          const body = entriesToText(entry)
          return (
            <li
              key={idx}
              className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-accent"
            >
              {heading && (
                <span className="font-medium text-foreground">{heading}</span>
              )}
              {body && (
                <span className={heading ? 'text-muted-foreground' : 'text-foreground'}>{body}</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function WorkingMemoryView({ data }: { data: WorkingMemory }) {
  const sections: Array<{ title: string, items?: WorkingMemoryEntry[] }> = [
    { title: 'Priorities', items: data.priorities },
    { title: 'Recent decisions', items: data.recent_decisions },
    { title: 'Open questions', items: data.open_questions },
    { title: 'Notes', items: data.notes },
    { title: 'Active focus', items: data.active_focus },
  ]

  const flatFocus = (data.focus_areas ?? []).flat().filter(Boolean)
  if (flatFocus.length > 0) {
    sections.push({ title: 'Focus areas', items: flatFocus })
  }

  const visible = sections.filter(s => s.items && s.items.length > 0)
  if (visible.length === 0 && !data.summary && !data.title) { return null }

  return (
    <div className="flex flex-col gap-3">
      {(data.title || data.summary) && (
        <div className="flex flex-col gap-0.5">
          {data.title && <span className="text-[14px] font-medium font-heading text-foreground">{data.title}</span>}
          {data.summary && <span className="text-[12.5px] text-muted-foreground">{data.summary}</span>}
        </div>
      )}
      {visible.map(section => (
        <WorkingMemorySection key={section.title} title={section.title} items={section.items} />
      ))}
      {data.metadata && Object.keys(data.metadata).length > 0 && (
        <pre className="overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(data.metadata, null, 2)}
        </pre>
      )}
    </div>
  )
}

/* ─── Referenced memories chips ──────────────────────────────────────── */

export function ReferencedMemories({
  refs,
  onSelect,
}: {
  refs: ReferencedMemory[] | undefined
  onSelect: (memoryId: string) => void
}) {
  if (!refs || refs.length === 0) { return null }
  const visibleRefs = refs
    .filter(r => (r.id ?? r.memory_id))

  if (visibleRefs.length === 0) { return null }

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Referenced memories</h3>
      <div className="flex flex-wrap gap-1.5">
        {visibleRefs.map((r, idx) => {
          const id = r.id ?? r.memory_id ?? ''
          const label = r.title ?? r.content?.split('\n')[0]?.slice(0, 40) ?? id
          return (
            <button
              key={`${id}-${idx}`}
              type="button"
              onClick={() => onSelect(id)}
              className="max-w-[280px] truncate rounded-md border border-border bg-card px-2 py-1 text-left text-[11.5px] text-foreground hover:bg-accent"
              title={label}
            >
              {label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/* ─── Context bundle key-value rows ──────────────────────────────────── */

function pickString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== 'object') { return null }
  for (const key of keys) {
    const v = (value as Record<string, unknown>)[key]
    if (typeof v === 'string' && v.trim()) { return v }
  }
  return null
}

interface InfoRow {
  label: string
  value: string | null
}

export function extractBundleRows(bundle: unknown): InfoRow[] {
  if (!bundle || typeof bundle !== 'object') { return [] }
  const b = bundle as Record<string, unknown>
  const owner = b.owner
  const agent = b.agent_identity ?? b.agent
  const space = b.space
  const rules = Array.isArray(b.rules) ? b.rules : []

  const rows: InfoRow[] = []

  if (owner) {
    rows.push({
      label: 'Owner',
      value: pickString(owner, ['display_name', 'displayName', 'name', 'email', 'id']),
    })
  }
  if (agent) {
    rows.push({
      label: 'Agent',
      value: pickString(agent, ['display_name', 'displayName', 'name', 'slug', 'id']),
    })
  }
  if (space) {
    rows.push({
      label: 'Space',
      value: pickString(space, ['display_name', 'displayName', 'name', 'key', 'id']),
    })
  }

  rows.push({
    label: 'Rules slots',
    value: rules.length > 0 ? `${rules.length}` : null,
  })

  return rows.filter(r => r.value !== null)
}
