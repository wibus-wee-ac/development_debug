import type { TableUserConfig } from 'table'
import { getBorderCharacters, table } from 'table'
import { z } from 'zod'

import type { CliOutputFormat } from './types'

export interface PrintResultOptions {
  format: CliOutputFormat
  jsonFields?: string[]
  forceJson?: boolean
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

const ScalarCellSchema = z.union([
  z.string().transform(value => ({ text: value, scalar: true, textValue: value })),
  z.number().transform(value => ({ text: JSON.stringify(value), scalar: true, textValue: null })),
  z.boolean().transform(value => ({ text: JSON.stringify(value), scalar: true, textValue: null })),
  z.null().transform(() => ({ text: '', scalar: true, textValue: null })),
])

const CellProjectionSchema = z.union([
  ScalarCellSchema,
  z.undefined().transform(() => ({ text: '', scalar: false, textValue: null })),
  JsonValueSchema.transform(value => ({ text: JSON.stringify(value), scalar: false, textValue: null })),
])

const CliRecordSchema = z.record(z.string(), JsonValueSchema)

const RecordProjectionSchema = CliRecordSchema.transform((record) => {
  const cells = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, CellProjectionSchema.parse(value)]),
  )
  const scalarKeys = Object.entries(cells)
    .filter(([, cell]) => cell.scalar)
    .map(([key]) => key)
  const preferredText = ['markdown', 'content', 'text', 'output', 'message']
    .map(key => cells[key]?.textValue ?? null)
    .find(text => text !== null) ?? null
  const entries = Object.entries(cells)
  const singleText = entries.length === 1 ? entries[0][1].textValue : null

  return {
    raw: record,
    cells,
    scalarKeys,
    textValue: preferredText ?? singleText,
    keyValueRows: scalarKeys.map(key => [key, cells[key].text] as const),
    okOnly: record.ok === true && Object.keys(record).length === 1,
  }
})

const ResultItemProjectionSchema = z.union([
  RecordProjectionSchema.transform(record => ({ kind: 'record' as const, raw: record.raw, record })),
  JsonValueSchema.transform(value => ({ kind: 'value' as const, raw: value })),
])

const ResultProjectionSchema = z.union([
  z.array(ResultItemProjectionSchema).transform(items => ({ kind: 'array' as const, raw: items.map(item => item.raw), items })),
  RecordProjectionSchema.transform(record => ({ kind: 'record' as const, raw: record.raw, record })),
  z.string().transform(value => ({ kind: 'string' as const, raw: value, value })),
  JsonValueSchema.transform(value => ({ kind: 'value' as const, raw: value })),
])

type ResultProjection = z.infer<typeof ResultProjectionSchema>
type ResultItemProjection = z.infer<typeof ResultItemProjectionSchema>

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

function printTable(rows: ResultItemProjection[], columns: string[]): void {
  if (rows.length === 0) {
    console.log('No results')
    return
  }

  const tableRows = [
    columns,
    ...rows.map(row => columns.map(column => row.kind === 'record' ? row.record.cells[column]?.text ?? '' : '')),
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

function getTableColumns(rows: ResultItemProjection[]): string[] {
  const columns = new Set<string>()
  for (const row of rows) {
    if (row.kind === 'record') {
      for (const key of row.record.scalarKeys) {
        columns.add(key)
      }
    }
  }
  return Array.from(columns)
}

function printNdjson(result: ResultProjection): void {
  if (result.kind === 'array') {
    for (const item of result.raw) {
      console.log(JSON.stringify(item))
    }
    return
  }
  console.log(JSON.stringify(result.raw))
}

function selectFieldsFromRecord(record: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field, record[field]]))
}

function selectJsonFields(result: unknown, fields: string[] | undefined): unknown {
  if (!fields || fields.length === 0) {
    return result
  }

  const projection = ResultProjectionSchema.parse(result)

  if (projection.kind === 'array') {
    return projection.items.map(item => item.kind === 'record' ? selectFieldsFromRecord(item.record.raw, fields) : item.raw)
  }

  if (projection.kind === 'record') {
    return selectFieldsFromRecord(projection.record.raw, fields)
  }

  return result
}

function printKeyValue(rows: Array<readonly [string, string]>): boolean {
  if (rows.length === 0) {
    return false
  }

  const width = Math.max(...rows.map(([key]) => key.length))
  for (const [key, value] of rows) {
    console.log(`${key.padEnd(width)}  ${value}`)
  }
  return true
}

function printAuto(result: ResultProjection): void {
  if (result.kind === 'array') {
    const columns = getTableColumns(result.items)
    if (columns.length > 0 || result.items.length === 0) {
      printTable(result.items, columns)
      return
    }
    console.log(JSON.stringify(result.raw, null, 2))
    return
  }

  if (result.kind === 'record') {
    if (result.record.okOnly) {
      console.log('ok')
      return
    }

    if (result.record.textValue !== null) {
      console.log(result.record.textValue)
      return
    }

    if (printKeyValue(result.record.keyValueRows)) {
      return
    }
  }

  if (result.kind === 'string') {
    console.log(result.value)
    return
  }

  console.log(JSON.stringify(result.raw, null, 2))
}

export function printResult(result: unknown, options: PrintResultOptions): void {
  const selectedResult = selectJsonFields(result, options.jsonFields)
  const projection = ResultProjectionSchema.parse(selectedResult)

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
    printNdjson(projection)
    return
  }

  if (format === 'table' && projection.kind === 'array') {
    const columns = getTableColumns(projection.items)
    if (columns.length > 0 || projection.items.length === 0) {
      printTable(projection.items, columns)
      return
    }
  }

  if (format === 'auto') {
    printAuto(projection)
    return
  }

  console.log(JSON.stringify(selectedResult, null, 2))
}
