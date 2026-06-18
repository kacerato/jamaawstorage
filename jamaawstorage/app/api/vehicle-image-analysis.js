const ZAI_API_URL = 'https://api.z.ai/api/paas/v4'
const DEFAULT_VEHICLE_VISION_MODEL = 'glm-4.5v'
const CV_TIMEOUT_MS = 3500

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload)
}

function parseJsonContent(content) {
  if (typeof content !== 'string') return {}
  const trimmed = content.trim()
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const jsonText = fencedMatch ? fencedMatch[1].trim() : trimmed
  try {
    return JSON.parse(jsonText)
  } catch {
    return { summary: trimmed }
  }
}

function clampNumber(value, min, max) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.min(Math.max(numeric, min), max)
}

function normalizeConfidence(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return clampNumber(numeric > 1 ? numeric / 100 : numeric, 0, 1)
}

function fuelRangeFromPercent(percent) {
  const value = clampNumber(percent, 0, 100)
  if (value == null) return null
  if (value <= 12) return 'reserva'
  if (value < 40) return 'baixo'
  if (value < 65) return 'meio'
  if (value < 90) return 'alto'
  return 'cheio'
}

function normalizeFuelRange(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return ['reserva', 'baixo', 'meio', 'alto', 'cheio'].includes(text) ? text : null
}

function normalizeVision(analysis) {
  const barsFilled = clampNumber(analysis?.fuel_bars_filled, 0, 8)
  const barsTotal = clampNumber(analysis?.fuel_bars_total, 1, 8)
  const barPercent = barsFilled != null && barsTotal != null
    ? Math.round((barsFilled / barsTotal) * 100)
    : null
  const fuelLevelPercent = barPercent ?? clampNumber(analysis?.fuel_level_percent, 0, 100)
  const confidence = normalizeConfidence(analysis?.confidence)
  return {
    odometerKm: clampNumber(analysis?.odometer_km, 0, 9999999),
    fuelLevelPercent,
    fuelLevelRange: fuelRangeFromPercent(fuelLevelPercent) ?? normalizeFuelRange(analysis?.fuel_level_range),
    fuelBarsFilled: barsFilled,
    fuelBarsTotal: barsTotal,
    fuelLiters: clampNumber(analysis?.fuel_liters, 0, 9999),
    fuelAmount: clampNumber(analysis?.fuel_amount, 0, 999999),
    stationName: typeof analysis?.station_name === 'string' ? analysis.station_name.trim() || null : null,
    ocrText: typeof analysis?.ocr_text === 'string' ? analysis.ocr_text.trim() || null : null,
    confidence,
    needsReview: Boolean(analysis?.needs_review) || confidence == null || confidence < 0.82,
    summary: typeof analysis?.summary === 'string' ? analysis.summary.trim() || null : null,
    method: 'vision-fallback',
  }
}

async function runComputerVision(imageUrl, eventType) {
  const serviceUrl = process.env.VEHICLE_CV_SERVICE_URL?.replace(/\/$/, '')
  const serviceToken = process.env.VEHICLE_CV_SERVICE_TOKEN
  if (!serviceUrl) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CV_TIMEOUT_MS)
  try {
    const response = await fetch(`${serviceUrl}/v1/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
      },
      body: JSON.stringify({ image_url: imageUrl, event_type: eventType }),
      signal: controller.signal,
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function runVisionFallback(apiKey, imageInput, eventType, cvAnalysis) {
  const model = process.env.ZAI_VEHICLE_VISION_MODEL || DEFAULT_VEHICLE_VISION_MODEL
  const response = await fetch(`${ZAI_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: [
            'Voce e o fallback visual de um sistema deterministico de leitura de veiculos.',
            'Responda somente JSON valido, em portugues do Brasil e sem markdown.',
            'Nao invente valores. Use null quando a imagem nao sustentar a leitura.',
            'odometer_km vem exclusivamente do valor ao lado de ODO; TRIP nunca e odometro.',
            'No Shineray TLux T30 2025, conte os retangulos verticais preenchidos entre E e F, num total de 8 barras.',
            'Para abastecimento, leia tambem litros, valor e posto quando aparecerem em bomba ou comprovante.',
            'Formato: {"odometer_km":number|null,"fuel_level_percent":number|null,"fuel_level_range":"reserva|baixo|meio|alto|cheio"|null,"fuel_bars_filled":number|null,"fuel_bars_total":number|null,"fuel_liters":number|null,"fuel_amount":number|null,"station_name":string|null,"ocr_text":string|null,"confidence":number,"needs_review":boolean,"summary":string}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageInput } },
            {
              type: 'text',
              text: [
                `Tipo de registro: ${eventType}.`,
                `Leitura local previa: ${JSON.stringify(cvAnalysis ?? {}).slice(0, 2500)}.`,
                'Confirme somente os campos ausentes ou duvidosos. Se a leitura local estiver coerente, preserve-a.',
              ].join('\n'),
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 700,
      stream: false,
    }),
  })

  const payload = await response.json().catch(() => null)
  const content = payload?.choices?.[0]?.message?.content
  if (!response.ok || !content) {
    throw new Error(payload?.error?.message || 'Falha no fallback visual do veiculo.')
  }
  return normalizeVision(parseJsonContent(content))
}

