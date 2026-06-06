import { defineTab } from '@cradle/tabs-next'
import { SparklesIcon } from 'lucide-react'
import { lazy } from 'react'

const OnboardingPage = lazy(() =>
  import('~/features/onboarding/onboarding-page').then(m => ({
    default: m.OnboardingPage,
  })))

function OnboardingTabContent() {
  return <OnboardingPage />
}

export const onboardingTab = defineTab({
  type: 'onboarding' as const,
  label: 'Onboarding',
  icon: SparklesIcon,
  pinned: false,
  component: OnboardingTabContent,
})
