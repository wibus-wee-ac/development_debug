/** @type {import('@cucumber/cucumber').IConfiguration} */
export default {
  paths: ['e2e/src/features/**/*.feature'],
  import: ['e2e/src/steps/**/*.ts', 'e2e/src/support/**/*.ts'],
  format: ['progress-bar', 'html:e2e/artifacts/cucumber-report.html'],
  formatOptions: { snippetInterface: 'async-await' },
  loader: ['tsx/esm'],
  parallel: 1,
  publishQuiet: true,
  retry: 0,
  timeout: 30_000,
  worldParameters: {
    /** Path to the Electron main bundle (built). */
    appPath: './out/main/index.js',
    /** Extra Electron launch args (e.g. for headless CI). */
    appArgs: [],
  },
}
