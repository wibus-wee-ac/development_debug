// Input: React children (label, description, control), tooltip primitives
// Output: SettingsRow — left-right row component for Linear-style settings
// Position: Shared layout primitive for settings pages

import { InfoIcon } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

interface SettingsRowProps {
  label: string
  description?: string
  info?: string
  children: React.ReactNode
  className?: string
  vertical?: boolean
  onClick?: () => void
}

export function SettingsRow({
  label,
  description,
  info,
  children,
  className,
  vertical = false,
  onClick,
}: SettingsRowProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick
        ? (e) => {
          if (e.key === 'Enter') {
            onClick()
          }
        }
        : undefined}
      className={cn(
        'py-4',
        vertical
          ? 'flex flex-col gap-3'
          : 'flex items-start justify-between gap-8',
        className,
      )}
    >
      {/* Left — label + description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-foreground">{label}</span>
          {info && (
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon className="size-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {info}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
        )}
      </div>

      {/* Right — control */}
      <div className={cn('shrink-0', vertical ? 'w-full' : undefined)}>
        {children}
      </div>
    </div>
  )
}

interface SettingsSectionHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

export function SettingsSectionHeader({ title, description, action }: SettingsSectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 pb-3">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="mt-1 text-[12px] text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

export function SettingsDivider() {
  return <div className="border-t border-foreground/5" />
}
