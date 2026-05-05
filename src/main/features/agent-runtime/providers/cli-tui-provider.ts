// Input: AgentProfile config, PtyManager for PTY lifecycle
// Output: CliTuiProvider implementing TerminalRuntimeProvider for local CLI tools
// Position: Concrete Agent Runtime provider for `cli-tui` profiles; wraps PtyManager

import { PtyManager, ptyManager } from '../../../platform/pty/pty-manager'
import type {
  AgentProfile,
  ModelDescriptor,
  ProviderProbeResult,
  StartTerminalSessionInput,
  StopTerminalSessionInput,
  TerminalRuntimeProvider,
  TerminalSessionResult,
} from '../runtime-provider-types'

interface CliTuiConfig {
  executable?: string
  args?: string[]
  env?: Record<string, string>
}

function parseConfig(configJson: string): CliTuiConfig {
  try {
    const parsed = JSON.parse(configJson) as CliTuiConfig
    return {
      executable: typeof parsed.executable === 'string' ? parsed.executable : undefined,
      args: Array.isArray(parsed.args)
        ? parsed.args.filter(item => typeof item === 'string')
        : undefined,
      env: parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
        ? parsed.env
        : undefined,
    }
  }
  catch {
    return {}
  }
}

export class CliTuiProvider implements TerminalRuntimeProvider {
  readonly providerKind = 'cli-tui' as const

  constructor(private readonly ptyManager: PtyManager) {}

  async probe(profile: AgentProfile): Promise<ProviderProbeResult> {
    const config = parseConfig(profile.configJson)
    if (!config.executable) {
      return {
        ok: false,
        label: profile.name,
        version: null,
        details: {},
        errorText: 'CLI TUI profile requires an executable in configJson',
      }
    }
    return {
      ok: true,
      label: profile.name,
      version: null,
      details: {
        executable: config.executable,
        args: config.args ?? [],
      },
      errorText: null,
    }
  }

  async listModels(_profile: AgentProfile): Promise<ModelDescriptor[]> {
    // CLI TUI profiles are not model-based
    return []
  }

  async startTerminalSession(input: StartTerminalSessionInput): Promise<TerminalSessionResult> {
    const { sessionId, profile, workspacePath, cols, rows } = input
    const config = parseConfig(profile.configJson)

    if (!config.executable) {
      throw new Error('CLI TUI profile requires an executable in configJson')
    }

    this.ptyManager.start(
      sessionId,
      config.executable,
      config.args ?? [],
      workspacePath,
      cols,
      rows,
    )

    return { sessionId }
  }

  async stopTerminalSession(input: StopTerminalSessionInput): Promise<void> {
    this.ptyManager.stop(input.sessionId)
  }
}

export const cliTuiProvider = new CliTuiProvider(ptyManager)
