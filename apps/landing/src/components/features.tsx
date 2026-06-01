import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

function FeatureSection({
  heading,
  description,
  children,
}: {
  heading: string
  description: string
  children: React.ReactNode
}) {
  const sectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return

    const ctx = gsap.context(() => {
      const textEl = el.querySelector('.feat-text')
      const visualEl = el.querySelector('.feat-visual')

      if (textEl) {
        gsap.fromTo(
          textEl,
          { y: 20, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.6,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: el,
              start: 'top 80%',
              toggleActions: 'play none none none',
            },
          }
        )
      }

      if (visualEl) {
        gsap.fromTo(
          visualEl,
          { y: 24, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            delay: 0.15,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: el,
              start: 'top 80%',
              toggleActions: 'play none none none',
            },
          }
        )
      }
    }, el)

    return () => ctx.revert()
  }, [])

  return (
    <div ref={sectionRef} className="py-32">
      <div className="max-w-[960px] mx-auto px-6 text-center">
        <div className="feat-text">
          <h2 className="text-[clamp(1.5rem,3vw,2rem)] font-semibold tracking-[-0.01em] text-[#f5f5f5]">
            {heading}
          </h2>
          <p className="text-[14px] text-[#a3a3a3] leading-relaxed max-w-md mx-auto mt-4">
            {description}
          </p>
        </div>
        <div className="feat-visual mt-14 max-w-2xl mx-auto">{children}</div>
      </div>
    </div>
  )
}

function TimelineMockup() {
  return (
    <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111111] p-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
          <div className="h-2 w-3/4 rounded-full bg-[rgba(255,255,255,0.04)]" />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
          <div className="h-2 w-1/2 rounded-full bg-[rgba(255,255,255,0.04)]" />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
          <div className="h-2 w-2/3 rounded-full bg-[rgba(255,255,255,0.04)]" />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
          <div className="h-2 w-2/5 rounded-full bg-[rgba(255,255,255,0.04)]" />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
          <div className="h-2 w-4/5 rounded-full bg-[rgba(255,255,255,0.04)]" />
        </div>
      </div>
    </div>
  )
}

function BranchingMockup() {
  return (
    <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111111] p-6">
      <div className="flex flex-col items-center gap-0">
        <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
        <div className="w-px h-8 bg-[rgba(255,255,255,0.06)]" />
        <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
        <div className="w-px h-8 bg-[rgba(255,255,255,0.06)]" />
        {/* Branch point */}
        <div className="w-3 h-3 rounded-full bg-[rgba(255,255,255,0.12)]" />
        <div className="flex gap-12 mt-0">
          <div className="flex flex-col items-center">
            <div className="w-px h-8 bg-[rgba(255,255,255,0.06)]" />
            <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
            <div className="w-px h-8 bg-[rgba(255,255,255,0.06)]" />
            <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
          </div>
          <div className="flex flex-col items-center">
            <div className="w-px h-8 bg-[rgba(255,255,255,0.06)]" />
            <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
            <div className="w-px h-8 bg-[rgba(255,255,255,0.06)]" />
            <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
            <div className="w-px h-8 bg-[rgba(255,255,255,0.06)]" />
            <div className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.08)]" />
          </div>
        </div>
      </div>
    </div>
  )
}

function StorageMockup() {
  return (
    <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111111] p-6">
      <div className="space-y-1">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-7 flex items-center gap-3 px-3 rounded"
            style={{
              background: i === 0 ? 'rgba(255,255,255,0.04)' : 'transparent',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
            }}
          >
            <div className="w-16 h-2 rounded bg-[rgba(255,255,255,0.06)]" />
            <div className="w-24 h-2 rounded bg-[rgba(255,255,255,0.04)]" />
            <div className="flex-1" />
            <div className="w-10 h-2 rounded bg-[rgba(255,255,255,0.04)]" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function Features() {
  return (
    <section>
      <FeatureSection
        heading="Real-time orchestration"
        description="Watch every agent in one live timeline. Dispatch parallel tasks, manage dependencies, and see exactly what's happening."
      >
        <TimelineMockup />
      </FeatureSection>

      <FeatureSection
        heading="Sessions that persist"
        description="Every session is checkpointed. Resume from any point, branch from any decision. No lost context, ever."
      >
        <BranchingMockup />
      </FeatureSection>

      <FeatureSection
        heading="Local-first architecture"
        description="Your code stays on your machine. SQLite-backed storage, zero network calls, full observability."
      >
        <StorageMockup />
      </FeatureSection>
    </section>
  )
}
