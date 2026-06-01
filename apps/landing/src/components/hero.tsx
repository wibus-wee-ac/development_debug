import { useEffect, useRef } from 'react'
import gsap from 'gsap'

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.hero-label',
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, delay: 0.05, ease: 'power3.out' }
      )
      gsap.fromTo(
        '.hero-heading',
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, delay: 0.1, ease: 'power3.out' }
      )
      gsap.fromTo(
        '.hero-desc',
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, delay: 0.2, ease: 'power3.out' }
      )
      gsap.fromTo(
        '.hero-ctas',
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, delay: 0.3, ease: 'power3.out' }
      )
      gsap.fromTo(
        '.hero-mockup',
        { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, delay: 0.5, ease: 'power3.out' }
      )
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} className="pt-32 pb-16">
      <div className="max-w-[960px] mx-auto px-6 text-center">
        <p className="hero-label text-[11px] text-[#8a8a8a] tracking-wide opacity-0">
          AI Development Orchestrator
        </p>
        <h1 className="hero-heading text-[clamp(2.2rem,5vw,3.5rem)] font-semibold leading-[1.15] tracking-[-0.02em] text-[#f5f5f5] mt-4 opacity-0">
          The system for orchestrating AI agents
        </h1>
        <p className="hero-desc text-[15px] text-[#a3a3a3] leading-relaxed max-w-lg mx-auto mt-5 opacity-0">
          One unified interface to dispatch, observe, and control every AI agent across your
          development workflow.
        </p>
        <div className="hero-ctas mt-8 flex gap-6 justify-center opacity-0">
          <a href="#get-started" className="text-sm text-[#f5f5f5] font-medium hover:underline">
            Get Started →
          </a>
          <a href="#docs" className="text-sm text-[#8a8a8a] hover:text-[#a3a3a3] transition-colors">
            Documentation
          </a>
        </div>
      </div>

      {/* Product Mockup */}
      <div className="hero-mockup max-w-3xl mx-auto mt-20 px-6 opacity-0">
        <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111111] overflow-hidden">
          {/* Title bar */}
          <div className="h-9 flex items-center px-3 bg-[#111111] border-b border-[rgba(255,255,255,0.06)] relative">
            <div className="flex gap-[6px]">
              <span className="w-[10px] h-[10px] rounded-full bg-[#525252]" />
              <span className="w-[10px] h-[10px] rounded-full bg-[#525252]" />
              <span className="w-[10px] h-[10px] rounded-full bg-[#525252]" />
            </div>
            <span className="absolute left-1/2 -translate-x-1/2 text-[10px] text-[#525252]">
              Cradle
            </span>
          </div>

          {/* Body */}
          <div className="grid grid-cols-[180px_1fr_200px] h-[320px]">
            {/* Sidebar */}
            <div className="bg-[#111111] px-3 py-4 space-y-2">
              <div className="h-7 flex items-center px-2 rounded bg-[rgba(255,255,255,0.08)]">
                <div className="w-24 h-3 rounded bg-[rgba(255,255,255,0.08)]" />
              </div>
              <div className="h-7 flex items-center px-2">
                <div className="w-20 h-3 rounded bg-[rgba(255,255,255,0.04)]" />
              </div>
              <div className="h-7 flex items-center px-2">
                <div className="w-16 h-3 rounded bg-[rgba(255,255,255,0.04)]" />
              </div>
              <div className="h-7 flex items-center px-2">
                <div className="w-22 h-3 rounded bg-[rgba(255,255,255,0.04)]" />
              </div>
            </div>

            {/* Main content */}
            <div className="bg-[#141414] border-x border-[rgba(255,255,255,0.06)] px-4 py-4 space-y-3">
              <div className="h-2 w-3/4 rounded-full bg-[rgba(255,255,255,0.06)]" />
              <div className="h-2 w-1/2 rounded-full bg-[rgba(255,255,255,0.06)]" />
              <div className="h-2 w-2/3 rounded-full bg-[rgba(59,130,246,0.15)]" />
              <div className="h-2 w-1/3 rounded-full bg-[rgba(255,255,255,0.06)]" />
              <div className="h-2 w-3/5 rounded-full bg-[rgba(255,255,255,0.06)]" />
              <div className="h-2 w-2/5 rounded-full bg-[rgba(255,255,255,0.06)]" />
              <div className="h-2 w-4/5 rounded-full bg-[rgba(255,255,255,0.06)]" />
              <div className="h-2 w-1/4 rounded-full bg-[rgba(255,255,255,0.06)]" />
            </div>

            {/* Right panel */}
            <div className="bg-[#111111] px-3 py-4 space-y-3">
              <div className="h-2 w-16 rounded bg-[rgba(255,255,255,0.04)]" />
              <div className="h-2 w-20 rounded bg-[rgba(255,255,255,0.04)]" />
              <div className="h-2 w-12 rounded bg-[rgba(255,255,255,0.04)]" />
              <div className="h-2 w-24 rounded bg-[rgba(255,255,255,0.04)]" />
              <div className="h-2 w-14 rounded bg-[rgba(255,255,255,0.04)]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
