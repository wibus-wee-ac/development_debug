import { domAnimation, LazyMotion } from 'motion/react'
import { useEffect } from 'react'

import { toastManager, ToastProvider } from '~/components/ui/toast'
import { TooltipProvider } from '~/components/ui/tooltip'
import { DirectoryPickerProvider } from '~/features/filesystem/directory-picker-provider'
import { subscribeDesktopQuitGuardArmed } from '~/lib/electron'
import { ShortcutProvider } from '~/lib/shortcut-provider'
import { useResolvedThemeMode } from '~/store/theme'

export function AppEnvironmentProviders({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation}>
      <ToastProvider>
        <DesktopQuitGuardToastBridge />
        <TooltipProvider>
          <ShortcutProvider>
            <DirectoryPickerProvider>{children}</DirectoryPickerProvider>
          </ShortcutProvider>
        </TooltipProvider>
      </ToastProvider>
    </LazyMotion>
  )
}

function DesktopQuitGuardToastBridge() {
  useEffect(() => {
    return subscribeDesktopQuitGuardArmed(() => {
      toastManager.add({
        type: 'info',
        title: 'Press Command+Q again to quit',
        description: 'Cradle will quit if you repeat the shortcut now.',
      })
    })
  }, [])

  return null
}

export function useThemeClass(): void {
  const resolvedMode = useResolvedThemeMode()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedMode === 'dark')
  }, [resolvedMode])
}
