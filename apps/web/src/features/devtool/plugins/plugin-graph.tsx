import { useEffect, useRef, useState } from 'react'

import { cn } from '~/lib/cn'

interface PluginGraphProps {
  plugins: Array<{
    name: string
    displayName: string
    hasServer: boolean
    hasWeb: boolean
    hasDesktop: boolean
  }>
  panels: Array<{ id: string; title: string }>
  commands: Array<{ id: string; title: string }>
}

interface NodePos {
  x: number
  y: number
  label: string
  color: string
}

const PLATFORMS = [
  { id: 'server', label: 'Server', color: '#3b82f6' },
  { id: 'web', label: 'Web', color: '#a855f7' },
  { id: 'desktop', label: 'Desktop', color: '#f59e0b' },
] as const

export function PluginGraph({ plugins, panels, commands }: PluginGraphProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50)
    return () => clearTimeout(t)
  }, [])

  if (plugins.length === 0) return null

  // Layout constants
  const W = 600
  const H = Math.max(200, plugins.length * 50 + 40)
  const leftX = 70
  const midX = W / 2
  const rightX = W - 70

  // Capabilities derived from data
  const capabilities: Array<{ id: string; label: string; count: number }> = []
  if (panels.length > 0) capabilities.push({ id: 'panels', label: `Panels (${panels.length})`, count: panels.length })
  if (commands.length > 0) capabilities.push({ id: 'commands', label: `Commands (${commands.length})`, count: commands.length })
  // Always show at least placeholder capabilities
  if (capabilities.length === 0) {
    capabilities.push({ id: 'panels', label: 'Panels (0)', count: 0 })
    capabilities.push({ id: 'commands', label: 'Commands (0)', count: 0 })
  }

  // Platform positions (left)
  const platformNodes: NodePos[] = PLATFORMS.map((p, i) => ({
    x: leftX,
    y: (H / (PLATFORMS.length + 1)) * (i + 1),
    label: p.label,
    color: p.color,
  }))

  // Plugin positions (center)
  const pluginNodes = plugins.map((p, i) => ({
    x: midX,
    y: (H / (plugins.length + 1)) * (i + 1),
    name: p.name,
    label: p.displayName || p.name,
  }))

  // Capability positions (right)
  const capNodes: NodePos[] = capabilities.map((c, i) => ({
    x: rightX,
    y: (H / (capabilities.length + 1)) * (i + 1),
    label: c.label,
    color: '#22c55e',
  }))

  // Build edges
  type Edge = { from: { x: number; y: number }; to: { x: number; y: number }; color: string; pluginName: string }
  const edges: Edge[] = []

  for (const pNode of pluginNodes) {
    const plugin = plugins.find(p => p.name === pNode.name)!
    // Edges to platforms
    if (plugin.hasServer) {
      edges.push({ from: pNode, to: platformNodes[0], color: PLATFORMS[0].color, pluginName: pNode.name })
    }
    if (plugin.hasWeb) {
      edges.push({ from: pNode, to: platformNodes[1], color: PLATFORMS[1].color, pluginName: pNode.name })
    }
    if (plugin.hasDesktop) {
      edges.push({ from: pNode, to: platformNodes[2], color: PLATFORMS[2].color, pluginName: pNode.name })
    }
    // Edges to capabilities only for plugins that have web (they provide panels/commands)
    if (plugin.hasWeb) {
      for (const cap of capNodes) {
        edges.push({ from: pNode, to: cap, color: '#22c55e', pluginName: pNode.name })
      }
    }
  }

  function bezierPath(from: { x: number; y: number }, to: { x: number; y: number }) {
    const dx = (to.x - from.x) / 3
    return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
  }

  function edgeOpacity(edge: Edge) {
    if (!hovered) return mounted ? 0.3 : 0
    return edge.pluginName === hovered ? 0.7 : 0.08
  }

  return (
    <div className="mb-4 w-full overflow-hidden rounded border border-border">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: `${Math.min(H, 250)}px` }}
      >
        {/* Edges */}
        {edges.map((edge, i) => (
          <path
            key={i}
            d={bezierPath(edge.from, edge.to)}
            fill="none"
            stroke={edge.color}
            strokeWidth={1.5}
            opacity={edgeOpacity(edge)}
            className="transition-opacity duration-300"
          />
        ))}

        {/* Platform nodes (left) */}
        {platformNodes.map((node, i) => (
          <g key={`platform-${i}`}>
            <rect
              x={node.x - 40}
              y={node.y - 12}
              width={80}
              height={24}
              rx={4}
              fill="currentColor"
              className="text-fill"
              stroke={node.color}
              strokeWidth={1}
              opacity={0.9}
            />
            <text
              x={node.x}
              y={node.y + 4}
              textAnchor="middle"
              fill={node.color}
              fontSize={10}
              fontFamily="monospace"
            >
              {node.label}
            </text>
          </g>
        ))}

        {/* Plugin nodes (center) */}
        {pluginNodes.map((node, i) => (
          <g
            key={`plugin-${i}`}
            onMouseEnter={() => setHovered(node.name)}
            onMouseLeave={() => setHovered(null)}
            className="cursor-pointer"
          >
            <rect
              x={node.x - 55}
              y={node.y - 14}
              width={110}
              height={28}
              rx={4}
              fill="currentColor"
              className={cn(
                'transition-all duration-150',
                hovered === node.name ? 'text-foreground/10' : 'text-fill',
              )}
              stroke="currentColor"
              strokeWidth={1}
              style={{ stroke: hovered === node.name ? 'var(--color-foreground)' : 'var(--color-border)' }}
            />
            <text
              x={node.x}
              y={node.y + 4}
              textAnchor="middle"
              fill="currentColor"
              className="text-foreground"
              fontSize={11}
              fontFamily="monospace"
              fontWeight={hovered === node.name ? 600 : 400}
            >
              {node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label}
            </text>
          </g>
        ))}

        {/* Capability nodes (right) */}
        {capNodes.map((node, i) => (
          <g key={`cap-${i}`}>
            <rect
              x={node.x - 50}
              y={node.y - 12}
              width={100}
              height={24}
              rx={4}
              fill="currentColor"
              className="text-fill"
              stroke={node.color}
              strokeWidth={1}
              opacity={0.9}
            />
            <text
              x={node.x}
              y={node.y + 4}
              textAnchor="middle"
              fill={node.color}
              fontSize={10}
              fontFamily="monospace"
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
