// Input: none (browser prompt interaction)
// Output: selectDirectory() — returns a server-side absolute path string or null
// Position: apps/web/src/lib/directory-picker.ts — web bridge for native directory selection
//           In Electron this is handled by ipc.workspace.selectDirectory(); in the browser
//           we ask the user to type the server-side path directly.

/**
 * Prompts the user to enter a server-side directory path.
 * Returns the entered path, or null if the user cancelled or left it blank.
 */
export function selectDirectory(): Promise<string | null> {
  const requestInput = window.prompt.bind(window)
  const input = requestInput('输入服务端目录的绝对路径（例如 /home/user/project）：')
  const trimmed = input?.trim()
  return Promise.resolve(trimmed || null)
}
