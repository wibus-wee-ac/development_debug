// Input: Provider kind / preset id
// Output: SVG icon components for each provider
// Position: Visual assets for agent-runtime-settings UI

import type { ComponentProps } from 'react'

import { cn } from '~/lib/cn'

type IconProps = ComponentProps<'svg'>

function ClaudeIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn('size-4', className)} {...props}>
      <path d="M16.28 7.18L12.58 18.82C12.48 19.12 12.18 19.32 11.86 19.32C11.82 19.32 11.78 19.32 11.74 19.3C11.38 19.22 11.14 18.88 11.2 18.5L12.14 13.42L8.54 14.94C8.46 14.98 8.38 14.98 8.28 14.98C8.02 14.98 7.78 14.84 7.66 14.6C7.5 14.28 7.64 13.9 7.96 13.74L11.56 11.86L9.72 10.18C9.44 9.92 9.42 9.48 9.68 9.2C9.94 8.92 10.38 8.9 10.66 9.16L12.86 11.18L13.66 7.18C13.74 6.82 14.08 6.58 14.46 6.64C14.82 6.72 15.08 7.06 15.02 7.44L14.3 11.08L16.6 9.58C16.92 9.38 17.34 9.46 17.54 9.78C17.74 10.1 17.66 10.52 17.34 10.72L14.68 12.48L16.82 13.58C17.16 13.74 17.3 14.14 17.14 14.48C16.98 14.82 16.58 14.96 16.24 14.8L13.48 13.38L12.7 17.38L16.58 7.44C16.7 7.1 17.08 6.92 17.42 7.04C17.76 7.16 17.94 7.54 17.82 7.88" fill="currentColor" />
    </svg>
  )
}

function OpenAIIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn('size-4', className)} {...props}>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" fill="currentColor" />
    </svg>
  )
}

function CodexIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn('size-4', className)} {...props}>
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TerminalIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn('size-4', className)} {...props}>
      <path d="M4 17l6-5-6-5M12 19h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SettingsGearIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn('size-4', className)} {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export const PROVIDER_ICONS: Record<string, typeof ClaudeIcon> = {
  'claude-agent': ClaudeIcon,
  'claude-cli': TerminalIcon,
  'codex': CodexIcon,
  'openai': OpenAIIcon,
  'custom': SettingsGearIcon,
}

// Accent color mapping for provider branding (scope-badge pattern: bg/10 + text/60)
export const PROVIDER_ACCENT: Record<string, { bg: string, text: string }> = {
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-600 dark:text-orange-400' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-600 dark:text-sky-400' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-600 dark:text-violet-400' },
}