function cvIsComplete(cv, eventType) {
  if (!cv || cv.needsReview || Number(cv.confidence) < 0.82) return false
  if (eventType === 'fuel') return false
  return cv.odometerKm != null && cv.fuelBarsFilled != null
}

function mergeAnalyses(cv, fallback) {
  if (!cv) return fallback
  if (!fallback) return cv
  const cvTrusted = !cv.needsReview && Number(cv.confidence) >= 0.82
  return {
    ...fallback,
    odometerKm: cvTrusted && cv.odometerKm != null ? cv.odometerKm : fallback.odometerKm,
    fuelLevelPercent: cvTrusted && cv.fuelLevelPercent != null ? cv.fuelLevelPercent : fallback.fuelLevelPercent,
    fuelLevelRange: cvTrusted && cv.fuelLevelRange ? cv.fuelLevelRange : fallback.fuelLevelRange,
    fuelBarsFilled: cvTrusted && cv.fuelBarsFilled != null ? cv.fuelBarsFilled : fallback.fuelBarsFilled,
    fuelBarsTotal: cvTrusted && cv.fuelBarsTotal != null ? cv.fuelBarsTotal : fallback.fuelBarsTotal,
    ocrText: cvTrusted && cv.ocrText ? cv.ocrText : fallback.ocrText,
    confidence: cvTrusted ? Math.min(Number(cv.confidence), fallback.confidence ?? 1) : fallback.confidence,
    needsReview: cvTrusted ? false : fallback.needsReview,
    summary: [cv.summary, fallback.summary].filter(Boolean).join(' '),
    method: cvTrusted ? 'opencv+vision-fallback' : 'vision-fallback',
    timingsMs: cv.timingsMs,
    qrPayload: cv.qrPayload ?? null,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { error: 'Method not allowed.' })
    return
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    sendJson(res, 400, { error: 'JSON invalido.' })
    return
  }
  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : ''
  const eventType = ['pickup', 'return', 'fuel'].includes(body?.eventType) ? body.eventType : 'pickup'
  if (!imageUrl.startsWith('https://')) {
    sendJson(res, 400, { error: 'Envie uma URL HTTPS da imagem.' })
    return
  }

  const totalStarted = Date.now()
  const cvStarted = Date.now()
  const cvAnalysis = await runComputerVision(imageUrl, eventType)
  const cvDuration = Date.now() - cvStarted

  if (cvIsComplete(cvAnalysis, eventType)) {
    res.setHeader('Server-Timing', `cv;dur=${cvDuration}, total;dur=${Date.now() - totalStarted}`)
    sendJson(res, 200, cvAnalysis)
    return
  }

  const apiKey = process.env.ZAI_API_KEY
  if (!apiKey) {
    if (cvAnalysis) {
      sendJson(res, 200, { ...cvAnalysis, needsReview: true })
      return
    }
    sendJson(res, 503, { error: 'Visao computacional indisponivel e ZAI_API_KEY nao configurada.' })
    return
  }

  try {
    const aiStarted = Date.now()
    const fallback = await runVisionFallback(apiKey, imageUrl, eventType, cvAnalysis)
    const aiDuration = Date.now() - aiStarted
    const result = mergeAnalyses(cvAnalysis, fallback)
    res.setHeader('Server-Timing', `cv;dur=${cvDuration}, ai;dur=${aiDuration}, total;dur=${Date.now() - totalStarted}`)
    sendJson(res, 200, result)
  } catch (error) {
    if (cvAnalysis) {
      sendJson(res, 200, { ...cvAnalysis, needsReview: true })
      return
    }
    const message = error instanceof Error ? error.message : 'Falha ao processar a imagem do veiculo.'
    sendJson(res, 500, { error: message })
  }
}
