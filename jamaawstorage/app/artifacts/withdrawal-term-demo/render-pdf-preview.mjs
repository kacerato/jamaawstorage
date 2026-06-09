import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pdfPath = path.join(__dirname, 'termo-retirada-demo-geral.pdf')
const outputPath = path.join(__dirname, 'termo-retirada-demo-geral-pagina-1.png')
const standardFontsUrl = `${pathToFileURL(path.join(__dirname, '../../node_modules/pdfjs-dist/standard_fonts')).href}/`

const bytes = new Uint8Array(fs.readFileSync(pdfPath))
const pdf = await pdfjsLib.getDocument({
  data: bytes,
  disableWorker: true,
  standardFontDataUrl: standardFontsUrl,
}).promise
const page = await pdf.getPage(1)
const viewport = page.getViewport({ scale: 2 })
const canvas = createCanvas(viewport.width, viewport.height)
const context = canvas.getContext('2d')

await page.render({ canvasContext: context, viewport }).promise

fs.writeFileSync(outputPath, canvas.toBuffer('image/png'))
console.log(outputPath)
