// Input: IpcService base plus feature-owned agent runtime application service
// Output: AgentRuntimeService IPC adapter for unified agent profiles, probes, models, and credentials
// Position: App-level IPC adapter for the agent-runtime feature

import { IpcMethod, IpcService } from '@cradle/ipc'

import { getDb } from '../../db'
import type {
  AgentRuntimeApplicationService,
  EditableAgentProfile,
} from '../../features/agent-runtime/agent-runtime'
import {
  createAgentRuntimeApplicationService,
  createDbAgentProfileStore,
  createDbCredentialStore,
  createDbRuntimeAuditStore,
} from '../../features/agent-runtime/agent-runtime'
import { getBackendControlPlaneService } from '../../features/backend-control-plane/backend-control-plane'
import { getProviderCatalog } from '../../features/agent-runtime/catalog-instance'
import type {
  CredentialMetadata,
  SaveCredentialInput,
} from '../../features/agent-runtime/credential-vault'
import type {
  AgentProfile,
  ModelDescriptor,
  ProviderProbeResult,
} from '../../features/agent-runtime/runtime-provider-types'
import { decryptSecret, encryptSecret } from '../../platform/storage/safe-storage'

function createDefaultAgentRuntimeApplication(): AgentRuntimeApplicationService {
  const db = getDb()
  return createAgentRuntimeApplicationService({
    profileStore: createDbAgentProfileStore(db),
    credentialStore: createDbCredentialStore(db, {
      encrypt: encryptSecret,
      decrypt: decryptSecret,
    }),
    auditStore: createDbRuntimeAuditStore(db),
    capabilityRecorder: getBackendControlPlaneService(),
    catalog: getProviderCatalog(),
  })
}

export class AgentRuntimeService extends IpcService {
  static readonly groupName = 'agentRuntime'

  private readonly appService: AgentRuntimeApplicationService

  constructor(appService: AgentRuntimeApplicationService = createDefaultAgentRuntimeApplication()) {
    super()
    this.appService = appService
  }

  @IpcMethod()
  listProfiles(): AgentProfile[] {
    return this.appService.listProfiles()
  }

  @IpcMethod()
  getProfile(id: string): AgentProfile | undefined {
    return this.appService.getProfile(id)
  }

  @IpcMethod()
  upsertProfile(input: EditableAgentProfile): AgentProfile {
    return this.appService.upsertProfile(input)
  }

  @IpcMethod()
  removeProfile(id: string): void {
    this.appService.removeProfile(id)
  }

  @IpcMethod()
  async probeProfile(id: string): Promise<ProviderProbeResult> {
    return this.appService.probeProfile(id)
  }

  @IpcMethod()
  async listModels(id: string): Promise<ModelDescriptor[]> {
    return this.appService.listModels(id)
  }

  @IpcMethod()
  saveCredential(input: SaveCredentialInput): CredentialMetadata {
    return this.appService.saveCredential(input)
  }

  @IpcMethod()
  removeCredential(id: string): void {
    this.appService.removeCredential(id)
  }

  @IpcMethod()
  listCredentials(): CredentialMetadata[] {
    return this.appService.listCredentials()
  }
}
