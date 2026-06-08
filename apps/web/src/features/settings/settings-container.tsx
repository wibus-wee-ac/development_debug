// Unified settings layout primitives — a Linear-style single-column page shell
// (`SettingsPage`) and grouped card container (`SettingsGroup`) that every
// settings section composes for a consistent visual language.
import { cn } from '~/lib/cn'

interface SettingsPageProps extends React.ComponentPropsWithoutRef<'div'> {
  /** Large page title shown at the top of the section. */
  title: string
  /** Optional supporting copy rendered beneath the title. */
  description?: string
  /** Optional trailing accessory aligned to the title (badge, status, etc.). */
  action?: React.ReactNode
  children: React.ReactNode
}

/**
 * Centered, width-constrained page shell. Provides the section's large title
 * and stacks `SettingsGroup` cards with consistent vertical rhythm. Extra
 * props (e.g. `data-testid`, readiness flags) are forwarded to the root.
 */
export function SettingsPage({ title, description, action, children, className, ...rest }: SettingsPageProps) {
  return (
    <div className={cn('mx-auto flex w-full max-w-2xl flex-col gap-7 pb-4', className)} {...rest}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-foreground text-balance">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-muted-foreground text-pretty">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0 pt-1">{action}</div>}
      </header>
      {children}
    </div>
  )
}

interface SettingsGroupProps {
  /** Optional group label rendered above the card (e.g. "General"). */
  label?: string
  /** Optional supporting copy for the group label. */
  description?: string
  /** Optional trailing accessory aligned to the group label. */
  action?: React.ReactNode
  /**
   * When set, renders the card without the default row padding/divider styling
   * so callers can lay out custom content (lists, forms) inside the container.
   */
  bare?: boolean
  sectionClassName?: string
  className?: string
  children: React.ReactNode
}

/**
 * Linear-style grouped card. Direct children are treated as rows: they receive
 * inset horizontal padding and hairline dividers between them. Pass `bare` to
 * opt out and control the inner layout directly.
 */
export function SettingsGroup({ label, description, action, bare = false, sectionClassName, className, children }: SettingsGroupProps) {
  const hasHeader = Boolean(label || description || action)

  return (
    <section className={cn('flex flex-col gap-2.5', sectionClassName)}>
      {hasHeader && (
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            {label && <h2 className="text-[13px] font-medium text-foreground">{label}</h2>}
            {description && <p className="mt-0.5 text-[12px] text-muted-foreground text-pretty">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div
        className={cn(
          'rounded-xl border border-border bg-card',
          bare ? undefined : 'px-4 [&>*+*]:border-t [&>*+*]:border-border/60',
          className,
        )}
      >
        {children}
      </div>
    </section>
  )
}
