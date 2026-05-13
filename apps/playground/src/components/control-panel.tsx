import type { AnimationPresetName, SmoothPreset } from '@cradle/streamdown'
import { PRESETS } from '@cradle/streamdown'
import { useEffect, useRef } from 'react'
import { Pane } from 'tweakpane'
import * as EssentialsPlugin from '@tweakpane/plugin-essentials'

import type { SampleSource } from '../data/samples'
import { SAMPLES } from '../data/samples'

interface ControlPanelProps {
  preset: SmoothPreset
  onPresetChange: (p: SmoothPreset) => void
  animateMode: 'char' | 'word'
  onAnimateModeChange: (m: 'char' | 'word') => void
  animationPreset: AnimationPresetName
  onAnimationPresetChange: (p: AnimationPresetName) => void
  showCursor: boolean
  onShowCursorChange: (v: boolean) => void
  cps: number
  onCpsChange: (c: number) => void
  sampleId: string
  onSampleChange: (id: string) => void
  streaming: boolean
  onStart: () => void
  onStop: () => void
  onReset: () => void
  showProfiler: boolean
  onProfilerChange: (v: boolean) => void
  dark: boolean
  onDarkChange: (v: boolean) => void
}

export function ControlPanel({
  preset,
  onPresetChange,
  animateMode,
  onAnimateModeChange,
  animationPreset,
  onAnimationPresetChange,
  showCursor,
  onShowCursorChange,
  cps,
  onCpsChange,
  sampleId,
  onSampleChange,
  streaming,
  onStart,
  onStop,
  onReset,
  showProfiler,
  onProfilerChange,
  dark,
  onDarkChange,
}: ControlPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<Pane | null>(null)
  const paramsRef = useRef({
    preset,
    animateMode,
    animationPreset,
    showCursor,
    cps,
    sampleId,
    showProfiler,
    dark,
  })

  // Use refs for callbacks to avoid stale closures in Tweakpane
  const callbacksRef = useRef({
    onStart, onStop, onReset, onPresetChange, onAnimateModeChange,
    onAnimationPresetChange, onShowCursorChange, onCpsChange, onSampleChange, onProfilerChange, onDarkChange,
  })
  callbacksRef.current = {
    onStart, onStop, onReset, onPresetChange, onAnimateModeChange,
    onAnimationPresetChange, onShowCursorChange, onCpsChange, onSampleChange, onProfilerChange, onDarkChange,
  }

  // Keep params ref in sync
  paramsRef.current = {
    preset,
    animateMode,
    animationPreset,
    showCursor,
    cps,
    sampleId,
    showProfiler,
    dark,
  }

  useEffect(() => {
    if (!containerRef.current) return

    const pane = new Pane({
      container: containerRef.current,
      title: 'Streamdown Playground',
    })
    pane.registerPlugin(EssentialsPlugin)
    paneRef.current = pane

    // --- Source ---
    const sourceFolder = pane.addFolder({ title: 'Source' })
    const sampleOptions: Record<string, string> = {}
    SAMPLES.forEach((s: SampleSource) => { sampleOptions[s.label] = s.id })
    sourceFolder.addBinding(paramsRef.current, 'sampleId', {
      label: 'Sample',
      options: sampleOptions,
    }).on('change', (ev) => { callbacksRef.current.onSampleChange(ev.value) })

    sourceFolder.addBinding(paramsRef.current, 'cps', {
      label: 'CPS',
      min: 10,
      max: 300,
      step: 1,
    }).on('change', (ev) => { callbacksRef.current.onCpsChange(ev.value) })

    // --- Smoothing ---
    const smoothFolder = pane.addFolder({ title: 'CPS Smoothing' })
    smoothFolder.addBinding(paramsRef.current, 'preset', {
      label: 'Preset',
      options: { balanced: 'balanced', realtime: 'realtime', silky: 'silky' },
    }).on('change', (ev) => { callbacksRef.current.onPresetChange(ev.value as SmoothPreset) })

    // --- Animation ---
    const animFolder = pane.addFolder({ title: 'Animation' })
    animFolder.addBinding(paramsRef.current, 'animationPreset', {
      label: 'Preset',
      options: { minimal: 'minimal', balanced: 'balanced', dramatic: 'dramatic' },
    }).on('change', (ev) => { callbacksRef.current.onAnimationPresetChange(ev.value as AnimationPresetName) })

    animFolder.addBinding(paramsRef.current, 'animateMode', {
      label: 'Granularity',
      options: { word: 'word', char: 'char' },
    }).on('change', (ev) => { callbacksRef.current.onAnimateModeChange(ev.value as 'char' | 'word') })

    animFolder.addBinding(paramsRef.current, 'showCursor', {
      label: 'Show Cursor',
    }).on('change', (ev) => { callbacksRef.current.onShowCursorChange(ev.value as boolean) })

    // Show resolved preset info (read-only)
    const resolved = PRESETS[animationPreset]
    const infoFolder = animFolder.addFolder({ title: 'Resolved Preset', expanded: false })
    infoFolder.addBinding({ fadeDuration: resolved.fadeDuration }, 'fadeDuration', {
      label: 'Fade Duration',
      readonly: true,
    })
    infoFolder.addBinding({ timingFunction: resolved.timingFunction }, 'timingFunction', {
      label: 'Timing Fn',
      readonly: true,
    })
    infoFolder.addBinding({ blockGlow: resolved.blockGlow }, 'blockGlow', {
      label: 'Block Glow',
      readonly: true,
    })
    infoFolder.addBinding({ cursorTrail: resolved.cursorTrail }, 'cursorTrail', {
      label: 'Cursor Trail',
      readonly: true,
    })

    // --- Controls ---
    const controlFolder = pane.addFolder({ title: 'Actions' })
    controlFolder.addButton({ title: 'Stream / Continue' }).on('click', () => { callbacksRef.current.onStart() })
    controlFolder.addButton({ title: 'Stop' }).on('click', () => { callbacksRef.current.onStop() })
    controlFolder.addButton({ title: 'Reset' }).on('click', () => { callbacksRef.current.onReset() })

    // --- Display ---
    const displayFolder = pane.addFolder({ title: 'Display' })
    displayFolder.addBinding(paramsRef.current, 'showProfiler', {
      label: 'Profiler',
    }).on('change', (ev) => { callbacksRef.current.onProfilerChange(ev.value) })
    displayFolder.addBinding(paramsRef.current, 'dark', {
      label: 'Dark Mode',
    }).on('change', (ev) => { callbacksRef.current.onDarkChange(ev.value) })

    return () => {
      pane.dispose()
      paneRef.current = null
    }
    // Only rebuild pane on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refresh pane values when props change externally
  useEffect(() => {
    if (paneRef.current) {
      paneRef.current.refresh()
    }
  }, [preset, animateMode, animationPreset, showCursor, cps, sampleId, showProfiler, dark])

  return (
    <div
      ref={containerRef}
      className="fixed right-4 top-4 z-50 max-h-[calc(100vh-2rem)] w-70 overflow-y-auto"
    />
  )
}
