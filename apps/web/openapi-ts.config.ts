import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  // Requires apps/server to be running at http://localhost:21423
  input: 'http://localhost:21423/openapi.json',
  output: {
    path: './src/api-gen',
    clean: true,
    preferExportAll: true,
  },
  plugins: [
    {
      name: '@hey-api/client-fetch',
      runtimeConfigPath: '~/lib/client.config',
      exportFromIndex: true,
    },
    {
      name: '@tanstack/react-query',
    },
    {
      name: 'zod',
      responses: false,
    },
    {
      name: '@hey-api/sdk',
      validator: true,
    },
  ],
})
