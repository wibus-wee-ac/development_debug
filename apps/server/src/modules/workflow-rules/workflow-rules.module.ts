// Input: workflow-rules controller and providers
// Output: workflow-rules module registration
// Position: apps/server/src/modules/workflow-rules/workflow-rules.module.ts

import { Module } from '@tsuki-hono/common'

import { WorkflowRulesConfig } from './workflow-rules.config'
import { WorkflowRulesController } from './workflow-rules.controller'
import { WorkflowRulesService } from './workflow-rules.service'
import { WorkflowRulesStore } from './workflow-rules.store'

@Module({
  controllers: [WorkflowRulesController],
  providers: [WorkflowRulesConfig, WorkflowRulesService, WorkflowRulesStore],
})
export class WorkflowRulesModule {}
