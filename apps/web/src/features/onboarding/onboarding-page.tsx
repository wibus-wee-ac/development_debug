import { ArrowRightLine as ArrowRightIcon } from '@mingcute/react'
import { m } from 'motion/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { useOnboardingStore } from './onboarding-store'

// Linear-style expo-out: decisive, no float.
const EASE = [0.16, 1, 0.3, 1] as const
const CRADLE_ICON_URL = '/icon.png'

export function OnboardingPage() {
  const { t } = useTranslation('onboarding')
  const complete = useOnboardingStore(s => s.complete)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') { complete() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [complete])

  return (
    <div className="fixed inset-0 z-9999 flex flex-col items-center justify-center bg-background px-6 text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center">
        <m.div
          className="mb-7 size-11 overflow-hidden rounded-[10px] ring-1 ring-border"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: EASE }}
        >
          <img src={CRADLE_ICON_URL} alt="" className="size-full object-cover" draggable={false} />
        </m.div>

        <m.h1
          className="text-center text-[clamp(2rem,5vw,2.75rem)] font-semibold leading-tight tracking-[-0.02em]"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: 0.08 }}
        >
          {t('brand.name')}
        </m.h1>

        <m.p
          className="mt-2.5 text-center text-[13.5px] leading-relaxed text-pretty text-muted-foreground"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: EASE, delay: 0.16 }}
        >
          {t('brand.slogan')}
        </m.p>

        <m.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: 0.24 }}
          className="mt-9"
        >
          <m.div whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
            <Button onClick={complete} className="h-9 gap-1.5 rounded-lg px-4 text-[13px] font-medium">
              {t('brand.cta')}
              <ArrowRightIcon className="size-3.5" />
            </Button>
          </m.div>
        </m.div>
      </div>

      <m.div
        className="absolute bottom-7 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE, delay: 0.42 }}
      >
        <kbd className="rounded border border-border bg-muted/40 px-1.5 py-0.5">↵</kbd>
        <span>to continue</span>
      </m.div>
    </div>
  )
}
