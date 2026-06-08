import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: '../server/openapi.json',
  output: {
    path: './src/generated/cradle-api',
    clean: true,
    preferExportAll: true,
  },
  plugins: [
    {
      name: '@hey-api/client-fetch',
      exportFromIndex: true,
    },
    {
      name: '@hey-api/sdk',
    },
  ],
})
