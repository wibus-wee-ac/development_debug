// electron.vite.config.ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginImportMap } from "@cradle/plugin-sdk/vite-plugin-import-map";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
var __electron_vite_injected_import_meta_url = "file:///Users/wibus/dev/Cradle/apps/desktop/electron.vite.config.ts";
var __dirname = dirname(fileURLToPath(__electron_vite_injected_import_meta_url));
var webRoot = resolve(__dirname, "../web");
var desktopUpdateUrl = process.env.CRADLE_DESKTOP_UPDATE_URL ?? "";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["get-port", "@cradle/ipc", "@cradle/browser-use"]
      })
    ],
    define: {
      __CRADLE_DESKTOP_UPDATE_URL__: JSON.stringify(desktopUpdateUrl)
    },
    build: {
      outDir: resolve(__dirname, "dist/main"),
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts")
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(__dirname, "dist/preload"),
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts")
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js"
        }
      }
    }
  },
  renderer: {
    root: webRoot,
    plugins: [
      tailwindcss(),
      viteReact({
        babel: {
          plugins: ["babel-plugin-react-compiler"]
        }
      }),
      pluginImportMap()
    ],
    resolve: {
      alias: {
        "~": resolve(webRoot, "src")
      }
    },
    build: {
      outDir: resolve(__dirname, "dist/renderer"),
      rollupOptions: {
        input: {
          main: resolve(webRoot, "index.html"),
          tearoff: resolve(webRoot, "tearoff.html")
        }
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
