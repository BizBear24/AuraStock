import { csvSafe, type Table } from '@/domain/export'
import { MAX_IMPORT_ROWS, tableFromGrid, type RawTable } from '@/domain/import'

export const MAX_FILE_BYTES = 5 * 1024 * 1024

// ------------------------------------------------------------------ writing

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`)
}

/** CSV with a UTF-8 byte-order mark so Excel opens accented text correctly. */
export async function toCsv(table: Table): Promise<Blob> {
  const Papa = (await import('papaparse')).default
  const data = table.rows.map((row) => row.map((v, i) => (typeof v === 'string' && table.columns[i]?.kind === 'text' ? csvSafe(v) : v)))
  const text = Papa.unparse({ fields: table.columns.map((c) => c.header), data }, { quotes: true, newline: '\r\n' })
  return new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' })
}

/** XLSX with a bold frozen header row, auto-filter, real numbers and real dates. */
export async function toXlsx(table: Table, sheetName: string): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AuraStock'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = table.columns.map((c) => ({
    header: c.header,
    width: c.width,
    style:
      c.kind === 'number'
        ? { numFmt: '#,##0.###' }
        : c.kind === 'date'
          ? { numFmt: 'yyyy-mm-dd' }
          : c.kind === 'datetime'
            ? { numFmt: 'yyyy-mm-dd hh:mm' }
            : {},
  }))
  for (const row of table.rows) {
    sheet.addRow(
      row.map((v, i) => {
        if (v === null) return null
        const kind = table.columns[i]?.kind
        if (kind === 'date') return isoDate(v as string)
        if (kind === 'datetime') return new Date(v as string)
        return v
      }),
    )
  }
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.alignment = { vertical: 'middle' }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEDE9' } }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.columns.length } }
  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Filesystem-safe file name stem. */
export function fileStem(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export'
}

// ------------------------------------------------------------------ reading

export async function parseCsv(text: string): Promise<RawTable> {
  const Papa = (await import('papaparse')).default
  const result = Papa.parse<string[]>(text.replace(/^\ufeff/, ''), { skipEmptyLines: 'greedy' })
  const fatal = result.errors.find((e) => e.type === 'Quotes' || e.type === 'Delimiter')
  if (fatal && result.data.length === 0 && text.trim() !== '') throw new Error(`The CSV file could not be read: ${fatal.message}`)
  return finish(result.data.map((r) => r.map((c) => String(c ?? ''))))
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const v = value as { richText?: { text: string }[]; text?: unknown; result?: unknown; formula?: unknown }
    if (v.richText) return v.richText.map((r) => r.text).join('')
    if (v.result !== undefined) return cellText(v.result)
    if (v.text !== undefined) return cellText(v.text)
    return ''
  }
  return String(value)
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<RawTable> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch {
    throw new Error('The file is not a valid .xlsx workbook.')
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('The workbook has no sheets.')
  const grid: string[][] = []
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = []
    for (let c = 1; c <= sheet.columnCount; c += 1) cells.push(cellText(row.getCell(c).value))
    grid.push(cells)
  })
  return finish(grid)
}

function finish(grid: string[][]): RawTable {
  const table = tableFromGrid(grid)
  if (table.headers.length === 0) throw new Error('The file is empty.')
  if (table.rows.length === 0) throw new Error('The file has a header row but no data rows.')
  if (table.rows.length > MAX_IMPORT_ROWS * 4) {
    throw new Error(`The file has too many rows. Split it into files of at most ${MAX_IMPORT_ROWS} rows.`)
  }
  return table
}

export async function readTable(file: File): Promise<RawTable> {
  if (file.size > MAX_FILE_BYTES) throw new Error('The file is larger than 5 MB. Split it into smaller files.')
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) return parseXlsx(await file.arrayBuffer())
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') return parseCsv(await file.text())
  throw new Error('Unsupported file type. Choose a .csv or .xlsx file.')
}
