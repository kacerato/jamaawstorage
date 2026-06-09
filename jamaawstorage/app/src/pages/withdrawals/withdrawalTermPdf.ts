import { jsPDF } from 'jspdf'
import logoJamaaw from '../../assets/jamaaw-logo-term.png'
import type { Tables, WithdrawalDestinationType } from '../../types/database'
import type { WithdrawalWithDetails } from '../../types'

type TermPerson = Pick<Tables<'people'>, 'id' | 'full_name' | 'cpf' | 'employee_id'>
type TermWorkSite = Pick<Tables<'work_sites'>, 'id' | 'name'>

export interface WithdrawalTermItem {
  quantity: number
  description: string
}

export interface WithdrawalTermDocument {
  key: string
  kind: WithdrawalDestinationType
  destinationLabel: string
  responsibleName: string
  responsibleCpf: string | null
  date: string
  items: WithdrawalTermItem[]
}

export interface WithdrawalTermGroupInput<TItem> {
  destination_type: WithdrawalDestinationType
  collaborator_id: string | null
  work_site_id: string | null
  items: TItem[]
}

type DraftTermItem = {
  quantity: number
  stock_item: Pick<Tables<'stock_items'>, 'name'>
}

const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297
const NAVY = '#061846'
const INK = '#111111'
const MUTED = '#545866'
const GRID = '#c8ceda'
const LIGHT_BAND = '#edf0f6'
const MAX_SINGLE_PAGE_ITEMS = 30
const TERM_BODY_TEXT = 'Declaro, para os devidos fins, que os itens abaixo relacionados foram retirados do almoxarifado JAMAAW. O solicitante declara estar ciente do recebimento dos materiais, responsabilizando-se pelo uso adequado, guarda, conservação e zelo de todos os itens retirados, comprometendo-se a devolvê-los em boas condições, salvo desgaste natural de uso.'
const READABLE_TABLE_FONT_SIZE = 7.9

let logoDataUrlCache: string | null = null

function formatCpf(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (digits.length !== 11) return value?.trim() || ''
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

function formatTermDate(value?: string | null): string {
  const baseDate = value ? new Date(value) : new Date()
  const day = `${baseDate.getDate()}`.padStart(2, '0')
  const month = `${baseDate.getMonth() + 1}`.padStart(2, '0')
  const year = `${baseDate.getFullYear()}`
  return `${day} / ${month} / ${year}`
}

function normalizeFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

async function imageUrlToDataUrl(url: string): Promise<string> {
  if (logoDataUrlCache) return logoDataUrlCache

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Nao foi possivel carregar a logo do termo.'))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Nao foi possivel preparar a logo do termo.')
  }

  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0)

  logoDataUrlCache = canvas.toDataURL('image/png')
  return logoDataUrlCache
}

function addCenteredText(
  pdf: jsPDF,
  text: string,
  y: number,
  size: number,
  options: { bold?: boolean; color?: string } = {},
) {
  pdf.setFont('helvetica', options.bold ? 'bold' : 'normal')
  pdf.setFontSize(size)
  pdf.setTextColor(options.color ?? INK)
  pdf.text(text, PAGE_WIDTH / 2, y, { align: 'center' })
}

function drawWrappedText(pdf: jsPDF, text: string, x: number, y: number, maxWidth: number, fontSize: number) {
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(fontSize)
  pdf.setTextColor(INK)
  const lines = pdf.splitTextToSize(text, maxWidth)
  pdf.text(lines, x, y, { align: 'justify', maxWidth, lineHeightFactor: 1.3 })
  return y + lines.length * fontSize * 0.46
}

