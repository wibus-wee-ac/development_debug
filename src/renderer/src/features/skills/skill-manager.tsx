// Input: skill inventory/doc hooks, workspace directory picker IPC, js-yaml, coss UI primitives
// Output: Reusable split-pane skills management UI for global and workspace scopes
// Position: Shared presentation layer for filesystem skill CRUD, import/export, and layered inventory browsing

import type { SkillInventoryEntry, SkillScope } from '@main/ipc-types'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@renderer/components/ui/empty'
import { Label } from '@renderer/components/ui/label'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Spinner } from '@renderer/components/ui/spinner'
import { Textarea } from '@renderer/components/ui/textarea'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc'
import { DownloadIcon, FileCode2Icon, PlusIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { startTransition, useEffect, useMemo, useState } from 'react'
import yaml from 'js-yaml'

import { useSkillDocument, useSkills } from './use-skills'

interface SkillManagerProps {
  workspaceId?: string | null
  editableScope: 'global' | 'workspace'
  pageTestId: string
  title: string
  description: string
}

interface SelectedSkillRef {
  scope: SkillScope
  name: string
}

const GROUP_ORDER: Record<'global' | 'workspace', SkillScope[]> = {
  global: ['global', 'builtin'],
  workspace: ['workspace', 'global', 'builtin'],
}

const GROUP_LABELS: Record<SkillScope, string> = {
  builtin: 'Built-in',
  global: 'Global',
  workspace: 'Workspace',
}

const EMPTY_FRONTMATTER = 'name: new-skill\ndescription: Describe what this skill teaches'
const EMPTY_BODY = '# Overview\n\nDescribe when the agent should use this skill.\n'

function parseFrontmatter(frontmatterText: string): { frontmatter: Record<string, unknown>, name: string, description: string } {
  const parsed = yaml.load(frontmatterText)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Frontmatter must be a YAML object')
  }

  const frontmatter = parsed as Record<string, unknown>
  const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : ''
  const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : ''

  if (!name) {
    throw new Error('Frontmatter.name is required')
  }
  if (!description) {
    throw new Error('Frontmatter.description is required')
  }

  return { frontmatter, name, description }
}

function stringifyFrontmatter(frontmatter: Record<string, unknown>): string {
  return yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trimEnd()
}

