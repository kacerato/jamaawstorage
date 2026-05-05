import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { recognize } from 'tesseract.js'
import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'
import { Alert, Button, Input, Select } from '../../components/ui'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type StockItemRow = Tables<'stock_items'>

interface StockImportModalProps {
  onClose: () => void
  onImported: () => void
}

interface CandidateLine {
  id: string
  rawLabel: string
  quantity: number
  chosenItemId: string
  matches: StockItemRow[]
  bestScore: number
}

interface ParsedCandidateLine {
  label: string
  quantity: number
}

interface ChunkMatch {
  text: string
  lineIndexes: number[]
}

interface MatchCandidate {
  item: StockItemRow
  score: number
}

type ExtractionMode = 'ocr' | 'kimi'
type ExtractedContentFormat = 'plain-text' | 'structured-xml'

interface KimiExtractionResponse {
  xml: string
}

const IGNORE_PATTERNS = [
  /termo de retirada/i,
  /almoxarifado/i,
  /itens retirados/i,
  /quantidade\s+descricao/i,
  /^quantidade$/i,
  /^descricao$/i,
  /supervisor/i,
  /responsavel pela retirada/i,
  /assinatura/i,
  /observacao/i,
  /^jamaaw$/i,
  /vencimento/i,
  /validade/i,
  /fabricacao/i,
  /lote/i,
  /serie/i,
  /nota fiscal/i,
  /chave de acesso/i,
  /cnpj/i,
  /cpf/i,
  /valor/i,
  /subtotal/i,
  /total/i,
  /desconto/i,
  /icms/i,
  /pis/i,
  /cofins/i,
  /data/i,
  /\bjan\b|\bfev\b|\bmar\b|\babr\b|\bmai\b|\bjun\b|\bjul\b|\bago\b|\bset\b|\bout\b|\bnov\b|\bdez\b/i,
]

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanCandidateLabel(value: string): string {
  return value
    .replace(/\b(?:und|unid|unidade|unidades|pct|pc|par|pares|kit|kits|cx|caixa|caixas)\b/gi, ' ')
    .replace(/[|;:_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeItemLabel(value: string): string {
  return cleanCandidateLabel(value)
    .replace(/^quantidade\s+descricao\s*/i, '')
    .replace(/^descricao\s*/i, '')
    .replace(/^item(?:s)?\s+retirado(?:s)?\s*/i, '')
    .replace(/\s+(?:supervisor|responsavel pela retirada|assinatura|observacao).*$/i, '')
    .trim()
}

function createBigrams(value: string): string[] {
  if (value.length < 2) return [value]
  const compact = value.replace(/\s+/g, '')
  if (compact.length < 2) return [compact]

  const grams: string[] = []
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.push(compact.slice(index, index + 2))
  }
  return grams
}

function diceCoefficient(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1

  const leftBigrams = createBigrams(left)
  const rightBigrams = createBigrams(right)
  const rightCounts = new Map<string, number>()

  rightBigrams.forEach((gram) => {
    rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1)
  })

  let overlap = 0
  leftBigrams.forEach((gram) => {
    const count = rightCounts.get(gram) ?? 0
    if (count > 0) {
      overlap += 1
      rightCounts.set(gram, count - 1)
    }
  })

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length)
}

function toMeaningfulTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token))
}

function tokenCoverage(label: string, item: StockItemRow): number {
  const labelTokens = toMeaningfulTokens(label)
  const itemTokens = toMeaningfulTokens(item.name)
  if (labelTokens.length === 0 || itemTokens.length === 0) return 0

  const matched = itemTokens.filter((itemToken) =>
    labelTokens.some((labelToken) => labelToken === itemToken || labelToken.startsWith(itemToken) || itemToken.startsWith(labelToken)),
  ).length

  return matched / itemTokens.length
}

function exactTokenOverlapCount(label: string, item: StockItemRow): number {
  const labelTokens = toMeaningfulTokens(label)
  const itemTokens = toMeaningfulTokens(item.name)

  return itemTokens.filter((itemToken) => labelTokens.includes(itemToken)).length
}

function hasStrongCanonicalEvidence(label: string, item: StockItemRow, score: number, scoreGap: number): boolean {
  const normalizedLabel = normalizeText(label)
  const normalizedName = normalizeText(item.name)
  const itemTokens = toMeaningfulTokens(item.name)
  const coverage = tokenCoverage(label, item)
  const exactOverlap = exactTokenOverlapCount(label, item)
  const needsTwoTokens = itemTokens.length >= 2

  if (normalizedLabel === normalizedName) return true
  if (normalizedName && normalizedLabel.includes(normalizedName)) return true
  if (needsTwoTokens && exactOverlap >= 2 && coverage >= 0.75 && score >= 56) return true
  if (!needsTwoTokens && coverage >= 1 && score >= 50) return true
  if (coverage >= 1 && exactOverlap >= Math.min(itemTokens.length, 2) && scoreGap >= 4 && score >= 60) return true

  return false
}

