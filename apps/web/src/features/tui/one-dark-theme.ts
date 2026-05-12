// Input: none (pure constant — One Dark colour palette for xterm.js ITheme)
// Output: oneDarkTheme — ITheme object for @xterm/xterm Terminal constructor
// Position: Shared terminal theme used by TuiView

import type { ITheme } from '@xterm/xterm'

export const oneDarkTheme: ITheme = {
  background: '#282c34',
  foreground: '#abb2bf',
  cursor: '#528bff',
  cursorAccent: '#282c34',
  selectionBackground: '#3e4451',
  // Normal colours (ANSI 0-7)
  black: '#2d3139',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#d19a66',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  // Bright colours (ANSI 8-15)
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
}
