import * as MingCuteIcons from '@mingcute/react'
import type { IconProps } from '@mingcute/react'
import { createElement, forwardRef } from 'react'

type MingCuteIcon = typeof MingCuteIcons.CheckLine

function createMingCuteIcon(Icon: MingCuteIcon) {
  return forwardRef<SVGSVGElement, IconProps>(function MingCuteIconAdapter({ color, style, ...props }, ref) {
    return createElement(Icon, { ref, ...props, style: { color, ...style } })
  })
}

export const ArrowRightLine = createMingCuteIcon(MingCuteIcons.ArrowRightLine)
export const Book2Line = createMingCuteIcon(MingCuteIcons.Book2Line)
export const Box3Line = createMingCuteIcon(MingCuteIcons.Box3Line)
export const BracesLine = createMingCuteIcon(MingCuteIcons.BracesLine)
export const BrainLine = createMingCuteIcon(MingCuteIcons.BrainLine)
export const BugLine = createMingCuteIcon(MingCuteIcons.BugLine)
export const CheckLine = createMingCuteIcon(MingCuteIcons.CheckLine)
export const ChipLine = createMingCuteIcon(MingCuteIcons.ChipLine)
export const CodeLine = createMingCuteIcon(MingCuteIcons.CodeLine)
export const CopyLine = createMingCuteIcon(MingCuteIcons.CopyLine)
export const CylinderLine = createMingCuteIcon(MingCuteIcons.CylinderLine)
export const Dashboard2Line = createMingCuteIcon(MingCuteIcons.Dashboard2Line)
export const DashboardLine = createMingCuteIcon(MingCuteIcons.DashboardLine)
export const DriveLine = createMingCuteIcon(MingCuteIcons.DriveLine)
export const ExternalLinkLine = createMingCuteIcon(MingCuteIcons.ExternalLinkLine)
export const FileCodeLine = createMingCuteIcon(MingCuteIcons.FileCodeLine)
export const FilterLine = createMingCuteIcon(MingCuteIcons.FilterLine)
export const FlashLine = createMingCuteIcon(MingCuteIcons.FlashLine)
export const GitBranchLine = createMingCuteIcon(MingCuteIcons.GitBranchLine)
export const GitPullRequestLine = createMingCuteIcon(MingCuteIcons.GitPullRequestLine)
export const HistoryLine = createMingCuteIcon(MingCuteIcons.HistoryLine)
export const LayersLine = createMingCuteIcon(MingCuteIcons.LayersLine)
export const LayoutLine = createMingCuteIcon(MingCuteIcons.LayoutLine)
export const LifebuoyLine = createMingCuteIcon(MingCuteIcons.LifebuoyLine)
export const Link2Line = createMingCuteIcon(MingCuteIcons.Link2Line)
export const Message1Line = createMingCuteIcon(MingCuteIcons.Message1Line)
export const MonitorLine = createMingCuteIcon(MingCuteIcons.MonitorLine)
export const PackageLine = createMingCuteIcon(MingCuteIcons.PackageLine)
export const PluginLine = createMingCuteIcon(MingCuteIcons.PluginLine)
export const ProcessLine = createMingCuteIcon(MingCuteIcons.ProcessLine)
export const RobotLine = createMingCuteIcon(MingCuteIcons.RobotLine)
export const RocketLine = createMingCuteIcon(MingCuteIcons.RocketLine)
export const RouteLine = createMingCuteIcon(MingCuteIcons.RouteLine)
export const SafeShieldLine = createMingCuteIcon(MingCuteIcons.SafeShieldLine)
export const ScanLine = createMingCuteIcon(MingCuteIcons.ScanLine)
export const SearchLine = createMingCuteIcon(MingCuteIcons.SearchLine)
export const ServerLine = createMingCuteIcon(MingCuteIcons.ServerLine)
export const Settings2Line = createMingCuteIcon(MingCuteIcons.Settings2Line)
export const SitemapLine = createMingCuteIcon(MingCuteIcons.SitemapLine)
export const SparklesLine = createMingCuteIcon(MingCuteIcons.SparklesLine)
export const TerminalLine = createMingCuteIcon(MingCuteIcons.TerminalLine)
export const WarningLine = createMingCuteIcon(MingCuteIcons.WarningLine)
