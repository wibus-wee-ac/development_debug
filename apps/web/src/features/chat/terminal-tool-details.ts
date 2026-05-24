/**
 * Output: Shared terminal tool detail predicates and output section helpers.
 * Input: Tool input, output, error text, and optional streaming arguments text.
 * Position: Chat feature helper used by tool call block renderers.
 */

import type { ToolPayload } from './tool-ui-classifier'
import { readToolInputPayload, ToolPayloadSchema } from './tool-ui-classifier'

export interface TerminalOutputSection {
  label: string
  text: string
  destructive: boolean
}

export function readTerminalOutputSections(output: ToolPayload, errorText?: string): TerminalOutputSection[] {
  const sections: TerminalOutputSection[] = []
  const stderr = output.stderr
  const stdout = output.stdout
  const fallback = output.rawText ?? output.outputText ?? output.contentText ?? output.text

  if (errorText) {
    sections.push({ label: 'Error', text: errorText, destructive: true })
  }
  if (stderr && stderr !== errorText) {
    sections.push({ label: 'stderr', text: stderr, destructive: true })
  }
  if (stdout) {
    sections.push({ label: 'stdout', text: stdout, destructive: false })
  }
  if (fallback && fallback !== stdout && fallback !== stderr && fallback !== errorText) {
    sections.push({ label: 'output', text: fallback, destructive: false })
  }

  return sections
}

export function summarizeTerminalOutput(sections: TerminalOutputSection[]): string {
  const lineCount = sections.reduce((total, section) => {
    return total + section.text.split('\n').length
  }, 0)
  const labels = sections.map(section => section.label).join(' + ')
  return `${labels} · ${formatCount(lineCount, 'line')}`
}

export function hasTerminalDetails(input: unknown, output: unknown, errorText?: string, argumentsText?: string): boolean {
  const inputPayload = readToolInputPayload(input, argumentsText)
  const outputPayload = ToolPayloadSchema.parse(output)
  return inputPayload.command !== null
    || inputPayload.timeout !== null
    || outputPayload.backgroundTaskId !== null
    || readTerminalOutputSections(outputPayload, errorText).length > 0
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}
