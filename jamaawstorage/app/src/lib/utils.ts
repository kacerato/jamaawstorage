import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function generateWithdrawalCodePreview(): string {
  const now = new Date()
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0')
  return `RET-${dateStr}-???`
}

export function isValidUUID(uuid: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

export function formatQuantity(quantity: number, unit: string): string {
  return `${quantity} ${unit}`
}

interface PrintTableColumn {
  key: string
  label: string
}

interface PrintTableDocumentOptions {
  title: string
  subtitle?: string
  filename?: string
  generatedAt?: string
  columns: PrintTableColumn[]
  rows: Record<string, unknown>[]
  orientation?: 'portrait' | 'landscape'
  compact?: boolean
}

interface PrintTableSection {
  title: string
  subtitle?: string
  columns: PrintTableColumn[]
  rows: Record<string, unknown>[]
}

interface PrintSectionedTableDocumentOptions {
  title: string
  subtitle?: string
  filename?: string
  generatedAt?: string
  sections: PrintTableSection[]
}

export function openPrintTableDocument({
  title,
  subtitle,
  filename,
  generatedAt,
  columns,
  rows,
  orientation = 'portrait',
  compact = false,
}: PrintTableDocumentOptions): void {
  const generatedLabel = generatedAt ?? new Date().toLocaleString('pt-BR')
  const doc = createReportPdf({ title, subtitle, filename, generatedLabel, orientation, compact })

  autoTable(doc, {
    startY: compact ? 34 : 42,
    head: [columns.map((column) => column.label)],
    body: rows.length > 0
      ? rows.map((row) => columns.map((column) => formatPdfCell(row[column.key])))
      : [[`Nenhum dado disponivel`]],
    styles: {
      font: 'helvetica',
      fontSize: compact ? 7 : 8,
      cellPadding: compact ? 1.6 : 2.4,
      overflow: 'linebreak',
      valign: 'top',
      lineColor: [229, 231, 235],
      lineWidth: 0.15,
      textColor: [31, 41, 55],
    },
    headStyles: {
      fillColor: [248, 250, 252],
      textColor: [31, 41, 55],
      fontStyle: 'bold',
      fontSize: compact ? 6.5 : 7.5,
    },
    alternateRowStyles: {
      fillColor: [252, 252, 253],
    },
    margin: {
      left: compact ? 8 : 12,
      right: compact ? 8 : 12,
      top: compact ? 8 : 12,
      bottom: compact ? 12 : 16,
    },
    didDrawPage: () => drawReportFooter(doc),
  })

  doc.save(normalizePdfFilename(filename ?? title))
}

export function openPrintSectionedTableDocument({
  title,
  subtitle,
  filename,
  generatedAt,
  sections,
}: PrintSectionedTableDocumentOptions): void {
  const generatedLabel = generatedAt ?? new Date().toLocaleString('pt-BR')
  const doc = createReportPdf({ title, subtitle, filename, generatedLabel, orientation: 'portrait' })
  const printableSections = sections.length > 0
    ? sections
    : [{
      title: 'Dados',
      columns: [{ key: 'mensagem', label: 'Mensagem' }],
      rows: [{ mensagem: 'Nenhum dado disponivel' }],
    }]

  let startY = 42

  printableSections.forEach((section, index) => {
    if (index > 0 && startY > 245) {
      doc.addPage()
      startY = 18
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(31, 41, 55)
    doc.text(section.title, 12, startY)

    if (section.subtitle) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(107, 114, 128)
      const subtitleLines = doc.splitTextToSize(section.subtitle, 186)
      doc.text(subtitleLines, 12, startY + 5)
      startY += 5 + subtitleLines.length * 4
    } else {
      startY += 5
    }

    autoTable(doc, {
      startY: startY + 2,
      head: [section.columns.map((column) => column.label)],
      body: section.rows.length > 0
        ? section.rows.map((row) => section.columns.map((column) => formatPdfCell(row[column.key])))
        : [[`Nenhum dado disponivel`]],
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 2.4,
        overflow: 'linebreak',
        valign: 'top',
        lineColor: [229, 231, 235],
        lineWidth: 0.15,
        textColor: [31, 41, 55],
      },
      headStyles: {
        fillColor: [248, 250, 252],
        textColor: [31, 41, 55],
        fontStyle: 'bold',
        fontSize: 7.5,
      },
      alternateRowStyles: {
        fillColor: [252, 252, 253],
      },
      margin: {
        left: 12,
        right: 12,
        top: 12,
        bottom: 16,
      },
      didDrawPage: () => drawReportFooter(doc),
    })

    startY = getAutoTableFinalY(doc) + 14
  })

  doc.save(normalizePdfFilename(filename ?? title))
}

