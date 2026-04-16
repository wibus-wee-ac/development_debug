import type { ITestCaseHookParameter } from '@cucumber/cucumber'
import { After, Before, Status } from '@cucumber/cucumber'

import type { CradleWorld } from './world.ts'

Before(async function (this: CradleWorld) {
  await this.launch()
})

After(async function (this: CradleWorld, scenario: ITestCaseHookParameter) {
  // Capture a screenshot on failure for debugging
  if (scenario.result?.status === Status.FAILED && this.page) {
    const screenshot = await this.page.screenshot()
    await this.attach(screenshot, 'image/png')
  }

  await this.close()
})
