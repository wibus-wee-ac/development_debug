import { domAnimation, LazyMotion } from 'motion/react'
import { useEffect } from 'react'

import { ToastProvider } from '~/components/ui/toast'
import { TooltipProvider } from '~/components/ui/tooltip'
import { DirectoryPickerProvider } from '~/features/filesystem/directory-picker-provider'
import { ShortcutProvider } from '~/lib/shortcut-provider'
import { useThemeStore } from '~/store/theme'

export function AppEnvironmentProviders({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation}>
      <ToastProvider>
        <TooltipProvider>
          <ShortcutProvider>
            <DirectoryPickerProvider>{children}</DirectoryPickerProvider>
          </ShortcutProvider>
        </TooltipProvider>
      </ToastProvider>
    </LazyMotion>
  )
}

export function useThemeClass(): void {
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
}
