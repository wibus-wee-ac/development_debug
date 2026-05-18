import { useMemo } from 'react'
import { Handle, Position, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

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

// --- Custom Node Components ---

const PLATFORM_COLORS: Record<string, string> = {
  server: '#3b82f6',
  web: '#a855f7',
  desktop: '#f59e0b',
}

function PlatformNode({ data }: { data: { label: string; color: string } }) {
  return (
    <div
      className="flex items-center justify-center rounded-full px-3 py-1"
      style={{
        border: `1.5px solid ${data.color}`,
        background: `${data.color}15`,
      }}
    >
      <span
        className="font-mono text-[11px] font-medium"
        style={{ color: data.color }}
      >
        {data.label}
      </span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 1, height: 1 }} />
    </div>
  )
}

function PluginNode({ data }: { data: { label: string; active: boolean; version?: string } }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md px-3 py-1.5"
      style={{
        background: 'var(--color-fill)',
        border: '1px solid var(--color-border)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 1, height: 1 }} />
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ background: data.active ? '#22c55e' : '#6b7280' }}
      />
      <span className="font-mono text-[11px]" style={{ color: 'var(--color-foreground)' }}>
        {data.label}
      </span>
      {data.version && (
        <span className="font-mono text-[9px]" style={{ color: 'var(--color-foreground)', opacity: 0.4 }}>
          {data.version}
        </span>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 1, height: 1 }} />
    </div>
  )
}

function CapabilityNode({ data }: { data: { label: string } }) {
  return (
    <div
      className="flex items-center justify-center rounded-full px-3 py-1"
      style={{
        border: '1.5px solid #22c55e',
        background: '#22c55e15',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 1, height: 1 }} />
      <span className="font-mono text-[11px] font-medium" style={{ color: '#22c55e' }}>
        {data.label}
      </span>
    </div>
  )
}

const nodeTypes = {
  platform: PlatformNode,
  plugin: PluginNode,
  capability: CapabilityNode,
}

// --- Main Component ---

export function PluginGraph({ plugins, panels, commands }: PluginGraphProps) {
  const { nodes, edges } = useMemo(() => {
    if (plugins.length === 0) return { nodes: [], edges: [] }

    const flowNodes: Node[] = []
    const flowEdges: Edge[] = []

    // Platform nodes (left column)
    const platforms = [
      { id: 'platform-server', label: 'Server', color: PLATFORM_COLORS.server },
      { id: 'platform-web', label: 'Web', color: PLATFORM_COLORS.web },
      { id: 'platform-desktop', label: 'Desktop', color: PLATFORM_COLORS.desktop },
    ]
    const platformSpacing = 300 / (platforms.length + 1)
    for (let i = 0; i < platforms.length; i++) {
      flowNodes.push({
        id: platforms[i].id,
        type: 'platform',
        position: { x: 0, y: platformSpacing * (i + 1) - 15 },
        data: { label: platforms[i].label, color: platforms[i].color },
      })
    }

    // Plugin nodes (center column)
    const pluginSpacing = 300 / (plugins.length + 1)
    for (let i = 0; i < plugins.length; i++) {
      const p = plugins[i]
      flowNodes.push({
        id: `plugin-${p.name}`,
        type: 'plugin',
        position: { x: 220, y: pluginSpacing * (i + 1) - 15 },
        data: {
          label: p.displayName || p.name,
          active: p.hasServer || p.hasWeb || p.hasDesktop,
        },
      })

      // Edges from platform → plugin
      if (p.hasServer) {
        flowEdges.push({
          id: `e-server-${p.name}`,
          source: 'platform-server',
          target: `plugin-${p.name}`,
          type: 'smoothstep',
          style: { stroke: `${PLATFORM_COLORS.server}66`, strokeWidth: 1.5 },
          animated: true,
        })
      }
      if (p.hasWeb) {
        flowEdges.push({
          id: `e-web-${p.name}`,
          source: 'platform-web',
          target: `plugin-${p.name}`,
          type: 'smoothstep',
          style: { stroke: `${PLATFORM_COLORS.web}66`, strokeWidth: 1.5 },
          animated: true,
        })
      }
      if (p.hasDesktop) {
        flowEdges.push({
          id: `e-desktop-${p.name}`,
          source: 'platform-desktop',
          target: `plugin-${p.name}`,
          type: 'smoothstep',
          style: { stroke: `${PLATFORM_COLORS.desktop}66`, strokeWidth: 1.5 },
          animated: true,
        })
      }
    }

    // Capability nodes (right column)
    const capabilities: Array<{ id: string; label: string }> = []
    capabilities.push({ id: 'cap-panels', label: `${panels.length} Panels` })
    capabilities.push({ id: 'cap-commands', label: `${commands.length} Commands` })

    const capSpacing = 300 / (capabilities.length + 1)
    for (let i = 0; i < capabilities.length; i++) {
      flowNodes.push({
        id: capabilities[i].id,
        type: 'capability',
        position: { x: 460, y: capSpacing * (i + 1) - 15 },
        data: { label: capabilities[i].label },
      })
    }

    // Edges from plugin → capability (if plugin has web entry)
    for (const p of plugins) {
      if (p.hasWeb) {
        for (const cap of capabilities) {
          flowEdges.push({
            id: `e-${p.name}-${cap.id}`,
            source: `plugin-${p.name}`,
            target: cap.id,
            type: 'smoothstep',
            style: { stroke: '#22c55e66', strokeWidth: 1.5 },
          })
        }
      }
    }

    return { nodes: flowNodes, edges: flowEdges }
  }, [plugins, panels, commands])

  if (plugins.length === 0) return null

  return (
    <div className="mb-4 w-full overflow-hidden rounded border border-border" style={{ height: 300 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        style={{ background: 'transparent' }}
      />
    </div>
  )
}
