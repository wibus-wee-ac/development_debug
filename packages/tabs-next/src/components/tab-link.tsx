import type { MouseEvent, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'

import { useTabsContext } from '../context'
import { useTabNavigation } from '../hooks/use-tab-navigation'
import type { TabParams } from '../types'
import { buildHash } from '../url-sync'

export interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** Target tab type (route id) */
  to: string
  /** Target tab params */
  params?: TabParams
  /** Force open in new tab (default: false) */
  newTab?: boolean
  children: ReactNode
}

export function Link({ to, params = {}, newTab, children, onClick, ...rest }: LinkProps) {
  const { registry } = useTabsContext()
  const { navigateInTab, openInNewTab } = useTabNavigation()

  const href = useMemo(
    () => buildHash(registry, to, params),
    [registry, to, params],
  )

  const handleClick = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented) {
      return
    }

    e.preventDefault()

    const isNewTabGesture = e.metaKey || e.ctrlKey || e.button === 1 || newTab
    if (isNewTabGesture) {
      openInNewTab(to, params)
    }
    else {
      navigateInTab(to, params)
    }
  }, [onClick, newTab, to, params, openInNewTab, navigateInTab])

  const handleAuxClick = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button === 1) {
      e.preventDefault()
      openInNewTab(to, params)
    }
  }, [to, params, openInNewTab])

  return (
    <a href={href} onClick={handleClick} onAuxClick={handleAuxClick} {...rest}>
      {children}
    </a>
  )
}