function drawResponsibleTable(pdf: jsPDF, term: WithdrawalTermDocument, y: number, compact: boolean) {
  const x = 26
  const width = 158
  const labelWidth = compact ? 66 : 74
  const rowHeight = compact ? 6.1 : 7.6
  const labelSize = compact ? 9.2 : 10.6
  const valueSize = compact ? 9.2 : 10.8

  pdf.setDrawColor(GRID)
  pdf.setLineWidth(0.25)

  for (let row = 0; row < 2; row += 1) {
    const rowY = y + row * rowHeight
    pdf.setFillColor(row === 0 ? 250 : 255, row === 0 ? 251 : 255, row === 0 ? 253 : 255)
    pdf.rect(x, rowY, width, rowHeight, 'FD')
    pdf.line(x + labelWidth, rowY, x + labelWidth, rowY + rowHeight)
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(labelSize)
  pdf.setTextColor(NAVY)
  pdf.text('Solicitado por', x + 3, y + rowHeight - 2)
  pdf.text('CPF', x + 3, y + rowHeight * 2 - 2)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(valueSize)
  pdf.setTextColor(INK)
  pdf.text(term.responsibleName || 'Nao informado', x + labelWidth + 3, y + rowHeight - 2)
  pdf.text(formatCpf(term.responsibleCpf) || '-', x + labelWidth + 3, y + rowHeight * 2 - 2)

  return y + rowHeight * 2
}

function truncateToWidth(pdf: jsPDF, value: string, maxWidth: number): string {
  if (pdf.getTextWidth(value) <= maxWidth) return value

  let next = value
  while (next.length > 3 && pdf.getTextWidth(`${next}...`) > maxWidth) {
    next = next.slice(0, -1)
  }

  return `${next}...`
}

function drawItemsTable(
  pdf: jsPDF,
  items: WithdrawalTermItem[],
  y: number,
  rowHeight: number,
  fontSize: number,
) {
  const x = 41
  const width = 116
  const qtyWidth = 27
  const headerHeight = Math.max(5.2, rowHeight)

  pdf.setFillColor(NAVY)
  pdf.setDrawColor(GRID)
  pdf.rect(x, y, width, headerHeight, 'FD')
  pdf.line(x + qtyWidth, y, x + qtyWidth, y + headerHeight)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(Math.max(8.2, fontSize))
  pdf.setTextColor('#ffffff')
  pdf.text('Quantidade', x + qtyWidth / 2, y + headerHeight / 2, { align: 'center', baseline: 'middle' })
  pdf.text('Descrição', x + qtyWidth + (width - qtyWidth) / 2, y + headerHeight / 2, { align: 'center', baseline: 'middle' })

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(fontSize)
  pdf.setTextColor(INK)
  pdf.setDrawColor(GRID)

  let cursorY = y + headerHeight
  for (const item of items) {
    const textY = cursorY + rowHeight / 2
    pdf.rect(x, cursorY, width, rowHeight)
    pdf.line(x + qtyWidth, cursorY, x + qtyWidth, cursorY + rowHeight)
    pdf.text(String(item.quantity), x + qtyWidth / 2, textY, { align: 'center', baseline: 'middle' })
    pdf.text(truncateToWidth(pdf, item.description, width - qtyWidth - 5), x + qtyWidth + 2, textY, { baseline: 'middle' })
    cursorY += rowHeight
  }

  return cursorY
}

function drawSignatureBlock(pdf: jsPDF, y: number, compact: boolean) {
  const x = 25
  const width = 160
  const colWidth = width / 2
  const headerHeight = compact ? 6.4 : 7
  const bodyHeight = compact ? 20 : 25
  const titleSize = compact ? 8.8 : 10.4
  const captionSize = compact ? 8.2 : 9.6

  pdf.setDrawColor(GRID)
  pdf.setLineWidth(0.25)
  pdf.setFillColor(LIGHT_BAND)
  pdf.rect(x, y, width, headerHeight, 'FD')
  pdf.line(x + colWidth, y, x + colWidth, y + headerHeight + bodyHeight)
  pdf.rect(x, y + headerHeight, width, bodyHeight)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(titleSize)
  pdf.setTextColor(NAVY)
  pdf.text('Supervisor (Autorização)', x + colWidth / 2, y + headerHeight - 1.8, { align: 'center' })
  pdf.text('Solicitante (Retirada)', x + colWidth + colWidth / 2, y + headerHeight - 1.8, { align: 'center' })

  const lineY = y + headerHeight + bodyHeight - 10
  pdf.setDrawColor('#4f5561')
  pdf.line(x + 13, lineY, x + colWidth - 7, lineY)
  pdf.line(x + colWidth + 13, lineY, x + width - 7, lineY)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(captionSize)
  pdf.setTextColor(MUTED)
  pdf.text('Assinatura do supervisor', x + colWidth / 2, y + headerHeight + bodyHeight - 3.2, { align: 'center' })
  pdf.text('Assinatura do colaborador', x + colWidth + colWidth / 2, y + headerHeight + bodyHeight - 3.2, { align: 'center' })

  return y + headerHeight + bodyHeight
}

function regularLayoutSettings(itemCount: number) {
  return itemCount <= 8
    ? {
        logoY: 27,
        logoWidth: 63,
        titleY: 101,
        textY: 123,
        textFontSize: 11.2,
        warningHeight: 10,
        sectionGap: 9,
        signatureGap: 8,
        compact: false,
      }
    : {
        logoY: 18,
        logoWidth: 50,
        titleY: 81,
        textY: 101,
        textFontSize: 9.8,
        warningHeight: 8.5,
        sectionGap: 6,
        signatureGap: 6,
        compact: true,
      }
}

function denseLayoutSettings() {
  return {
    logoY: 8,
    logoWidth: 36,
    titleY: 56,
    textY: 73,
    textFontSize: 8.6,
    warningHeight: 7.2,
    sectionGap: 3.4,
    signatureGap: 3.2,
    compact: true,
  }
}

type TermLayoutSettings = ReturnType<typeof regularLayoutSettings>

function estimateHeaderNextY(pdf: jsPDF, settings: TermLayoutSettings) {
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(settings.textFontSize)
  const textLines = pdf.splitTextToSize(TERM_BODY_TEXT, 170)
  const responsibleRowHeight = settings.compact ? 6.1 : 7.6

  let y = settings.textY + textLines.length * settings.textFontSize * 0.46
  y += settings.sectionGap
  y += settings.warningHeight + settings.sectionGap
  y += responsibleRowHeight * 2
  y += settings.sectionGap

  return y + (settings.compact ? 4.2 : 5.3)
}

function chooseLayoutSettings(pdf: jsPDF, itemCount: number) {
  const regularSettings = regularLayoutSettings(itemCount)
  const regularNextY = estimateHeaderNextY(pdf, regularSettings)
  const regularRows = computeRowLayout(itemCount, regularNextY, regularSettings)

  if (itemCount > 8 && regularRows.fontSize < READABLE_TABLE_FONT_SIZE) {
    return denseLayoutSettings()
  }

  return regularSettings
}

function computeRowLayout(itemsCount: number, itemTableY: number, settings: TermLayoutSettings) {
  const signatureReserve = (settings.compact ? 26.4 : 32) + settings.signatureGap + 13
  const tableHeader = 5.2
  const available = PAGE_HEIGHT - 15 - signatureReserve - itemTableY - tableHeader
  const naturalRowHeight = Math.min(6.1, available / Math.max(itemsCount, 1))
  const minimumReadableRowHeight = itemsCount <= MAX_SINGLE_PAGE_ITEMS ? 3 : 3.45
  const rowHeight = Math.max(minimumReadableRowHeight, naturalRowHeight)

  if (naturalRowHeight >= minimumReadableRowHeight || itemsCount <= MAX_SINGLE_PAGE_ITEMS) {
    return {
      rowsFitOnSinglePage: true,
      rowHeight,
      fontSize: Math.max(5.6, Math.min(10.2, rowHeight + 3.7)),
    }
  }

  return {
    rowsFitOnSinglePage: false,
    rowHeight: 4.3,
    fontSize: 7.4,
  }
}

function drawTermHeader(pdf: jsPDF, term: WithdrawalTermDocument, logoDataUrl: string, itemCount: number) {
  const settings = chooseLayoutSettings(pdf, itemCount)
  const logoHeight = settings.logoWidth * 0.95
  const logoX = (PAGE_WIDTH - settings.logoWidth) / 2

  pdf.addImage(logoDataUrl, 'PNG', logoX, settings.logoY, settings.logoWidth, logoHeight)

  addCenteredText(pdf, 'TERMO DE RETIRADA DO ALMOXARIFADO', settings.titleY, settings.compact ? 14 : 16, { bold: true, color: NAVY })
  addCenteredText(pdf, 'JAMAAW SOLUÇÕES INTELIGENTES', settings.titleY + 7.5, settings.compact ? 10.2 : 11.5, { bold: true, color: MUTED })

  let y = drawWrappedText(pdf, TERM_BODY_TEXT, 20, settings.textY, 170, settings.textFontSize)

  y += settings.sectionGap
  pdf.setFillColor(LIGHT_BAND)
  pdf.rect(17, y, 176, settings.warningHeight, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(settings.compact ? 8.8 : 10.8)
  pdf.setTextColor(NAVY)
  const warning = pdf.splitTextToSize('IMPORTANTE: O solicitante é responsável por zelar pelos materiais retirados e utilizá-los de forma adequada e segura.', 170)
  pdf.text(warning, PAGE_WIDTH / 2, y + (settings.compact ? 3.2 : 4.2), { align: 'center', lineHeightFactor: 1.12 })

  y += settings.warningHeight + settings.sectionGap
  y = drawResponsibleTable(pdf, term, y, settings.compact)
  y += settings.sectionGap

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(settings.compact ? 10.8 : 12.8)
  pdf.setTextColor(NAVY)
  pdf.text('ITENS RETIRADOS', 18, y)

  return {
    settings,
    nextY: y + (settings.compact ? 4.2 : 5.3),
  }
}

function drawTermPage(pdf: jsPDF, term: WithdrawalTermDocument, logoDataUrl: string) {
  const { settings, nextY } = drawTermHeader(pdf, term, logoDataUrl, term.items.length)
  const rowLayout = computeRowLayout(term.items.length, nextY, settings)

  if (rowLayout.rowsFitOnSinglePage || term.items.length <= MAX_SINGLE_PAGE_ITEMS) {
    const yAfterItems = drawItemsTable(pdf, term.items, nextY, rowLayout.rowHeight, rowLayout.fontSize)
    const signatureY = Math.min(yAfterItems + settings.signatureGap, PAGE_HEIGHT - 15 - (settings.compact ? 34 : 40))
    const yAfterSignature = drawSignatureBlock(pdf, signatureY, settings.compact)

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(settings.compact ? 10 : 11.4)
    pdf.setTextColor(NAVY)
    pdf.text(`Data: ${term.date}`, 185, yAfterSignature + 8, { align: 'right' })
    return
  }

  const firstPageCapacity = Math.max(1, Math.floor((PAGE_HEIGHT - nextY - 20) / rowLayout.rowHeight) - 1)
  let cursor = 0
  let pageIndex = 0

  while (cursor < term.items.length) {
    if (pageIndex > 0) {
      pdf.addPage()
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(12)
      pdf.setTextColor(NAVY)
      pdf.text('ITENS RETIRADOS', 18, 22)
    }

    const isLastPage = cursor + firstPageCapacity >= term.items.length
    const tableY = pageIndex === 0 ? nextY : 30
    const reserve = isLastPage ? 48 : 18
    const capacity = Math.max(1, Math.floor((PAGE_HEIGHT - tableY - reserve) / rowLayout.rowHeight) - 1)
    const pageItems = term.items.slice(cursor, cursor + capacity)
    const yAfterItems = drawItemsTable(pdf, pageItems, tableY, rowLayout.rowHeight, rowLayout.fontSize)
    cursor += pageItems.length

    if (cursor >= term.items.length) {
      const signatureY = Math.min(yAfterItems + settings.signatureGap, PAGE_HEIGHT - 15 - 34)
      const yAfterSignature = drawSignatureBlock(pdf, signatureY, true)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.setTextColor(NAVY)
      pdf.text(`Data: ${term.date}`, 185, yAfterSignature + 8, { align: 'right' })
    }

    pageIndex += 1
  }
}

function createPdf(): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  return pdf
}

async function buildPdf(terms: WithdrawalTermDocument[]): Promise<jsPDF> {
  const logoDataUrl = await imageUrlToDataUrl(logoJamaaw)
  const pdf = createPdf()

  terms.forEach((term, index) => {
    if (index > 0) pdf.addPage()
    drawTermPage(pdf, term, logoDataUrl)
  })

  return pdf
}

export async function downloadWithdrawalTermPdf(
  terms: WithdrawalTermDocument[],
  options: { fileName?: string } = {},
): Promise<void> {
  if (terms.length === 0) return
  const pdf = await buildPdf(terms)
  pdf.save(options.fileName ?? 'termo-retirada-almoxarifado.pdf')
}

export async function downloadIndividualWithdrawalTermPdfs(terms: WithdrawalTermDocument[]): Promise<void> {
  for (const term of terms) {
    const pdf = await buildPdf([term])
    pdf.save(`termo-retirada-${normalizeFileName(term.destinationLabel || term.responsibleName)}.pdf`)
    await new Promise((resolve) => window.setTimeout(resolve, 120))
  }
}

export function buildDraftWithdrawalTermDocuments<TItem extends DraftTermItem>(
  groups: WithdrawalTermGroupInput<TItem>[],
  context: {
    requester: TermPerson | null
    collaborators: TermPerson[]
    workSites: TermWorkSite[]
    date?: string | null
  },
): WithdrawalTermDocument[] {
  const date = formatTermDate(context.date)

  return groups.map((group) => {
    const collaborator = group.destination_type === 'collaborator'
      ? context.collaborators.find((person) => person.id === group.collaborator_id) ?? null
      : null
    const workSite = group.destination_type === 'work_site'
      ? context.workSites.find((item) => item.id === group.work_site_id) ?? null
      : null
    const responsible = group.destination_type === 'collaborator'
      ? collaborator
      : context.requester

    return {
      key: [
        group.destination_type,
        group.collaborator_id ?? 'none',
        group.work_site_id ?? 'none',
      ].join(':'),
      kind: group.destination_type,
      destinationLabel: group.destination_type === 'collaborator'
        ? collaborator?.full_name ?? 'Colaborador'
        : workSite?.name ?? 'Obra',
      responsibleName: responsible?.full_name ?? 'Nao informado',
      responsibleCpf: responsible?.cpf ?? null,
      date,
      items: group.items.map((item) => ({
        quantity: item.quantity,
        description: item.stock_item.name,
      })),
    }
  })
}

export function buildSavedWithdrawalTermDocuments(withdrawal: WithdrawalWithDetails): WithdrawalTermDocument[] {
  const map = new Map<string, WithdrawalWithDetails['withdrawal_items']>()

  for (const item of withdrawal.withdrawal_items ?? []) {
    const destinationType = item.destination_type ?? withdrawal.destination_type
    const collaboratorId = item.collaborator_id ?? withdrawal.collaborator_id
    const workSiteId = item.work_site_id ?? withdrawal.work_site_id
    const key = [
      destinationType,
      collaboratorId ?? 'none',
      workSiteId ?? 'none',
    ].join(':')

    map.set(key, [...(map.get(key) ?? []), item])
  }

  if (map.size === 0) {
    const key = [
      withdrawal.destination_type,
      withdrawal.collaborator_id ?? 'none',
      withdrawal.work_site_id ?? 'none',
    ].join(':')
    map.set(key, [])
  }

  return Array.from(map.entries()).map(([key, items]) => {
    const firstItem = items[0]
    const destinationType = firstItem?.destination_type ?? withdrawal.destination_type
    const collaborator = destinationType === 'collaborator'
      ? firstItem?.collaborator ?? withdrawal.collaborator ?? null
      : null
    const workSite = destinationType === 'work_site'
      ? firstItem?.work_site ?? withdrawal.work_site ?? null
      : null
    const responsible = destinationType === 'collaborator'
      ? collaborator
      : withdrawal.requested_by_person

    return {
      key,
      kind: destinationType,
      destinationLabel: destinationType === 'collaborator'
        ? collaborator?.full_name ?? 'Colaborador'
        : workSite?.name ?? 'Obra',
      responsibleName: responsible?.full_name ?? 'Nao informado',
      responsibleCpf: responsible?.cpf ?? null,
      date: formatTermDate(withdrawal.withdrawn_at ?? withdrawal.updated_at ?? withdrawal.created_at),
      items: items.length > 0
        ? items.map((item) => ({
            quantity: item.quantity,
            description: item.stock_items?.name ?? 'Item',
          }))
        : [{ quantity: 0, description: 'Nenhum item informado' }],
    }
  })
}
