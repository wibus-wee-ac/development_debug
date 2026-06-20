import * as MingCuteIcons from '@mingcute/react'
import type { IconProps } from '@mingcute/react'
import { createElement, forwardRef } from 'react'

type MingCuteIcon = typeof MingCuteIcons.CheckLine

function createMingCuteIcon(Icon: MingCuteIcon) {
  return forwardRef<SVGSVGElement, IconProps>(function MingCuteIconAdapter({ color, style, ...props }, ref) {
    return createElement(Icon, { ref, ...props, style: { color, ...style } })
  })
}

export const CheckCircleLine = createMingCuteIcon(MingCuteIcons.CheckCircleLine)
export const ClockLine = createMingCuteIcon(MingCuteIcons.ClockLine)
export const CloseLine = createMingCuteIcon(MingCuteIcons.CloseLine)
export const DownloadLine = createMingCuteIcon(MingCuteIcons.DownloadLine)
export const EyeLine = createMingCuteIcon(MingCuteIcons.EyeLine)
export const FlashLine = createMingCuteIcon(MingCuteIcons.FlashLine)
export const LayersLine = createMingCuteIcon(MingCuteIcons.LayersLine)
export const Message1Line = createMingCuteIcon(MingCuteIcons.Message1Line)
export const PlayLine = createMingCuteIcon(MingCuteIcons.PlayLine)
export const Plugin2Line = createMingCuteIcon(MingCuteIcons.Plugin2Line)
export const PlusLine = createMingCuteIcon(MingCuteIcons.PlusLine)
export const ProcessLine = createMingCuteIcon(MingCuteIcons.ProcessLine)
export const PuzzledLine = createMingCuteIcon(MingCuteIcons.PuzzledLine)
export const Refresh1Line = createMingCuteIcon(MingCuteIcons.Refresh1Line)
export const ShieldLine = createMingCuteIcon(MingCuteIcons.ShieldLine)
export const SquareLine = createMingCuteIcon(MingCuteIcons.SquareLine)
export const SubtractLine = createMingCuteIcon(MingCuteIcons.SubtractLine)
export const TerminalLine = createMingCuteIcon(MingCuteIcons.TerminalLine)
