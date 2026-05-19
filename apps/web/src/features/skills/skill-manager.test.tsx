// @vitest-environment jsdom
//
// Input: React Testing Library, mocked skills hooks, SkillManager
// Output: Regression tests for skill detail action accessibility
// Position: Skills feature test guarding detail action semantics

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SkillDocument, SkillInventoryEntry } from '~/lib/types'

import { SkillManager } from './skill-manager'

const mockedDeps = vi.hoisted(() => {
  const inventory: SkillInventoryEntry[] = [{
    name: 'inspect-skill',
    description: 'Inspect project context',
    location: '/tmp/inspect-skill/SKILL.md',
    scope: 'global',
    rootDir: '/tmp',
    skillDir: '/tmp/inspect-skill',
    active: true,
    shadowedBy: null,
  }]
  const document: SkillDocument = {
    name: 'inspect-skill',
    description: 'Inspect project context',
    body: '# Inspect\n\nRead context first.',
    frontmatter: {},
    location: '/tmp/inspect-skill/SKILL.md',
    scope: 'global',
    rootDir: '/tmp',
    skillDir: '/tmp/inspect-skill',
  }

  return {
    inventory,
    document,
    deleteSkill: vi.fn(),
    exportSkill: vi.fn(),
    selectDirectory: vi.fn(),
  }
})

vi.mock('~/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('~/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean, children: React.ReactNode }) => (
    open ? <div>{children}</div> : null
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('~/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('~/components/ui/truncated-text', () => ({
  TruncatedText: ({ children }: { children: string }) => <span>{children}</span>,
}))

vi.mock('~/features/filesystem/directory-picker-provider', () => ({
  useDirectoryPicker: () => ({
    selectDirectory: mockedDeps.selectDirectory,
  }),
}))

vi.mock('../settings/settings-row', () => ({
  SettingsDivider: () => <hr />,
  SettingsSectionHeader: ({
    action,
    description,
    title,
  }: {
    action?: React.ReactNode
    description: string
    title: string
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {action}
    </header>
  ),
}))

vi.mock('./skill-import-dialog', () => ({
  SkillImportDialog: () => null,
}))

vi.mock('./use-skills', () => ({
  useSkillDocument: () => ({
    data: mockedDeps.document,
  }),
  useSkills: () => ({
    inventory: mockedDeps.inventory,
    isLoading: false,
    createSkill: {
      isPending: false,
      mutateAsync: vi.fn(),
    },
    updateSkill: {
      isPending: false,
      mutateAsync: vi.fn(),
    },
    deleteSkill: {
      mutateAsync: mockedDeps.deleteSkill,
    },
    exportSkill: {
      mutateAsync: mockedDeps.exportSkill,
    },
  }),
}))

vi.mock('~/lib/cn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

describe('SkillManager', () => {
  beforeEach(() => {
    mockedDeps.deleteSkill.mockResolvedValue(undefined)
    mockedDeps.exportSkill.mockResolvedValue('/tmp/exported')
    mockedDeps.selectDirectory.mockResolvedValue('/tmp/export')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('exposes named skill detail actions for editable skills', () => {
    render(
      <SkillManager
        editableScope="global"
        pageTestId="skills-page"
        title="Skills"
        description="Manage skills"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open inspect-skill details' }))

    expect(screen.getByRole('button', { name: 'Edit inspect-skill' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export inspect-skill' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete inspect-skill' })).toBeTruthy()
  })

  it('keeps export wired through the named detail action', async () => {
    render(
      <SkillManager
        editableScope="global"
        pageTestId="skills-page"
        title="Skills"
        description="Manage skills"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open inspect-skill details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export inspect-skill' }))

    await waitFor(() => {
      expect(mockedDeps.selectDirectory).toHaveBeenCalledWith({
        title: '导出技能',
        description: '选择导出目录',
      })
      expect(mockedDeps.exportSkill).toHaveBeenCalledWith({
        scope: 'global',
        name: 'inspect-skill',
        destinationDir: '/tmp/export',
      })
    })
  })

  it('keeps delete wired through the named detail action', async () => {
    render(
      <SkillManager
        editableScope="global"
        pageTestId="skills-page"
        title="Skills"
        description="Manage skills"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open inspect-skill details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete inspect-skill' }))

    await waitFor(() => {
      expect(mockedDeps.deleteSkill).toHaveBeenCalledWith({
        scope: 'global',
        name: 'inspect-skill',
      })
    })
  })

  it('keeps list delete as a separate named action without opening detail', async () => {
    render(
      <SkillManager
        editableScope="global"
        pageTestId="skills-page"
        title="Skills"
        description="Manage skills"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete inspect-skill from list' }))

    await waitFor(() => {
      expect(mockedDeps.deleteSkill).toHaveBeenCalledWith({
        scope: 'global',
        name: 'inspect-skill',
      })
    })
    expect(screen.queryByRole('heading', { name: 'Skill Detail' })).toBeNull()
  })
})
