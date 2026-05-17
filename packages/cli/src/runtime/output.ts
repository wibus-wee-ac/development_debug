// Input: command result payloads and output preferences
// Output: stdout rendering for JSON, tables, and acknowledgements
// Position: packages/cli runtime presentation helper

import type { TableUserConfig } from 'table'
import { getBorderCharacters, table } from 'table'

import type { CliOutputFormat } from './types'

export interface PrintResultOptions {
  format: CliOutputFormat
  jsonFields?: string[]
  forceJson?: boolean
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isScalar(value: unknown): boolean {
  return value === null || ['boolean', 'number', 'string'].includes(typeof value)
}

function readValue(row: unknown, key: string): string {
  if (!isPlainRecord(row)) {
    return ''
  }
  const value = row[key]
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value)
}

function getDisplayWidth(value: string): number {
  return value.length
}

function getTableWidthLimit(): number {
  return Math.max(80, Math.min(process.stdout.columns || 120, 160))
}

function getColumnWidths(rows: string[][]): Record<number, { truncate: number, width: number }> {
  const columnCount = rows[0]?.length ?? 0
  if (columnCount === 0) {
    return {}
  }

  const paddingWidth = columnCount * 2
  const borderWidth = columnCount + 1
  const availableWidth = Math.max(columnCount * 8, getTableWidthLimit() - paddingWidth - borderWidth)
  const measuredWidths = Array.from({ length: columnCount }, (_, index) => {
    return Math.max(...rows.map(row => getDisplayWidth(row[index] ?? '')))
  })
  const maximumWidths = measuredWidths.map(width => Math.min(56, width))
  const minimumWidths = measuredWidths.map(width => Math.min(width, 12))
  const minimumTotal = minimumWidths.reduce((sum, width) => sum + width, 0)
  const maximumTotal = maximumWidths.reduce((sum, width) => sum + width, 0)

  if (maximumTotal <= availableWidth) {
    return Object.fromEntries(maximumWidths.map((width, index) => [index, { truncate: width, width }]))
  }

  const flexibleTotal = maximumWidths.reduce((sum, width, index) => {
    return sum + Math.max(0, width - minimumWidths[index])
  }, 0)
  const remainingWidth = Math.max(0, availableWidth - minimumTotal)

  return Object.fromEntries(Array.from({ length: columnCount }, (_, index) => {
    const flexibleWidth = Math.max(0, maximumWidths[index] - minimumWidths[index])
    const extraWidth = flexibleTotal === 0
      ? 0
      : Math.floor((flexibleWidth / flexibleTotal) * remainingWidth)
    const width = Math.max(8, Math.min(maximumWidths[index], minimumWidths[index] + extraWidth))
    return [index, { truncate: width, width }]
  }))
}

function printTable(rows: unknown[], columns: string[]): void {
  if (rows.length === 0) {
    console.log('No results')
    return
  }

  const tableRows = [
    columns,
    ...rows.map(row => columns.map(column => readValue(row, column))),
  ]
  const config = {
    border: getBorderCharacters('norc'),
    columnDefault: {
      paddingLeft: 1,
      paddingRight: 1,
      wrapWord: false,
    },
    columns: getColumnWidths(tableRows),
    drawHorizontalLine: (index: number) => index === 0 || index === 1 || index === tableRows.length,
  } satisfies TableUserConfig

  console.log(table(tableRows, config).trimEnd())
}

function getTableColumns(rows: unknown[]): string[] {
  const columns = new Set<string>()
  for (const row of rows) {
    if (!isPlainRecord(row)) {
      continue
    }
    for (const [key, value] of Object.entries(row)) {
      if (isScalar(value)) {
        columns.add(key)
      }
    }
  }
  return Array.from(columns)
}

function printNdjson(result: unknown): void {
  if (Array.isArray(result)) {
    for (const item of result) {
      console.log(JSON.stringify(item))
    }
    return
  }
  console.log(JSON.stringify(result))
}

function selectFieldsFromRecord(record: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field, record[field]]))
}

function selectJsonFields(result: unknown, fields: string[] | undefined): unknown {
  if (!fields || fields.length === 0) {
    return result
  }

  if (Array.isArray(result)) {
    return result.map(item => isPlainRecord(item) ? selectFieldsFromRecord(item, fields) : item)
  }

  if (isPlainRecord(result)) {
    return selectFieldsFromRecord(result, fields)
  }

  return result
}

function getTextValue(record: Record<string, unknown>): string | undefined {
  const preferredKeys = ['markdown', 'content', 'text', 'output', 'message']
  for (const key of preferredKeys) {
    const value = record[key]
    if (typeof value === 'string') {
      return value
    }
  }

  const entries = Object.entries(record)
  if (entries.length === 1 && typeof entries[0][1] === 'string') {
    return entries[0][1]
  }

  return undefined
}

function printKeyValue(record: Record<string, unknown>): boolean {
  const entries = Object.entries(record).filter(([, value]) => isScalar(value))
  if (entries.length === 0) {
    return false
  }

  const width = Math.max(...entries.map(([key]) => key.length))
  for (const [key, value] of entries) {
    console.log(`${key.padEnd(width)}  ${value ?? ''}`)
  }
  return true
}

function printAuto(result: unknown): void {
  if (Array.isArray(result)) {
    const columns = getTableColumns(result)
    if (columns.length > 0 || result.length === 0) {
      printTable(result, columns)
      return
    }
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (isPlainRecord(result)) {
    if (result.ok === true && Object.keys(result).length === 1) {
      console.log('ok')
      return
    }

    const textValue = getTextValue(result)
    if (textValue !== undefined) {
      console.log(textValue)
      return
    }

    if (printKeyValue(result)) {
      return
    }
  }

  if (typeof result === 'string') {
    console.log(result)
    return
  }

  console.log(JSON.stringify(result, null, 2))
}

export function printResult(result: unknown, options: PrintResultOptions): void {
  const selectedResult = selectJsonFields(result, options.jsonFields)

  if (options.forceJson) {
    console.log(JSON.stringify(selectedResult, null, 2))
    return
  }

  const format = options.format

  if (format === 'json') {
    console.log(JSON.stringify(selectedResult))
    return
  }

  if (format === 'pretty') {
    console.log(JSON.stringify(selectedResult, null, 2))
    return
  }

  if (format === 'ndjson') {
    printNdjson(selectedResult)
    return
  }

  if (format === 'table' && Array.isArray(selectedResult)) {
    const columns = getTableColumns(selectedResult)
    if (columns.length > 0 || selectedResult.length === 0) {
      printTable(selectedResult, columns)
      return
    }
  }

  if (format === 'auto') {
    printAuto(selectedResult)
    return
  }

  console.log(JSON.stringify(selectedResult, null, 2))
}
