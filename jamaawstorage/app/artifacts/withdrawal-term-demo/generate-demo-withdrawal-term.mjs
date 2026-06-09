import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { jsPDF } from 'jspdf'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logoSource = 'C:/Users/jamaa/Downloads/Gemini_Generated_Image_93jfax93jfax93jf.png'
const croppedLogoPath = path.join(__dirname, 'jamaaw-logo-cropped.png')
const fontFamily = 'LiberationSans'
const fontRegularPath = path.join(__dirname, '../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf')
const fontBoldPath = path.join(__dirname, '../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf')

const navy = '#061846'
const ink = '#07122f'
const lightBand = '#edf0f6'
const grid = '#c8ceda'
const muted = '#545866'

function formatDate(date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear())
  return `${day} / ${month} / ${year}`
}

function formatCpf(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length !== 11) return String(value ?? '')
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

function normalizeFileName(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

async function cropLogo() {
  const image = await loadImage(logoSource)
  const source = createCanvas(image.width, image.height)
  const sourceCtx = source.getContext('2d')
  sourceCtx.drawImage(image, 0, 0)

  const { data } = sourceCtx.getImageData(0, 0, image.width, image.height)
  let minX = image.width
  let minY = image.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4
      const alpha = data[index + 3]
      const red = data[index]
      const green = data[index + 1]
      const blue = data[index + 2]
      const isInkPixel = alpha > 16 && (red < 245 || green < 245 || blue < 245)

      if (isInkPixel) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  const padding = 16
  minX = Math.max(0, minX - padding)
  minY = Math.max(0, minY - padding)
  maxX = Math.min(image.width - 1, maxX + padding)
  maxY = Math.min(image.height - 1, maxY + padding)

  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const output = createCanvas(width, height)
  const outputCtx = output.getContext('2d')
  outputCtx.fillStyle = '#ffffff'
  outputCtx.fillRect(0, 0, width, height)
  outputCtx.drawImage(source, minX, minY, width, height, 0, 0, width, height)

  fs.writeFileSync(croppedLogoPath, output.toBuffer('image/png'))
  return {
    path: croppedLogoPath,
    dataUrl: `data:image/png;base64,${fs.readFileSync(croppedLogoPath).toString('base64')}`,
    width,
    height,
  }
}

function addCenteredText(doc, text, y, size, options = {}) {
  doc.setFont(fontFamily, options.bold ? 'bold' : 'normal')
  doc.setFontSize(size)
  doc.setTextColor(options.color ?? ink)
  doc.text(text, 105, y, { align: 'center' })
}

function drawWrappedJustifiedText(doc, text, x, y, maxWidth, lineHeight) {
  doc.setFont(fontFamily, 'normal')
  doc.setFontSize(11.2)
  doc.setTextColor('#111111')
  const lines = doc.splitTextToSize(text, maxWidth)
  doc.text(lines, x, y, { align: 'justify', maxWidth, lineHeightFactor: 1.35 })
  return y + lines.length * lineHeight
}

function drawResponsibleTable(doc, term, y) {
  const x = 26
  const width = 158
  const labelWidth = 74
  const rowHeight = 7.6

  doc.setDrawColor(grid)
  doc.setLineWidth(0.25)

  for (let row = 0; row < 2; row += 1) {
    const rowY = y + row * rowHeight
    doc.setFillColor(row === 0 ? 250 : 255, row === 0 ? 251 : 255, row === 0 ? 253 : 255)
    doc.rect(x, rowY, width, rowHeight, 'FD')
    doc.line(x + labelWidth, rowY, x + labelWidth, rowY + rowHeight)
  }

  doc.setFont(fontFamily, 'bold')
  doc.setFontSize(10.6)
  doc.setTextColor(navy)
  doc.text('Solicitado por', x + 3, y + 5.3)
  doc.text('CPF', x + 3, y + rowHeight + 5.3)

  doc.setFont(fontFamily, 'normal')
  doc.setFontSize(10.8)
  doc.setTextColor('#111111')
  doc.text(term.responsibleName, x + labelWidth + 3, y + 5.3)
  doc.text(formatCpf(term.responsibleCpf) || '-', x + labelWidth + 3, y + rowHeight + 5.3)

  return y + rowHeight * 2
}

function drawItemsTable(doc, items, y) {
  const x = 41
  const width = 116
  const qtyWidth = 27
  const rowHeight = 6.1

  doc.setFillColor(navy)
  doc.setDrawColor(grid)
  doc.rect(x, y, width, rowHeight, 'FD')
  doc.line(x + qtyWidth, y, x + qtyWidth, y + rowHeight)

  doc.setFont(fontFamily, 'bold')
  doc.setFontSize(10.6)
  doc.setTextColor('#ffffff')
  doc.text('Quantidade', x + qtyWidth / 2, y + 4.4, { align: 'center' })
  doc.text('Descrição', x + qtyWidth + (width - qtyWidth) / 2, y + 4.4, { align: 'center' })

  doc.setFont(fontFamily, 'normal')
  doc.setFontSize(10.2)
  doc.setTextColor('#111111')
  doc.setDrawColor(grid)

  let cursorY = y + rowHeight
  for (const item of items) {
    doc.rect(x, cursorY, width, rowHeight)
    doc.line(x + qtyWidth, cursorY, x + qtyWidth, cursorY + rowHeight)
    doc.text(String(item.quantity), x + qtyWidth / 2, cursorY + 4.35, { align: 'center' })
    doc.text(item.description, x + qtyWidth + 2, cursorY + 4.35)
    cursorY += rowHeight
  }

  return cursorY
}

function drawSignatureBlock(doc, y) {
  const x = 25
  const width = 160
  const colWidth = width / 2
  const headerHeight = 7
  const bodyHeight = 25

  doc.setDrawColor(grid)
  doc.setLineWidth(0.25)
  doc.setFillColor(lightBand)
  doc.rect(x, y, width, headerHeight, 'FD')
  doc.line(x + colWidth, y, x + colWidth, y + headerHeight + bodyHeight)
  doc.rect(x, y + headerHeight, width, bodyHeight)

  doc.setFont(fontFamily, 'bold')
  doc.setFontSize(10.4)
  doc.setTextColor(navy)
  doc.text('Supervisor (Autorização)', x + colWidth / 2, y + 5, { align: 'center' })
  doc.text('Solicitante (Retirada)', x + colWidth + colWidth / 2, y + 5, { align: 'center' })

  doc.setDrawColor('#4f5561')
  doc.line(x + 13, y + headerHeight + 16, x + colWidth - 7, y + headerHeight + 16)
  doc.line(x + colWidth + 13, y + headerHeight + 16, x + width - 7, y + headerHeight + 16)

  doc.setFont(fontFamily, 'normal')
  doc.setFontSize(9.6)
  doc.setTextColor(muted)
  doc.text('Assinatura do supervisor', x + colWidth / 2, y + headerHeight + 22, { align: 'center' })
  doc.text('Assinatura do colaborador', x + colWidth + colWidth / 2, y + headerHeight + 22, { align: 'center' })

  return y + headerHeight + bodyHeight
}

function drawTermPage(doc, term, logo) {
  const logoWidth = 67
  const logoHeight = logoWidth * (logo.height / logo.width)
  const logoX = (210 - logoWidth) / 2
  const logoY = 31

  doc.addImage(logo.dataUrl, 'PNG', logoX, logoY, logoWidth, logoHeight)

  addCenteredText(doc, 'TERMO DE RETIRADA DO ALMOXARIFADO', 104, 16, { bold: true, color: navy })
  addCenteredText(doc, 'JAMAAW SOLUÇÕES INTELIGENTES', 111.5, 11.5, { bold: true, color: '#4b4b58' })

  const text = 'Declaro, para os devidos fins, que os itens abaixo relacionados foram retirados do almoxarifado JAMAAW. O solicitante declara estar ciente do recebimento dos materiais, responsabilizando-se pelo uso adequado, guarda, conservação e zelo de todos os itens retirados, comprometendo-se a devolvê-los em boas condições, salvo desgaste natural de uso.'
  let y = drawWrappedJustifiedText(doc, text, 20, 126, 170, 6)

  y += 4
  doc.setFillColor(lightBand)
  doc.rect(17, y, 176, 10.5, 'F')
  doc.setFont(fontFamily, 'bold')
  doc.setFontSize(10.8)
  doc.setTextColor(navy)
  const warning = doc.splitTextToSize('IMPORTANTE: O solicitante é responsável por zelar pelos materiais retirados e utilizá-los de forma adequada e segura.', 170)
  doc.text(warning, 105, y + 4.5, { align: 'center', lineHeightFactor: 1.12 })

  y += 16.2
  y = drawResponsibleTable(doc, term, y)

  y += 8.5
  doc.setFont(fontFamily, 'bold')
  doc.setFontSize(12.8)
  doc.setTextColor(navy)
  doc.text('ITENS RETIRADOS', 18, y)

  y += 5.3
  y = drawItemsTable(doc, term.items, y)

  y += 9
  doc.setFont(fontFamily, 'bold')
  doc.setFontSize(12.8)
  doc.setTextColor(navy)
  doc.text('ASSINATURAS', 18, y)

  y += 5.2
  y = drawSignatureBlock(doc, y)

  doc.setFont(fontFamily, 'bold')
  doc.setFontSize(11.4)
  doc.setTextColor(navy)
  doc.text(`Data: ${term.date}`, 185, y + 8, { align: 'right' })
}

function createPdf(terms, outputPath, logo) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  doc.addFileToVFS('LiberationSans-Regular.ttf', fs.readFileSync(fontRegularPath).toString('base64'))
  doc.addFont('LiberationSans-Regular.ttf', fontFamily, 'normal')
  doc.addFileToVFS('LiberationSans-Bold.ttf', fs.readFileSync(fontBoldPath).toString('base64'))
  doc.addFont('LiberationSans-Bold.ttf', fontFamily, 'bold')

  terms.forEach((term, index) => {
    if (index > 0) doc.addPage()
    drawTermPage(doc, term, logo)
  })

  fs.writeFileSync(outputPath, Buffer.from(doc.output('arraybuffer')))
}

