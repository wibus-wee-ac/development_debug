import type { ComponentType } from 'react'
import type { Disposable, Logger } from './index'

export type { Disposable, Logger } from './index'

/** Web plugin context — provided by host during activation */
export interface WebPluginContext {
  /** Register a panel in the workspace */
  registerPanel(panel: PanelRegistration): Disposable

  /** Register a command (accessible via command palette / keyboard shortcut) */
  registerCommand(cmd: CommandRegistration): Disposable

  /** Plugin-scoped local storage */
  storage: WebPluginStorage

  /** Plugin-scoped logger */
  logger: Logger
}

export interface PanelRegistration {
  /** Unique panel identifier */
  id: string
  /** Display title */
  title: string
  /** Icon — either a React component or an icon name from host icon set */
  icon?: ComponentType<{ className?: string }> | string
  /** Panel component to render */
  component: ComponentType<PanelProps>
  /** Where to place the panel */
  location?: 'main' | 'sidebar' | 'bottom'
  /** Ordering within the location (lower = earlier) */
  order?: number
}

export interface PanelProps {
  /** Whether this panel is currently visible */
  isActive: boolean
}

export interface CommandRegistration {
  /** Unique command identifier */
  id: string
  /** Display title in command palette */
  title: string
  /** Icon name or component */
  icon?: ComponentType<{ className?: string }> | string
  /** Keyboard shortcut (e.g. 'ctrl+shift+b') */
  keybinding?: string
  /** Execute the command */
  execute(): void | Promise<void>
}

export interface WebPluginStorage {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

/** Web plugin module shape */
export interface WebPlugin {
  activate(ctx: WebPluginContext): void | Promise<void>
  deactivate?(): void
}
