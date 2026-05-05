// Input: Context-specific schema modules
// Output: Canonical schema export surface for Drizzle initialization and typed table imports
// Position: Schema barrel that preserves the existing import path while splitting ownership by module

export * from './shared'
export * from './identity'
export * from './kanban'
export * from './chat'
export * from './backend-control-plane'
export * from './runtime'
export * from './acp'
export * from './issue-agent'
