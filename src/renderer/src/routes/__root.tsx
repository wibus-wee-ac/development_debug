import '../styles.css'

import { ShortcutProvider } from '@renderer/lib/shortcut-provider'
import { AnchoredToastProvider, ToastProvider } from '@renderer/components/ui/toast'
import { useThemeStore } from '@renderer/store/theme'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const mode = useThemeStore(s => s.mode)

  useEffect(() => {
    const applyDark = (dark: boolean): void => {
      document.documentElement.classList.toggle('dark', dark)
    }

    if (mode !== 'system') {
      applyDark(mode === 'dark')
      return
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    applyDark(mq.matches)
    const listener = (e: MediaQueryListEvent): void => applyDark(e.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [mode])

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <ShortcutProvider>
          <Outlet />
        </ShortcutProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  )
}
