import * as MingCuteIcons from '@mingcute/react'
import type { IconProps } from '@mingcute/react'
import { createElement, forwardRef } from 'react'

type MingCuteIcon = typeof MingCuteIcons.CheckLine

function createMingCuteIcon(Icon: MingCuteIcon) {
  return forwardRef<SVGSVGElement, IconProps>(function MingCuteIconAdapter({ color, style, ...props }, ref) {
    return createElement(Icon, { ref, ...props, style: { color, ...style } })
  })
}

export const AlertLine = createMingCuteIcon(MingCuteIcons.AlertLine)
export const ChipLine = createMingCuteIcon(MingCuteIcons.ChipLine)
export const Dashboard2Line = createMingCuteIcon(MingCuteIcons.Dashboard2Line)
export const DriveLine = createMingCuteIcon(MingCuteIcons.DriveLine)
export const HeartbeatLine = createMingCuteIcon(MingCuteIcons.HeartbeatLine)
export const MonitorLine = createMingCuteIcon(MingCuteIcons.MonitorLine)
export const Refresh1Line = createMingCuteIcon(MingCuteIcons.Refresh1Line)
export const ServerLine = createMingCuteIcon(MingCuteIcons.ServerLine)
export const TerminalLine = createMingCuteIcon(MingCuteIcons.TerminalLine)
export const UsbFlashDiskLine = createMingCuteIcon(MingCuteIcons.UsbFlashDiskLine)
