import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import logoJamaaw from '../assets/jamaaw-logo-term.png'

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

const REPORT_NAVY = '#061846'
const REPORT_MUTED = '#545866'
const REPORT_GRID = '#c8ceda'
const REPORT_LIGHT_BAND = '#edf0f6'

let reportLogoDataUrlCache: string | null = null

export async function openPrintTableDocument({
  title,
  subtitle,
  filename,
  generatedAt,
  columns,
  rows,
  orientation = 'portrait',
  compact = false,
}: PrintTableDocumentOptions): Promise<void> {
  const generatedLabel = generatedAt ?? new Date().toLocaleString('pt-BR')
  const { doc, startY, margin } = await createReportPdf({ title, subtitle, filename, generatedLabel, orientation, compact })

  autoTable(doc, {
    startY,
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
      lineColor: hexToRgb(REPORT_GRID),
      lineWidth: 0.12,
      textColor: hexToRgb('#111111'),
    },
    headStyles: {
      fillColor: hexToRgb(REPORT_NAVY),
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: compact ? 6.5 : 7.5,
    },
    alternateRowStyles: {
      fillColor: hexToRgb('#fafbfd'),
    },
    margin: {
      left: margin,
      right: margin,
      top: margin,
      bottom: compact ? 12 : 16,
    },
    didDrawPage: () => drawReportFooter(doc),
  })

  doc.save(normalizePdfFilename(filename ?? title))
}

export async function openPrintSectionedTableDocument({
  title,
  subtitle,
  filename,
  generatedAt,
  sections,
}: PrintSectionedTableDocumentOptions): Promise<void> {
  const generatedLabel = generatedAt ?? new Date().toLocaleString('pt-BR')
  const { doc, startY, margin } = await createReportPdf({ title, subtitle, filename, generatedLabel, orientation: 'portrait' })
  const printableSections = sections.length > 0
    ? sections
    : [{
      title: 'Dados',
      columns: [{ key: 'mensagem', label: 'Mensagem' }],
      rows: [{ mensagem: 'Nenhum dado disponivel' }],
    }]

  let sectionStartY = startY

  printableSections.forEach((section, index) => {
    if (index > 0 && sectionStartY > 245) {
      doc.addPage()
      sectionStartY = 18
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(REPORT_NAVY)
    doc.text(section.title, margin, sectionStartY)

    if (section.subtitle) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(REPORT_MUTED)
      const subtitleLines = doc.splitTextToSize(section.subtitle, doc.internal.pageSize.getWidth() - margin * 2)
      doc.text(subtitleLines, margin, sectionStartY + 5)
      sectionStartY += 5 + subtitleLines.length * 4
    } else {
      sectionStartY += 5
    }

    autoTable(doc, {
      startY: sectionStartY + 2,
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
        lineColor: hexToRgb(REPORT_GRID),
        lineWidth: 0.12,
        textColor: hexToRgb('#111111'),
      },
      headStyles: {
        fillColor: hexToRgb(REPORT_NAVY),
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5,
      },
      alternateRowStyles: {
        fillColor: hexToRgb('#fafbfd'),
      },
      margin: {
        left: margin,
        right: margin,
        top: 12,
        bottom: 16,
      },
      didDrawPage: () => drawReportFooter(doc),
    })

    sectionStartY = getAutoTableFinalY(doc) + 14
  })

  doc.save(normalizePdfFilename(filename ?? title))
}

async function createReportPdf({
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
}): Promise<{ doc: jsPDF; startY: number; margin: number }> {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const logoDataUrl = await imageUrlToDataUrl(logoJamaaw)
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = compact ? 8 : 12
  const contentWidth = pageWidth - margin * 2
  const logoWidth = compact ? 29 : 37
  const logoHeight = logoWidth * 0.95
  const logoX = (pageWidth - logoWidth) / 2
  const logoY = compact ? 6 : 8
  const titleLines = doc.splitTextToSize(title, contentWidth)

  doc.addImage(logoDataUrl, 'PNG', logoX, logoY, logoWidth, logoHeight)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(compact ? 7.5 : 8.5)
  doc.setTextColor(REPORT_MUTED)
  doc.text('JAMAAW SOLUÇÕES INTELIGENTES', pageWidth / 2, logoY + logoHeight + (compact ? 4 : 5), { align: 'center' })

  doc.setFontSize(compact ? 15 : 18)
  doc.setTextColor(REPORT_NAVY)
  const titleY = logoY + logoHeight + (compact ? 11 : 14)
  doc.text(titleLines, pageWidth / 2, titleY, { align: 'center' })

  let cursorY = titleY + titleLines.length * (compact ? 5 : 6)
  if (subtitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(compact ? 7 : 8)
    doc.setTextColor(REPORT_MUTED)
    const subtitleLines = doc.splitTextToSize(subtitle, contentWidth)
    doc.text(subtitleLines, pageWidth / 2, cursorY, { align: 'center' })
    cursorY += subtitleLines.length * 4
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(compact ? 7 : 8)
  doc.setTextColor(REPORT_MUTED)
  doc.text(`Gerado em ${generatedLabel} | ${normalizePdfFilename(filename ?? title)}`, pageWidth / 2, cursorY + 4, { align: 'center' })

  const bandY = cursorY + 8
  doc.setFillColor(REPORT_LIGHT_BAND)
  doc.rect(margin, bandY, pageWidth - margin * 2, compact ? 1.5 : 2, 'F')

  return { doc, startY: bandY + (compact ? 5 : 7), margin }
}

function drawReportFooter(doc: jsPDF): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageNumber = doc.getNumberOfPages()

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(REPORT_MUTED)
  doc.text('Jamaaw Soluções Inteligentes', 12, pageHeight - 8)
  doc.text(`Pagina ${pageNumber}`, pageWidth - 12, pageHeight - 8, { align: 'right' })
}

async function imageUrlToDataUrl(url: string): Promise<string> {
  if (reportLogoDataUrlCache) return reportLogoDataUrlCache

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Nao foi possivel carregar a logo do relatorio.'))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Nao foi possivel preparar a logo do relatorio.')
  }

  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0)

  reportLogoDataUrlCache = canvas.toDataURL('image/png')
  return reportLogoDataUrlCache
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
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