function createReportPdf({
  title,
  subtitle,
  filename,
  generatedLabel,
  orientation,
  compact = false,
}: {
  title: string
  subtitle?: string
  filename?: string
  generatedLabel: string
  orientation: 'portrait' | 'landscape'
  compact?: boolean
}): jsPDF {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = compact ? 8 : 12
  const contentWidth = pageWidth - margin * 2
  const titleLines = doc.splitTextToSize(title, contentWidth)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(compact ? 8 : 9)
  doc.setTextColor(234, 88, 12)
  doc.text('RELATORIO', margin, compact ? 10 : 14)

  doc.setFontSize(compact ? 15 : 18)
  doc.setTextColor(31, 41, 55)
  doc.text(titleLines, margin, compact ? 17 : 23)

  let cursorY = (compact ? 17 : 23) + titleLines.length * (compact ? 5 : 6)
  if (subtitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(compact ? 7 : 8)
    doc.setTextColor(107, 114, 128)
    const subtitleLines = doc.splitTextToSize(subtitle, contentWidth)
    doc.text(subtitleLines, margin, cursorY)
    cursorY += subtitleLines.length * 4
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(compact ? 7 : 8)
  doc.setTextColor(107, 114, 128)
  doc.text(`Gerado em ${generatedLabel} | ${normalizePdfFilename(filename ?? title)}`, margin, cursorY + 4)

  doc.setDrawColor(229, 231, 235)
  doc.setLineWidth(0.4)
  doc.line(margin, cursorY + 8, pageWidth - margin, cursorY + 8)

  return doc
}

function drawReportFooter(doc: jsPDF): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageNumber = doc.getNumberOfPages()

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(107, 114, 128)
  doc.text('Documento gerado para download em PDF.', 12, pageHeight - 8)
  doc.text(`Pagina ${pageNumber}`, pageWidth - 12, pageHeight - 8, { align: 'right' })
}

function formatPdfCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

function normalizePdfFilename(value: string): string {
  const safeName = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')

  if (!safeName) return 'relatorio.pdf'
  return safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`
}

function getAutoTableFinalY(doc: jsPDF): number {
  return (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 42
}

export const DEFAULT_IMAGE_UPLOAD_OPTIONS = {
  maxFileSizeMb: 12,
  maxDimension: 2200,
  quality: 0.86,
} as const

export async function optimizeImageFileToJpegBlob(
  file: File,
  options?: {
    maxFileSizeMb?: number
    maxDimension?: number
    quality?: number
  }
): Promise<Blob> {
  const maxFileSizeMb = options?.maxFileSizeMb ?? DEFAULT_IMAGE_UPLOAD_OPTIONS.maxFileSizeMb
  const maxDimension = options?.maxDimension ?? DEFAULT_IMAGE_UPLOAD_OPTIONS.maxDimension
  const quality = options?.quality ?? DEFAULT_IMAGE_UPLOAD_OPTIONS.quality

  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione uma imagem válida.')
  }

  if (file.size > maxFileSizeMb * 1024 * 1024) {
    throw new Error(`A imagem deve ter no máximo ${maxFileSizeMb} MB.`)
  }

  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)

    image.onload = () => {
      let width = image.width
      let height = image.height

      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('Não foi possível processar a imagem.'))
        return
      }

      ctx.drawImage(image, 0, 0, width, height)
      URL.revokeObjectURL(url)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('NÃ£o foi possÃ­vel gerar a imagem otimizada.'))
            return
          }

          resolve(blob)
        },
        'image/jpeg',
        quality,
      )
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não foi possível ler a imagem.'))
    }

    image.src = url
  })
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('NÃ£o foi possÃ­vel ler a imagem processada.'))
    }

    reader.onerror = () => {
      reject(new Error('NÃ£o foi possÃ­vel ler a imagem processada.'))
    }

    reader.readAsDataURL(blob)
  })
}

export async function imageFileToDataUrl(
  file: File,
  options?: {
    maxFileSizeMb?: number
    maxDimension?: number
    quality?: number
  }
): Promise<string> {
  const blob = await optimizeImageFileToJpegBlob(file, options)
  return blobToDataUrl(blob)
}
