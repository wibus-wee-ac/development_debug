// Input: skills controller and services
// Output: skills module registration
// Position: apps/server/src/modules/skills/skills.module.ts

import { Module } from '@tsuki-hono/common'

import { SkillsController } from './skills.controller'
import { SkillsService } from './skills.service'

@Module({
  controllers: [SkillsController],
  providers: [SkillsService],
})
export class SkillsModule {}
