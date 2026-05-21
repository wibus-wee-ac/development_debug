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
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-foreground">{label}</span>
          {info && (
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon className="size-3.5 cursor-help text-muted-foreground" />
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

      <div className={cn('shrink-0', vertical ? 'w-full' : undefined)}>
        {children}
      </div>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'w-full py-3 text-left',
          vertical
            ? 'flex flex-col gap-3'
            : 'flex items-start justify-between gap-8',
          className,
        )}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      className={cn(
        'py-3',
        vertical
          ? 'flex flex-col gap-3'
          : 'flex items-start justify-between gap-8',
        className,
      )}
    >
      {content}
    </div>
  )
}

interface SettingsSectionHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function SettingsSectionHeader({ title, description, action, className }: SettingsSectionHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 pb-3', className)}>
      <div>
        <h3 className="text-base font-semibold text-foreground text-balance">{title}</h3>
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
