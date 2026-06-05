import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const updateServerUrl = process.env.CRADLE_DESKTOP_UPDATE_URL?.trim()
const hasAppleSigningIdentity = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)

if (!hasAppleSigningIdentity) {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
}

const keepElectronFrameworkLocales = new Set([
  'en',
  'en_GB',
  'en-US',
  'en_US',
  'es',
  'ja',
  'zh_CN',
  'zh_TW',
])

function getPublishConfig() {
  if (!updateServerUrl) {
    return undefined
  }

  return [
    {
      provider: 'generic',
      url: updateServerUrl,
    },
  ]
}

async function removeUnusedMacFrameworkLocales(context) {
  if (!['darwin', 'mas'].includes(context.electronPlatformName)) {
    return
  }

  const frameworkResources = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources',
  )

  let entries
  try {
    entries = await fs.readdir(frameworkResources)
  }
  catch {
    return
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.endsWith('.lproj')) {
        return
      }

      const locale = entry.slice(0, -'.lproj'.length)
      if (keepElectronFrameworkLocales.has(locale)) {
        return
      }

      await fs.rm(path.join(frameworkResources, entry), { recursive: true, force: true })
    }),
  )
}

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
  appId: 'com.cradle.app',
  productName: 'Cradle',

  afterPack: removeUnusedMacFrameworkLocales,

  asar: true,
  asarUnpack: [
    '**/*.node',
    '**/*.wasm',
  ],

  compression: 'maximum',
  detectUpdateChannel: true,
  generateUpdatesFilesForAllChannels: true,
  npmRebuild: false,
  publish: getPublishConfig(),

  directories: {
    buildResources: '../../resources',
    output: 'release',
  },

  files: [
    'dist/**/*',
    '!node_modules',
  ],

  extraResources: [
    {
      from: '../server/dist/desktop-runtime',
      to: 'server',
      filter: [
        '**/*',
        '!node_modules/**',
      ],
    },
    {
      from: '../server/dist/desktop-runtime/node_modules',
      to: 'server/node_modules',
      filter: ['**/*'],
    },
    {
      from: '../../packages/db/drizzle',
      to: 'drizzle',
      filter: ['**/*'],
    },
    {
      from: '../../plugins/browser-use',
      to: 'plugins/browser-use',
      filter: [
        'package.json',
        'dist/**/*',
      ],
    },
    {
      from: 'native/macos/mac-bridge/.build/cradle-dist',
      to: 'mac-bridge',
      filter: ['**/*'],
    },
  ],

  mac: {
    category: 'public.app-category.developer-tools',
    compression: 'maximum',
    entitlements: '../../build/entitlements.mac.plist',
    entitlementsInherit: '../../build/entitlements.mac.plist',
    gatekeeperAssess: false,
    hardenedRuntime: hasAppleSigningIdentity,
    ...(hasAppleSigningIdentity ? {} : { identity: null }),
    target: [
      'dmg',
      'zip',
    ],
  },

  win: {
    target: [
      'nsis',
      'zip',
    ],
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  },

  linux: {
    target: [
      'AppImage',
      'deb',
    ],
    category: 'Development',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: '${productName}-${version}-setup.${ext}',
  },
}

export default config
