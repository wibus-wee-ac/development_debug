// Input: saved profiles store and session lifecycle owner
// Output: profile CRUD semantics and session cleanup on delete
// Position: apps/server/src/modules/profiles/profiles.service.ts

import type { AgentProfile } from '@cradle/db'
import { inject, injectable } from 'tsyringe'

import { SessionService } from '../session/session.service'
import { ProfilesStore, type UpsertProfileInput } from './profiles.store'

@injectable()
export class ProfilesService {
  constructor(
    @inject(ProfilesStore) private readonly store: ProfilesStore,
    @inject(SessionService) private readonly sessions: SessionService,
  ) {}

  listProfiles(): AgentProfile[] {
    return this.store.listProfiles()
  }

  getProfile(id: string): AgentProfile | null {
    return this.store.getProfile(id) ?? null
  }

  upsertProfile(input: UpsertProfileInput): AgentProfile {
    return this.store.upsertProfile(input)
  }

  removeProfile(id: string): void {
    this.sessions.deleteByAgentProfile(id)
    this.store.removeProfile(id)
  }
}