function findExactStockItemMatch(label: string, stockItems: StockItemRow[]): StockItemRow | null {
  const normalizedLabel = normalizeText(cleanCandidateLabel(label))
  if (!normalizedLabel) return null

  return stockItems.find((item) => (
    normalizedLabel === normalizeText(item.name)
      || normalizedLabel === normalizeText(item.code)
  )) ?? null
}

function orderMatchedItems(primaryItem: StockItemRow, scoredMatches: MatchCandidate[]): StockItemRow[] {
  const ordered = [primaryItem]

  scoredMatches.forEach((candidate) => {
    if (candidate.item.id !== primaryItem.id) {
      ordered.push(candidate.item)
    }
  })

  return ordered.slice(0, 5)
}

function resolveLineLabel(label: string, scoredMatches: MatchCandidate[]): string {
  const cleanedLabel = cleanCandidateLabel(label)
  const top = scoredMatches[0]
  const second = scoredMatches[1]
  if (!top) return cleanedLabel

  const scoreGap = top.score - (second?.score ?? 0)
  if (hasStrongCanonicalEvidence(cleanedLabel, top.item, top.score, scoreGap)) return top.item.name

  return cleanedLabel
}

function scoreMatch(label: string, item: StockItemRow): number {
  const normalizedLabel = normalizeText(label)
  const normalizedName = normalizeText(item.name)
  const normalizedCode = normalizeText(item.code)
  const labelTokens = toMeaningfulTokens(label)
  const nameTokens = toMeaningfulTokens(item.name)

  if (!normalizedLabel || !normalizedName) return 0
  if (normalizedCode && normalizedLabel.includes(normalizedCode)) return 100
  if (normalizedName === normalizedLabel) return 98
  if (normalizedName.includes(normalizedLabel) || normalizedLabel.includes(normalizedName)) return 90

  const exactOverlap = labelTokens.filter((token) => nameTokens.includes(token)).length
  const prefixOverlap = labelTokens.filter((token) =>
    nameTokens.some((nameToken) => nameToken.startsWith(token) || token.startsWith(nameToken)),
  ).length

  const dice = diceCoefficient(normalizedLabel, normalizedName)
  const coverage = tokenCoverage(label, item)
  const overlapScore =
    exactOverlap * 28 +
    Math.max(0, prefixOverlap - exactOverlap) * 12 +
    Math.round(coverage * 30) +
    Math.round(dice * 36)

  return Math.max(Math.round(dice * 68), overlapScore)
}

function isMostlyNumericLine(value: string): boolean {
  const normalized = value.replace(/\s+/g, '')
  return /^[0-9xX./,-]+$/.test(normalized)
}

function parseQuantityToken(value: string): number | null {
  const match = value.match(/\d{1,4}/)
  if (!match) return null

  const quantity = Number(match[0])
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null
}

function hasQuantityHint(value: string): boolean {
  return /(?:^|\s)\d{1,4}(?:\s*[xX]|\s+(?:und|unid|unidade|unidades|pct|pc|par|pares))?/i.test(value)
}

function shouldIgnoreLine(line: string): boolean {
  const normalized = normalizeText(line)
  if (normalized.length < 4) return true
  if (/^\d+[\/.-]\d+[\/.-]\d+$/.test(normalized)) return true
  if (/^\d+$/.test(normalized)) return true
  return IGNORE_PATTERNS.some((pattern) => pattern.test(line))
}