const demoDate = formatDate()
const terms = [
  {
    kind: 'work_site',
    destinationLabel: 'Obra - Site Fortaleza',
    responsibleName: 'Wilson da Silva Neto',
    responsibleCpf: '12345678909',
    date: demoDate,
    items: [
      { quantity: 1, description: 'Fita zebrada' },
      { quantity: 6, description: 'Arame de espinar' },
      { quantity: 1, description: 'Luva de vaqueta' },
      { quantity: 1, description: 'Fita zebrada' },
    ],
  },
  {
    kind: 'collaborator',
    destinationLabel: 'Colaborador - Ana Paula Rocha',
    responsibleName: 'Ana Paula Rocha',
    responsibleCpf: '98765432100',
    date: demoDate,
    items: [
      { quantity: 1, description: 'Capacete com jugular' },
      { quantity: 1, description: 'Óculos de proteção' },
      { quantity: 2, description: 'Luva de vaqueta' },
    ],
  },
  {
    kind: 'collaborator',
    destinationLabel: 'Colaborador - Carlos Henrique Lima',
    responsibleName: 'Carlos Henrique Lima',
    responsibleCpf: '11122233344',
    date: demoDate,
    items: [
      { quantity: 1, description: 'Bota de segurança' },
      { quantity: 1, description: 'Cinto de segurança' },
      { quantity: 1, description: 'Talabarte duplo' },
    ],
  },
]

const logo = await cropLogo()

createPdf(terms, path.join(__dirname, 'termo-retirada-demo-geral.pdf'), logo)

for (const term of terms) {
  createPdf(
    [term],
    path.join(__dirname, `termo-retirada-demo-individual-${normalizeFileName(term.destinationLabel)}.pdf`),
    logo,
  )
}

console.log(`Gerados ${terms.length + 1} PDFs em ${__dirname}`)