export function SkillManager({
  workspaceId,
  editableScope,
  pageTestId,
  title,
  description,
}: SkillManagerProps) {
  const {
    inventory,
    isLoading,
    createSkill,
    updateSkill,
    deleteSkill,
    importSkill,
    exportSkill,
  } = useSkills(workspaceId)

  const [selectedSkill, setSelectedSkill] = useState<SelectedSkillRef | null>(null)
  const [isDraft, setIsDraft] = useState(false)
  const [frontmatterText, setFrontmatterText] = useState(EMPTY_FRONTMATTER)
  const [bodyText, setBodyText] = useState(EMPTY_BODY)
  const [errorText, setErrorText] = useState<string | null>(null)

  const activeInventory = useMemo(() => inventory.filter(entry => entry.active), [inventory])
  const currentDocument = useSkillDocument(workspaceId, selectedSkill?.scope ?? null, isDraft ? null : selectedSkill?.name ?? null)

  const groupedInventory = useMemo(() => {
    return GROUP_ORDER[editableScope].map((scope) => ({
      scope,
      label: GROUP_LABELS[scope],
      entries: activeInventory.filter(entry => entry.scope === scope),
    }))
  }, [activeInventory, editableScope])

  useEffect(() => {
    if (selectedSkill || isDraft) {
      return
    }

    const firstEditable = activeInventory.find(entry => entry.scope === editableScope)
    const fallback = firstEditable ?? activeInventory[0] ?? null
    if (fallback) {
      setSelectedSkill({ scope: fallback.scope, name: fallback.name })
    }
  }, [activeInventory, editableScope, isDraft, selectedSkill])

  useEffect(() => {
    if (isDraft) {
      return
    }
    if (!currentDocument.data) {
      return
    }

    startTransition(() => {
      const document = currentDocument.data
      if (!document) {
        return
      }

      setFrontmatterText(stringifyFrontmatter(document.frontmatter))
      setBodyText(document.body)
      setErrorText(null)
    })
  }, [currentDocument.data, isDraft])

  const selectedInventoryEntry = selectedSkill
    ? activeInventory.find(entry => entry.scope === selectedSkill.scope && entry.name === selectedSkill.name) ?? null
    : null

  const readOnly = !isDraft && !!selectedInventoryEntry && selectedInventoryEntry.scope !== editableScope
  const saving = createSkill.isPending || updateSkill.isPending

  const beginDraft = () => {
    setSelectedSkill({ scope: editableScope, name: '__draft__' })
    setIsDraft(true)
    setFrontmatterText(EMPTY_FRONTMATTER)
    setBodyText(EMPTY_BODY)
    setErrorText(null)
  }

  const handleSelect = (entry: SkillInventoryEntry) => {
    setSelectedSkill({ scope: entry.scope, name: entry.name })
    setIsDraft(false)
    setErrorText(null)
  }

  const handleSave = async () => {
    try {
      setErrorText(null)
      const { frontmatter, name, description: parsedDescription } = parseFrontmatter(frontmatterText)
      const body = bodyText

      if (isDraft) {
        const created = await createSkill.mutateAsync({
          scope: editableScope,
          name,
          description: parsedDescription,
          body,
          frontmatter,
        })
        setSelectedSkill({ scope: created.scope, name: created.name })
        setIsDraft(false)
        return
      }

      if (!selectedInventoryEntry) {
        throw new Error('Select a skill first')
      }

      const updated = await updateSkill.mutateAsync({
        scope: selectedInventoryEntry.scope,
        currentName: selectedInventoryEntry.name,
        name,
        description: parsedDescription,
        body,
        frontmatter,
      })
      setSelectedSkill({ scope: updated.scope, name: updated.name })
    }
    catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  const handleDelete = async () => {
    if (!selectedInventoryEntry || selectedInventoryEntry.scope !== editableScope) {
      return
    }

    await deleteSkill.mutateAsync({
      scope: selectedInventoryEntry.scope,
      name: selectedInventoryEntry.name,
    })

    setSelectedSkill(null)
    setIsDraft(false)
    setFrontmatterText(EMPTY_FRONTMATTER)
    setBodyText(EMPTY_BODY)
  }

  const handleImport = async () => {
    if (!ipc) {
      return
    }
    const sourceDir = await ipc.workspace.selectDirectory()
    if (!sourceDir) {
      return
    }

    try {
      setErrorText(null)
      const imported = await importSkill.mutateAsync({
        scope: editableScope,
        sourceDir,
      })
      setSelectedSkill({ scope: imported.scope, name: imported.name })
      setIsDraft(false)
    }
    catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  const handleExport = async () => {
    if (!ipc || !selectedInventoryEntry) {
      return
    }

    const destinationDir = await ipc.workspace.selectDirectory()
    if (!destinationDir) {
      return
    }

    try {
      setErrorText(null)
      await exportSkill.mutateAsync({
        scope: selectedInventoryEntry.scope,
        name: selectedInventoryEntry.name,
        destinationDir,
      })
    }
    catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid={pageTestId}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleImport()}
            data-testid="skill-import-btn"
          >
            <UploadIcon className="size-3.5" />
            Import
          </Button>
          <Button
            size="sm"
            onClick={beginDraft}
            data-testid="new-skill-btn"
          >
            <PlusIcon className="size-3.5" />
            New Skill
          </Button>
        </div>
      </div>

      <div className="grid min-h-[32rem] gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="rounded-xl border bg-card/40">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-3">
              {isLoading
                ? (
                  <div className="flex justify-center py-8">
                    <Spinner className="size-4 text-muted-foreground" />
                  </div>
                )
                : groupedInventory.map(group => (
                  <div key={group.scope} className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-medium text-muted-foreground">{group.label}</span>
                      {group.scope === editableScope && (
                        <Badge variant="secondary" className="text-[10px]">
                          Editable
                        </Badge>
                      )}
                    </div>

                    {group.entries.length === 0
                      ? (
                        <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground/70">
                          No skills
                        </div>
                      )
                      : group.entries.map(entry => {
                        const selected = !isDraft && selectedSkill?.scope === entry.scope && selectedSkill.name === entry.name
                        return (
                          <button
                            key={`${entry.scope}:${entry.name}`}
                            type="button"
                            onClick={() => handleSelect(entry)}
                            className={cn(
                              'flex w-full flex-col rounded-lg border px-3 py-2 text-left transition-colors',
                              selected
                                ? 'border-foreground/20 bg-accent'
                                : 'border-transparent hover:border-border hover:bg-accent/40',
                            )}
                          >
                            <span className="text-sm font-medium">{entry.name}</span>
                            <span className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{entry.description}</span>
                          </button>
                        )
                      })}
                  </div>
                ))}
            </div>
          </ScrollArea>
        </div>

        <div className="rounded-xl border bg-card/40">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {isDraft ? 'New Skill' : selectedInventoryEntry?.name ?? 'Skill Editor'}
                </span>
                {selectedInventoryEntry && (
                  <Badge variant="outline">{GROUP_LABELS[selectedInventoryEntry.scope]}</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Edit the YAML frontmatter and Markdown body that will be written into `SKILL.md`.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleExport()}
                disabled={!selectedInventoryEntry || exportSkill.isPending}
                data-testid="skill-export-btn"
              >
                <DownloadIcon className="size-3.5" />
                Export
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleDelete()}
                disabled={!selectedInventoryEntry || selectedInventoryEntry.scope !== editableScope || deleteSkill.isPending}
              >
                <Trash2Icon className="size-3.5" />
                Delete
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={readOnly || saving}
                data-testid="skill-save-btn"
              >
                {saving && <Spinner className="size-3.5" />}
                Save
              </Button>
            </div>
          </div>

          {selectedInventoryEntry || isDraft
            ? (
              <div className="grid gap-4 p-4">
                <div className="grid gap-1.5">
                  <Label htmlFor={`${pageTestId}-frontmatter`}>YAML Frontmatter</Label>
                  <Textarea
                    id={`${pageTestId}-frontmatter`}
                    value={frontmatterText}
                    onChange={event => setFrontmatterText(event.target.value)}
                    readOnly={readOnly}
                    spellCheck={false}
                    rows={8}
                    className="min-h-40 font-mono text-xs"
                    data-testid="skill-frontmatter-editor"
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor={`${pageTestId}-body`}>Markdown Body</Label>
                  <Textarea
                    id={`${pageTestId}-body`}
                    value={bodyText}
                    onChange={event => setBodyText(event.target.value)}
                    readOnly={readOnly}
                    spellCheck={false}
                    rows={14}
                    className="min-h-64 font-mono text-xs"
                    data-testid="skill-body-editor"
                  />
                </div>

                {errorText && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {errorText}
                  </div>
                )}
              </div>
            )
            : (
              <div className="p-4">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FileCode2Icon className="size-4" />
                    </EmptyMedia>
                    <EmptyTitle>Select a skill</EmptyTitle>
                    <EmptyDescription>
                      Pick an existing skill or create a new one to start editing the `SKILL.md` package.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
