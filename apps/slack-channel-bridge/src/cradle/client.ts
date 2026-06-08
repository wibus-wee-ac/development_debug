import { client } from '../generated/cradle-api'

export function configureCradleClient(baseUrl: string): void {
  client.setConfig({ baseUrl })
}

export { client as cradleClient }
