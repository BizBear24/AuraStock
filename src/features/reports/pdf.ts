import type { Table } from '@/domain/export'
import { pdfText } from '@/domain/report'

export interface PdfSection {
  heading: string
  table: Table
  /** Shown instead of the table when there are no rows. */
  emptyText?: string
}

export interface PdfSpec {
  title: string
  /** e.g. organization and inventory */
  subtitle: string
  generatedAt: Date
  /** Label/value pairs shown as a summary strip under the header. */
  summary?: [string, string][]
  sections: PdfSection[]
  landscape?: boolean
}

const MARGIN = 14

function cellText(v: string | number | null, kind: string): string {
  if (v === null) return ''
  if (kind === 'number') return String(v)
  if (kind === 'date') return String(v).slice(0, 10)
  if (kind === 'datetime') {
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 16).replace('T', ' ')
  }
  return pdfText(String(v))
}

/** Build the report document. Plain black-on-white with light grey headers so it prints well in monochrome. */
export async function buildPdfDocument(spec: PdfSpec) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: spec.landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setProperties({ title: pdfText(spec.title), creator: 'AuraStock' })
  doc.setFont('helvetica', 'bold').setFontSize(16).text(pdfText(spec.title), MARGIN, 18)
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90)
  doc.text(pdfText(spec.subtitle), MARGIN, 24)
  doc.text(`Generated ${spec.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, MARGIN, 29)
  doc.setTextColor(0)
  let y = 35

  if (spec.summary?.length) {
    const colWidth = (pageWidth - MARGIN * 2) / spec.summary.length
    doc.setDrawColor(200).setLineWidth(0.2).rect(MARGIN, y, pageWidth - MARGIN * 2, 14)
    spec.summary.forEach(([label, value], i) => {
      const x = MARGIN + colWidth * i + 3
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(100).text(pdfText(label).toUpperCase(), x, y + 5)
      doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(0).text(pdfText(value), x, y + 11)
    })
    y += 20
  }

  for (const section of spec.sections) {
    if (y > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage()
      y = 18
    }
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(0).text(pdfText(section.heading), MARGIN, y)
    y += 3
    if (section.table.rows.length === 0) {
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(100).text(pdfText(section.emptyText ?? 'No data.'), MARGIN, y + 5)
      y += 12
      continue
    }
    autoTable(doc, {
      startY: y,
      head: [section.table.columns.map((c) => pdfText(c.header))],
      body: section.table.rows.map((row) => row.map((v, i) => cellText(v, section.table.columns[i]?.kind ?? 'text'))),
      margin: { left: MARGIN, right: MARGIN },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, lineColor: [217, 219, 213], lineWidth: 0.1, textColor: 20, overflow: 'linebreak' },
      headStyles: { fillColor: [236, 237, 233], textColor: 20, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 248, 246] },
      columnStyles: Object.fromEntries(
        section.table.columns.flatMap((c, i) => (c.kind === 'number' ? [[i, { halign: 'right' as const }]] : [])),
      ),
      showHead: 'everyPage',
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  }

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120)
    doc.text(`Page ${i} of ${pages}`, pageWidth - MARGIN, doc.internal.pageSize.getHeight() - 8, { align: 'right' })
    doc.text('AuraStock', MARGIN, doc.internal.pageSize.getHeight() - 8)
  }
  return doc
}

export async function buildPdf(spec: PdfSpec): Promise<Blob> {
  const doc = await buildPdfDocument(spec)
  return doc.output('blob')
}