function dedupeCandidateLines(lines: ParsedCandidateLine[]): ParsedCandidateLine[] {
  const seen = new Set<string>()

  return lines.filter((line) => {
    const key = `${normalizeText(line.label)}::${line.quantity}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function extractCandidateLines(text: string): ParsedCandidateLine[] {
  const lines = text
    .split('\n')
    .map((line) => sanitizeItemLabel(line.trim()))
    .filter((line) => line.length >= 3)

  const results: ParsedCandidateLine[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (shouldIgnoreLine(line)) continue

    const qtyFirst = line.match(/^(\d{1,4})\s*[xX]\s+(.+)$/)
    if (qtyFirst) {
      const label = sanitizeItemLabel(qtyFirst[2])
      if (!shouldIgnoreLine(label)) {
        results.push({ quantity: Number(qtyFirst[1]), label })
        continue
      }
    }

    const qtyFirstLoose = line.match(/^(\d{1,4})\s+(.+)$/)
    if (qtyFirstLoose) {
      const label = sanitizeItemLabel(qtyFirstLoose[2])
      if (!shouldIgnoreLine(label)) {
        results.push({ quantity: Number(qtyFirstLoose[1]), label })
        continue
      }
    }

    const qtyLastX = line.match(/^(.+?)\s*[xX]\s*(\d{1,4})$/)
    if (qtyLastX) {
      const label = sanitizeItemLabel(qtyLastX[1])
      if (!shouldIgnoreLine(label)) {
        results.push({ quantity: Number(qtyLastX[2]), label })
        continue
      }
    }

    const qtyLast = line.match(/^(.+?)\s+(\d{1,4})\s*[xX]?$/)
    if (qtyLast) {
      const label = sanitizeItemLabel(qtyLast[1])
      if (!shouldIgnoreLine(label)) {
        results.push({ quantity: Number(qtyLast[2]), label })
        continue
      }
    }

    const nextLine = lines[index + 1]
    if (!nextLine) continue

    if (!shouldIgnoreLine(line) && isMostlyNumericLine(nextLine)) {
      const quantity = parseQuantityToken(nextLine)
      if (quantity) {
        results.push({ quantity, label: sanitizeItemLabel(line) })
        index += 1
        continue
      }
    }

    if (isMostlyNumericLine(line) && !shouldIgnoreLine(nextLine)) {
      const quantity = parseQuantityToken(line)
      if (quantity) {
        results.push({ quantity, label: sanitizeItemLabel(nextLine) })
        index += 1
      }
    }
  }

  return dedupeCandidateLines(
    results.filter((item) => item.quantity > 0 && sanitizeItemLabel(item.label).length >= 3),
  )
}

function buildCandidateLines(extracted: ParsedCandidateLine[], stockItems: StockItemRow[]): CandidateLine[] {
  return extracted.map((item, index) => {
    const exactMatch = findExactStockItemMatch(item.label, stockItems)
    const scoredMatches = findTopMatches(item.label, stockItems)
    const rawLabel = exactMatch ? exactMatch.name : resolveLineLabel(item.label, scoredMatches)
    const matches = exactMatch ? orderMatchedItems(exactMatch, scoredMatches) : scoredMatches.map((candidate) => candidate.item)
    const bestScore = exactMatch ? 100 : scoredMatches[0]?.score ?? 0
    const chosenItemId = exactMatch ? exactMatch.id : chooseAutoAssignedItemId(rawLabel, scoredMatches)

    return {
      id: `${index}-${normalizeText(rawLabel)}-${item.quantity}`,
      rawLabel,
      quantity: item.quantity,
      chosenItemId,
      matches,
      bestScore,
    }
  })
}

function findTopMatches(label: string, stockItems: StockItemRow[]): MatchCandidate[] {
  return [...stockItems]
    .map((stockItem) => ({
      item: stockItem,
      score: scoreMatch(label, stockItem),
    }))
    .filter((candidate) => candidate.score >= 18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

function chooseAutoAssignedItemId(label: string, scoredMatches: MatchCandidate[]): string {
  const top = scoredMatches[0]
  const second = scoredMatches[1]
  if (!top) return ''

  const scoreGap = top.score - (second?.score ?? 0)
  if (hasStrongCanonicalEvidence(label, top.item, top.score, scoreGap)) return top.item.id

  if (top.score >= 86) return top.item.id
  if (top.score >= 74 && scoreGap >= 12) return top.item.id

  return ''
}

function extractLikelyQuantity(text: string): number | null {
  const weightedPatterns = [
    /(?:^|\s)(\d{1,4})\s*[xX](?:\s|$)/g,
    /(?:^|\s)[xX]\s*(\d{1,4})(?:\s|$)/g,
    /(?:qtd|quantidade)\s*:?\s*(\d{1,4})/gi,
    /(?:^|\s)(\d{1,4})(?:\s|$)/g,
  ]

  for (const pattern of weightedPatterns) {
    const matches = [...text.matchAll(pattern)]
    for (const match of matches) {
      const quantity = Number(match[1])
      if (Number.isFinite(quantity) && quantity > 0 && quantity < 5000) {
        return quantity
      }
    }
  }

  return null
}

function buildChunkMatches(text: string): ChunkMatch[] {
  const rawLines = text
    .split('\n')
    .map((line) => sanitizeItemLabel(line.trim()))
    .filter(Boolean)

  const chunks: ChunkMatch[] = []

  rawLines.forEach((line, index) => {
    chunks.push({ text: line, lineIndexes: [index] })

    if (rawLines[index + 1] && !shouldIgnoreLine(line) && !shouldIgnoreLine(rawLines[index + 1])) {
      const currentHasQuantity = hasQuantityHint(line)
      const nextHasQuantity = hasQuantityHint(rawLines[index + 1])

      if (currentHasQuantity !== nextHasQuantity) {
        chunks.push({
          text: sanitizeItemLabel(`${line} ${rawLines[index + 1]}`),
          lineIndexes: [index, index + 1],
        })
      }
    }
  })

  const seen = new Set<string>()
  return chunks.filter((chunk) => {
    const normalized = normalizeText(chunk.text)
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function inferCandidateLinesFromText(text: string, stockItems: StockItemRow[]): CandidateLine[] {
  const chunks = buildChunkMatches(text)
  const inferred: CandidateLine[] = []
  const usedKeys = new Set<string>()

  chunks.forEach((chunk) => {
    if (shouldIgnoreLine(chunk.text)) return

    const quantity = extractLikelyQuantity(chunk.text)
    if (!quantity) return

    const exactMatch = findExactStockItemMatch(chunk.text, stockItems)
    const scoredMatches = findTopMatches(chunk.text, stockItems)
    const bestScore = exactMatch ? 100 : scoredMatches[0]?.score ?? 0
    const bestMatch = exactMatch ?? scoredMatches[0]?.item ?? null
    const rawLabel = exactMatch ? exactMatch.name : resolveLineLabel(chunk.text, scoredMatches)
    const chosenItemId = exactMatch ? exactMatch.id : chooseAutoAssignedItemId(rawLabel, scoredMatches)

    if (!bestMatch || bestScore < 32) return

    const key = `${bestMatch.id}::${quantity}`
    if (usedKeys.has(key)) return
    usedKeys.add(key)

    inferred.push({
      id: `inferred-${bestMatch.id}-${quantity}-${chunk.lineIndexes.join('-')}`,
      rawLabel,
      quantity,
      chosenItemId,
      matches: exactMatch ? orderMatchedItems(exactMatch, scoredMatches) : scoredMatches.map((candidate) => candidate.item),
      bestScore,
    })
  })

  return inferred
}

function resolveStockItemFromStructuredMatch(
  stockItems: StockItemRow[],
  label: string,
  matchedCode: string,
  matchedName: string,
): { item: StockItemRow; bestScore: number; matches: StockItemRow[] } | null {
  const normalizedCode = normalizeText(matchedCode)
  const normalizedName = normalizeText(matchedName)

  if (normalizedCode) {
    const byCode = stockItems.find((item) => normalizeText(item.code) === normalizedCode)
    if (byCode) {
      const scoredMatches = findTopMatches(label || byCode.name, stockItems)
      return {
        item: byCode,
        bestScore: 100,
        matches: orderMatchedItems(byCode, scoredMatches),
      }
    }
  }

  const exactNameLabel = matchedName || label
  const exactNameMatch = findExactStockItemMatch(exactNameLabel, stockItems)
  if (exactNameMatch) {
    const scoredMatches = findTopMatches(exactNameLabel, stockItems)
    return {
      item: exactNameMatch,
      bestScore: 98,
      matches: orderMatchedItems(exactNameMatch, scoredMatches),
    }
  }

  if (!normalizedName && !label) return null

  const scoredMatches = findTopMatches(matchedName || label, stockItems)
  const top = scoredMatches[0]
  if (!top) return null

  const coverage = tokenCoverage(matchedName || label, top.item)
  if (top.score < 50 && coverage < 0.85) return null

  return {
    item: top.item,
    bestScore: top.score,
    matches: scoredMatches.map((candidate) => candidate.item),
  }
}

function extractCandidateLinesFromKimiXml(xml: string, stockItems: StockItemRow[]): CandidateLine[] {
  const parser = new DOMParser()
  const documentNode = parser.parseFromString(xml, 'application/xml')
  const parserError = documentNode.querySelector('parsererror')
  if (parserError) {
    throw new Error('A Kimi retornou XML invalido. Revise o XML abaixo e tente novamente.')
  }

  const itemNodes = [...documentNode.querySelectorAll('item')]

  return itemNodes.flatMap((itemNode, index) => {
    const label = cleanCandidateLabel(
      itemNode.querySelector('name')?.textContent?.trim()
      || itemNode.querySelector('item_name')?.textContent?.trim()
      || itemNode.querySelector('raw_name')?.textContent?.trim()
      || '',
    )
    const quantityValue = Number.parseInt(itemNode.querySelector('quantity')?.textContent?.trim() ?? '', 10)

    if (!label || !Number.isFinite(quantityValue) || quantityValue <= 0) {
      return []
    }

    const matchedCode = cleanCandidateLabel(itemNode.querySelector('matched_stock_code')?.textContent?.trim() ?? '')
    const matchedName = cleanCandidateLabel(itemNode.querySelector('matched_stock_name')?.textContent?.trim() ?? '')
    const resolvedMatch = resolveStockItemFromStructuredMatch(stockItems, label, matchedCode, matchedName)

    if (resolvedMatch) {
      return [{
        id: `kimi-${index}-${normalizeText(resolvedMatch.item.name)}-${quantityValue}`,
        rawLabel: resolvedMatch.item.name,
        quantity: quantityValue,
        chosenItemId: resolvedMatch.item.id,
        matches: resolvedMatch.matches,
        bestScore: resolvedMatch.bestScore,
      }]
    }

    const fallback = buildCandidateLines([{ label, quantity: quantityValue }], stockItems)[0]
    return fallback ? [{ ...fallback, id: `kimi-${index}-${fallback.id}` }] : []
  })
}

function mergeMatches(left: StockItemRow[], right: StockItemRow[]): StockItemRow[] {
  const merged = new Map<string, StockItemRow>()

  left.forEach((item) => merged.set(item.id, item))
  right.forEach((item) => merged.set(item.id, item))

  return [...merged.values()].slice(0, 5)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildStructuredXml(lines: CandidateLine[], rawText = ''): string {
  const itemsXml = lines
    .map((line) => [
      '    <item>',
      `      <name>${escapeXml(line.rawLabel)}</name>`,
      `      <quantity>${line.quantity}</quantity>`,
      `      <matched_stock_name>${escapeXml(line.matches.find((item) => item.id === line.chosenItemId)?.name ?? '')}</matched_stock_name>`,
      `      <matched_stock_code>${escapeXml(line.matches.find((item) => item.id === line.chosenItemId)?.code ?? '')}</matched_stock_code>`,
      `      <stock_item_id>${escapeXml(line.chosenItemId)}</stock_item_id>`,
      '    </item>',
    ].join('\n'))
    .join('\n')

  const rawTextSection = rawText.trim()
    ? `  <raw_text><![CDATA[${rawText}]]></raw_text>\n`
    : ''

  return [
    '<stock_import>',
    rawTextSection + '  <items>',
    itemsXml,
    '  </items>',
    '</stock_import>',
  ].join('\n')
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Nao foi possivel converter o arquivo para base64.'))
        return
      }

      const [, base64Payload = ''] = result.split(',', 2)
      resolve(base64Payload)
    }

    reader.onerror = () => reject(new Error('Nao foi possivel ler o arquivo selecionado.'))
    reader.readAsDataURL(file)
  })
}

async function requestKimiExtraction(file: File, stockItems: StockItemRow[]): Promise<KimiExtractionResponse> {
  const base64 = await readFileAsBase64(file)
  const response = await fetch('/api/kimi-stock-import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64,
      stockItems: stockItems.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
      })),
    }),
  })

  const payload = await response.json().catch(() => null) as { error?: string; xml?: string } | null
  if (!response.ok || !payload?.xml) {
    throw new Error(payload?.error || 'Falha ao consultar a Kimi para extracao estruturada.')
  }

  return { xml: payload.xml }
}

async function preprocessCanvasForOcr(canvas: HTMLCanvasElement): Promise<string> {
  const targetCanvas = document.createElement('canvas')
  targetCanvas.width = Math.max(1, Math.round(canvas.width * 1.4))
  targetCanvas.height = Math.max(1, Math.round(canvas.height * 1.4))

  const context = targetCanvas.getContext('2d')
  if (!context) {
    throw new Error('Nao foi possivel preparar a imagem para OCR.')
  }

  context.imageSmoothingEnabled = false
  context.drawImage(canvas, 0, 0, targetCanvas.width, targetCanvas.height)

  const imageData = context.getImageData(0, 0, targetCanvas.width, targetCanvas.height)
  const { data } = imageData

  for (let offset = 0; offset < data.length; offset += 4) {
    const gray = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
    const contrasted = gray > 172 ? 255 : gray < 88 ? 0 : Math.min(255, Math.max(0, (gray - 128) * 1.55 + 128))
    data[offset] = contrasted
    data[offset + 1] = contrasted
    data[offset + 2] = contrasted
  }

  context.putImageData(imageData, 0, 0)
  return targetCanvas.toDataURL('image/png')
}

async function runOcr(sourceImage: string, onProgress: (label: string) => void, stepLabel: string): Promise<string> {
  const result = await recognize(sourceImage, 'por', {
    logger: (message) => {
      if (message.status) {
        const percent = typeof message.progress === 'number' ? ` ${Math.round(message.progress * 100)}%` : ''
        onProgress(`${stepLabel}: ${message.status}${percent}`)
      }
    },
  })

  return result.data.text
}

function extractTextFromPdfPageItems(items: unknown[]): string {
  const rows = new Map<number, Array<{ text: string; x: number }>>()

  items.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const maybeItem = item as { str?: string; transform?: number[] }
    if (typeof maybeItem.str !== 'string' || !Array.isArray(maybeItem.transform)) return

    const y = Math.round(maybeItem.transform[5] ?? 0)
    const x = Math.round(maybeItem.transform[4] ?? 0)
    const bucket = rows.get(y) ?? []
    bucket.push({ text: maybeItem.str, x })
    rows.set(y, bucket)
  })

  return [...rows.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([, rowItems]) =>
      rowItems
        .sort((left, right) => left.x - right.x)
        .map((entry) => entry.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
}

async function extractTextFromPdf(
  file: File,
  onProgress: (label: string) => void,
): Promise<{ text: string; extracted: ParsedCandidateLine[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const loadingTask = pdfjsLib.getDocument({ data: bytes })
  const pdf = await loadingTask.promise

  const allTexts: string[] = []
  const allExtracted: ParsedCandidateLine[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress(`PDF: processando pagina ${pageNumber} de ${pdf.numPages}`)
    const page = await pdf.getPage(pageNumber)

    const textContent = await page.getTextContent()
    const directText = extractTextFromPdfPageItems(textContent.items as unknown[])
    const directExtracted = extractCandidateLines(directText)

    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('Nao foi possivel preparar a pagina do PDF.')
    }

    await page.render({ canvasContext: context, canvas, viewport }).promise
    const preparedPage = await preprocessCanvasForOcr(canvas)
    const ocrText = await runOcr(preparedPage, onProgress, `PDF OCR pagina ${pageNumber}`)
    const ocrExtracted = extractCandidateLines(ocrText)

    const combinedText = [directText, ocrText].filter(Boolean).join('\n').trim()
    const combinedExtracted = dedupeCandidateLines([...directExtracted, ...ocrExtracted])

    if (combinedText) {
      allTexts.push(combinedText)
    }
    allExtracted.push(...combinedExtracted)
  }

  return {
    text: allTexts.join('\n\n').trim(),
    extracted: dedupeCandidateLines(allExtracted),
  }
}

export function StockImportModal({ onClose, onImported }: StockImportModalProps) {
  const [stockItems, setStockItems] = useState<StockItemRow[]>([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('ocr')
  const [contentFormat, setContentFormat] = useState<ExtractedContentFormat>('plain-text')
  const [ocrText, setOcrText] = useState('')
  const [ocrRunning, setOcrRunning] = useState(false)
  const [progressLabel, setProgressLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lines, setLines] = useState<CandidateLine[]>([])

  const fetchItems = useCallback(async () => {
    setLoadingItems(true)
    const { data, error: fetchError } = await supabase
      .from('stock_items')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (fetchError) {
      setError(fetchError.message)
      setLoadingItems(false)
      return
    }

    setStockItems((data as StockItemRow[]) ?? [])
    setLoadingItems(false)
  }, [])

  useEffect(() => {
    void fetchItems()
  }, [fetchItems])

  const stockOptions = useMemo(
    () => stockItems.map((item) => ({
      value: item.id,
      label: `${item.name} (${item.code})`,
    })),
    [stockItems],
  )

  const finalizeLines = useCallback((combinedLines: CandidateLine[]) => {
    const mergedByKey = new Map<string, CandidateLine>()

    combinedLines.forEach((line) => {
      const bestAssignedItemId = line.chosenItemId || line.matches[0]?.id || 'unmatched'
      const key = `${bestAssignedItemId}::${normalizeText(line.rawLabel)}`
      const current = mergedByKey.get(key)

      if (!current) {
        mergedByKey.set(key, line)
        return
      }

      mergedByKey.set(key, {
        ...current,
        rawLabel: current.bestScore >= line.bestScore ? current.rawLabel : line.rawLabel,
        chosenItemId: current.chosenItemId || line.chosenItemId,
        matches: mergeMatches(current.matches, line.matches),
        bestScore: Math.max(current.bestScore, line.bestScore),
        quantity: current.quantity + line.quantity,
      })
    })

    const nextLines = [...mergedByKey.values()]
      .sort((left, right) => right.bestScore - left.bestScore)
      .map((line, index) => ({ ...line, id: `${line.id}-${index}` }))

    setLines(nextLines)

    if (nextLines.length === 0) {
      setError('Texto extraido, mas ainda sem linhas claras de item + quantidade. Edite o conteudo abaixo e tente novamente.')
      return nextLines
    }

    if (nextLines.every((line) => !line.chosenItemId)) {
      setError('Texto encontrado, mas o match automatico ficou fraco. Escolha manualmente os itens do estoque.')
      return nextLines
    }

    setError(null)
    return nextLines
  }, [])

  const applyParsedText = useCallback((text: string, parsed?: ParsedCandidateLine[]) => {
    const extracted = parsed ?? extractCandidateLines(text)
    const extractedLines = buildCandidateLines(extracted, stockItems)
    const extractedKeys = new Set(
      extractedLines
        .map((line) => {
          const matchedItemId = line.chosenItemId || line.matches[0]?.id
          return matchedItemId ? `${matchedItemId}::${line.quantity}` : ''
        })
        .filter(Boolean),
    )
    const inferredLines = inferCandidateLinesFromText(text, stockItems).filter((line) => {
      const matchedItemId = line.chosenItemId || line.matches[0]?.id
      if (!matchedItemId) return true
      return !extractedKeys.has(`${matchedItemId}::${line.quantity}`)
    })
    const nextLines = finalizeLines(extractedLines.concat(inferredLines))
    setContentFormat('structured-xml')
    setOcrText(buildStructuredXml(nextLines, text))
  }, [finalizeLines, stockItems])

  const applyKimiXml = useCallback((xml: string) => {
    const nextLines = finalizeLines(extractCandidateLinesFromKimiXml(xml, stockItems))
    setContentFormat('structured-xml')
    setOcrText(buildStructuredXml(nextLines))
  }, [finalizeLines, stockItems])

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setError(null)
      setSubmitError(null)
      setSourceFile(file)
      setContentFormat('plain-text')
      setOcrText('')
      setLines([])
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Nao foi possivel ler o arquivo.')
    }
  }

  const handleRunExtraction = async () => {
    if (!sourceFile) return

    setOcrRunning(true)
    setError(null)
    setSubmitError(null)

    try {
      if (extractionMode === 'ocr') {
        if (!(sourceFile.type === 'application/pdf' || sourceFile.name.toLowerCase().endsWith('.pdf'))) {
          setError('OCR local aceita apenas PDF. Para imagem, troque para Kimi API.')
          return
        }

        const pdfResult = await extractTextFromPdf(sourceFile, setProgressLabel)
        applyParsedText(pdfResult.text, pdfResult.extracted)
        return
      }

      setProgressLabel('Kimi: enviando arquivo e estruturando XML...')
      const kimiResult = await requestKimiExtraction(sourceFile, stockItems)
      applyKimiXml(kimiResult.xml)
    } catch (ocrError) {
      setError(ocrError instanceof Error ? ocrError.message : 'Falha ao extrair o texto do arquivo.')
    } finally {
      setOcrRunning(false)
      setProgressLabel('')
    }
  }

  const handleProcessCurrentText = () => {
    setSubmitError(null)
    if (contentFormat === 'structured-xml') {
      applyKimiXml(ocrText)
      return
    }

    applyParsedText(ocrText)
  }

  const handleApply = async () => {
    const selected = lines.filter((line) => line.chosenItemId && line.quantity > 0)
    if (selected.length === 0) {
      setSubmitError('Selecione ao menos um item reconhecido para importar.')
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    try {
      for (const line of selected) {
        const { error: rpcError } = await supabase.rpc('adjust_stock_item_quantity', {
          p_stock_item_id: line.chosenItemId,
          p_delta: line.quantity,
        })

        if (rpcError) {
          throw new Error(`${line.rawLabel}: ${rpcError.message}`)
        }
      }

      onClose()
      onImported()
    } catch (applyError) {
      setSubmitError(applyError instanceof Error ? applyError.message : 'Nao foi possivel importar os itens.')
    } finally {
      setSubmitting(false)
    }
  }

  const sourceLabel = sourceFile
    ? `${sourceFile.name} (${sourceFile.type || 'arquivo'})`
    : null

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert variant="danger">{error}</Alert>}
      {submitError && <Alert variant="danger">{submitError}</Alert>}

      <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
        <p className="mb-2 text-sm font-semibold text-white">1. Envie um arquivo</p>
        <div className="mb-3 max-w-sm">
          <Select
            label="Modo de leitura"
            value={extractionMode}
            onChange={(event) => setExtractionMode(event.target.value as ExtractionMode)}
            options={[
              { value: 'ocr', label: 'OCR local (PDF)' },
              { value: 'kimi', label: 'Kimi API (PDF e imagem)' },
            ]}
          />
        </div>
        <input
          type="file"
          accept={extractionMode === 'kimi' ? '.pdf,application/pdf,image/*' : '.pdf,application/pdf'}
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-400 file:mr-4 file:rounded-lg file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-orange-600"
        />
        <p className="mt-2 text-xs text-gray-500">
          {extractionMode === 'kimi'
            ? 'Kimi recebe PDF ou imagem, devolve XML estruturado e tenta atribuir o item certo sem diferenca por maiuscula.'
            : 'PDF com texto usa leitura direta. PDF escaneado recebe OCR reforcado por pagina.'}
        </p>
      </div>

      {sourceFile && (
        <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">{sourceLabel}</p>
              <p className="mt-1 text-xs text-gray-500">
                {extractionMode === 'kimi'
                  ? 'Fluxo Kimi: upload seguro no backend, leitura estruturada e retorno em XML com sugestao de atribuicao.'
                  : 'Fluxo PDF-first: leitura direta do documento e OCR por pagina para reforco.'}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Button
                variant="primary"
                onClick={() => void handleRunExtraction()}
                isLoading={ocrRunning}
                disabled={loadingItems}
              >
                {extractionMode === 'kimi' ? 'Extrair com Kimi' : 'Extrair texto'}
              </Button>
              {loadingItems && !ocrRunning && (
                <div className="max-w-56 text-xs text-gray-400">Carregando base do estoque...</div>
              )}
              {ocrRunning && (
                <div className="max-w-56 text-xs text-gray-400">{progressLabel || 'Processando...'}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {sourceFile && (
        <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">
                  {contentFormat === 'structured-xml' ? '2. XML extraido' : '2. Texto extraido'}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {contentFormat === 'structured-xml'
                    ? 'Pode revisar o XML da Kimi e reprocessar. Os itens atribuídos continuam sendo validados contra o estoque local.'
                    : 'Edite se necessario e reprocesse. Isso evita perder item por OCR imperfeito.'}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={handleProcessCurrentText}
                disabled={!ocrText.trim()}
              >
                {contentFormat === 'structured-xml' ? 'Processar XML' : 'Processar texto'}
              </Button>
            </div>

            <textarea
              value={ocrText}
              onChange={(event) => setOcrText(event.target.value)}
              rows={10}
              placeholder={contentFormat === 'structured-xml'
                ? 'O XML retornado pela Kimi vai aparecer aqui.'
                : 'O texto extraido vai aparecer aqui. Se faltar algo, complemente manualmente e clique em Processar texto.'}
              className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none transition-colors focus:border-orange-500 focus:ring-2 focus:ring-orange-500/40"
            />
          </div>
        </div>
      )}

      {lines.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
            <p className="text-sm font-semibold text-white">3. Revise itens reconhecidos</p>
            <p className="mt-1 text-xs text-gray-500">Linhas confiantes sao autoatribuidas. Linhas fracas ficam para revisao manual.</p>
          </div>

          {lines.map((line) => (
            <div key={line.id} className="rounded-2xl border border-white/8 bg-[#111215] p-4">
              <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[1.2fr_180px_1.2fr] lg:items-end">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Texto lido</p>
                  <Input
                    value={line.rawLabel}
                    onChange={(event) => {
                      const rawLabel = event.target.value
                      setLines((prev) => prev.map((item) => {
                        if (item.id !== line.id) return item
                        const exactMatch = findExactStockItemMatch(rawLabel, stockItems)
                        const rescored = findTopMatches(rawLabel, stockItems)
                        const matches = exactMatch ? orderMatchedItems(exactMatch, rescored) : rescored.map((candidate) => candidate.item)
                        const bestScore = exactMatch ? 100 : rescored[0]?.score ?? 0
                        const canonicalLabel = exactMatch ? exactMatch.name : sanitizeItemLabel(rawLabel)

                        return {
                          ...item,
                          rawLabel: canonicalLabel,
                          matches,
                          bestScore,
                          chosenItemId: exactMatch?.id || chooseAutoAssignedItemId(canonicalLabel, rescored) || item.chosenItemId,
                        }
                      }))
                    }}
                  />
                </div>

                <Input
                  label="Quantidade"
                  type="number"
                  min={1}
                  value={String(line.quantity)}
                  onChange={(event) => {
                    const quantity = parseInt(event.target.value, 10) || 0
                    setLines((prev) => prev.map((item) => item.id === line.id ? { ...item, quantity } : item))
                  }}
                />

                <Select
                  label="Item no estoque"
                  value={line.chosenItemId}
                  onChange={(event) => {
                    const chosenItemId = event.target.value
                    setLines((prev) => prev.map((item) => item.id === line.id ? { ...item, chosenItemId } : item))
                  }}
                  options={line.matches.length > 0
                    ? line.matches.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }))
                    : stockOptions}
                  placeholder="Escolha um item"
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setLines((prev) => prev.filter((item) => item.id !== line.id))}
                >
                  Remover
                </Button>
              </div>
            </div>
          ))}

          <div className="flex justify-end gap-3 border-t border-white/8 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void handleApply()} isLoading={submitting}>
              Aplicar no estoque
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
