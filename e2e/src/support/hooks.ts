import type { ITestCaseHookParameter } from '@cucumber/cucumber'
import { After, Before, setDefaultTimeout, Status } from '@cucumber/cucumber'

import type { CradleWorld } from './world.ts'

setDefaultTimeout(30_000)

Before({ timeout: 30_000 }, async function (this: CradleWorld) {
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
