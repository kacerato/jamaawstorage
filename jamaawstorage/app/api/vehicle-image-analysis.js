const ZAI_API_URL = 'https://api.z.ai/api/paas/v4'

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
  if (numeric > 1) return clampNumber(numeric / 100, 0, 1)
  return clampNumber(numeric, 0, 1)
}

function normalizeFuelRange(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (['reserva', 'baixo', 'meio', 'alto', 'cheio'].includes(text)) return text
  return null
}

function fuelPercentFromBars(filledBars, totalBars) {
  const filled = clampNumber(filledBars, 0, 99)
  const total = clampNumber(totalBars, 1, 99)
  if (filled == null || total == null) return null
  return Math.round((filled / total) * 100)
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

function normalizeAnalysis(analysis) {
  const barBasedPercent = fuelPercentFromBars(analysis?.fuel_bars_filled, analysis?.fuel_bars_total)
  const fuelLevelPercent = barBasedPercent ?? clampNumber(analysis?.fuel_level_percent, 0, 100)
  const confidence = normalizeConfidence(analysis?.confidence)
  const needsReview = Boolean(analysis?.needs_review) || confidence == null || confidence < 0.88 || fuelLevelPercent == null

  return {
    odometerKm: clampNumber(analysis?.odometer_km, 0, 9999999),
    fuelLevelPercent,
    fuelLevelRange: fuelRangeFromPercent(fuelLevelPercent) ?? normalizeFuelRange(analysis?.fuel_level_range),
    fuelBarsFilled: clampNumber(analysis?.fuel_bars_filled, 0, 99),
    fuelBarsTotal: clampNumber(analysis?.fuel_bars_total, 1, 99),
    fuelLiters: clampNumber(analysis?.fuel_liters, 0, 9999),
    fuelAmount: clampNumber(analysis?.fuel_amount, 0, 999999),
    stationName: typeof analysis?.station_name === 'string' ? analysis.station_name.trim() || null : null,
    confidence,
    needsReview,
    summary: typeof analysis?.summary === 'string' ? analysis.summary.trim() || null : null,
  }
}

async function runGlmOcr(apiKey, imageInput) {
  const response = await fetch(`${ZAI_API_URL}/layout_parsing`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'glm-ocr',
      file: imageInput,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.msg || 'Falha ao executar GLM-OCR.')
  }

  return JSON.stringify(payload?.data ?? payload)
}

async function runVisionAnalysis(apiKey, imageInput, eventType, ocrText) {
  const response = await fetch(`${ZAI_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'glm-5v-turbo',
      messages: [
        {
          role: 'system',
          content: [
            'Analise fotos de evidencia de uso de veiculo para um controle de frota.',
            'Responda obrigatoriamente em portugues do Brasil.',
            'Retorne apenas JSON valido, sem markdown.',
            'Estime odometer_km, fuel_level_percent, fuel_level_range, fuel_liters, fuel_amount, station_name, confidence, needs_review e summary quando estiverem visiveis.',
            'Use null para campos que nao estiverem visiveis ou confiaveis.',
            'fuel_level_percent deve ser de 0 a 100.',
            'fuel_level_range deve ser reserva, baixo, meio, alto ou cheio.',
            'REGRA CRITICA PARA O SHINERAY TLUX T30 2025: o combustivel aparece como uma barra digital entre E e F com 8 pontos/barras no total.',
            'Conte quantas barras claras/preenchidas aparecem entre E e F.',
            'Calcule fuel_level_percent = round((fuel_bars_filled / fuel_bars_total) * 100).',
            'Exemplo obrigatorio: se houver 4 barras preenchidas de 8, retorne fuel_bars_filled=4, fuel_bars_total=8, fuel_level_percent=50 e fuel_level_range="meio". Nao chame isso de baixo.',
            'So use estimativa por faixa visual quando nao for possivel contar barras.',
            'Para saida e chegada, priorize painel: odometro e marcador de combustivel. Para abastecimento, tambem leia bomba/cupom se aparecer.',
            'Marque needs_review como true se a foto estiver inclinada, cortada, com reflexo, painel ilegivel, ou se combustivel tiver baixa confianca.',
            'confidence deve ser decimal de 0 a 1 considerando principalmente combustivel e odometro.',
            'summary deve ser uma frase curta em portugues brasileiro, objetiva, citando o que foi possivel confirmar na imagem.',
            'O primeiro veiculo cadastrado e um Shineray TLux T30 2025.',
            'Formato obrigatorio:',
            '{"odometer_km":number|null,"fuel_level_percent":number|null,"fuel_level_range":"reserva|baixo|meio|alto|cheio"|null,"fuel_bars_filled":number|null,"fuel_bars_total":number|null,"fuel_liters":number|null,"fuel_amount":number|null,"station_name":string|null,"confidence":number,"needs_review":boolean,"summary":string}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageInput } },
            { type: 'text', text: `Tipo de registro: ${eventType}. Texto OCR bruto: ${ocrText.slice(0, 6000)}. Responda em portugues do Brasil.` },
          ],
        },
      ],
    }),
  })

  const payload = await response.json().catch(() => null)
  const content = payload?.choices?.[0]?.message?.content

  if (!response.ok || !content) {
    throw new Error(payload?.error?.message || 'Falha ao analisar a imagem do veiculo.')
  }

  return parseJsonContent(content)
}

async function runFocusedFuelAnalysis(apiKey, imageInput, eventType, ocrText, firstAnalysis) {
  const response = await fetch(`${ZAI_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'glm-5v-turbo',
      messages: [
        {
          role: 'system',
          content: [
            'Voce e um verificador visual de marcador de combustivel.',
            'Responda apenas JSON valido em portugues do Brasil.',
            'Ignore tudo exceto o marcador de combustivel do painel, bomba ou comprovante.',
            'Procure ponteiro, barras digitais, letras E/F, reserva, escala de tanque e icones de combustivel.',
            'No Shineray TLux T30 2025, o marcador de combustivel digital tem 8 barras/pontos entre E e F.',
            'Conte as barras preenchidas. A porcentagem deve ser round((barras preenchidas / 8) * 100).',
            'Se vir 4 barras preenchidas de 8, retorne exatamente 50%, fuel_level_range="meio" e summary dizendo que ha 4 de 8 barras.',
            'Classifique fuel_level_range como reserva, baixo, meio, alto ou cheio.',
            'Nunca classifique 4 de 8 barras como baixo.',
            'Use needs_review true se o marcador nao estiver nitido.',
            'confidence deve ser decimal de 0 a 1.',
            'Formato: {"fuel_level_percent":number|null,"fuel_level_range":"reserva|baixo|meio|alto|cheio"|null,"fuel_bars_filled":number|null,"fuel_bars_total":number|null,"confidence":number,"needs_review":boolean,"summary":string}',
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
                `OCR bruto: ${ocrText.slice(0, 3000)}.`,
                `Primeira analise: ${JSON.stringify(firstAnalysis).slice(0, 3000)}.`,
                'Reavalie somente o combustivel e responda em portugues do Brasil.',
              ].join('\n'),
            },
          ],
        },
      ],
    }),
  })

  const payload = await response.json().catch(() => null)
  const content = payload?.choices?.[0]?.message?.content

  if (!response.ok || !content) {
    return null
  }

  return parseJsonContent(content)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { error: 'Method not allowed.' })
    return
  }

  const apiKey = process.env.ZAI_API_KEY
  if (!apiKey) {
    sendJson(res, 500, { error: 'ZAI_API_KEY nao configurada no servidor.' })
    return
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    sendJson(res, 400, { error: 'JSON invalido.' })
    return
  }

  const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : ''
  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : ''
  const eventType = typeof body?.eventType === 'string' ? body.eventType : 'pickup'
  const imageInput = imageUrl || dataUrl

  if (!imageInput || (!imageInput.startsWith('http') && !imageInput.startsWith('data:image/'))) {
    sendJson(res, 400, { error: 'Envie uma URL publica da imagem ou uma imagem em base64 data URL.' })
    return
  }

  try {
    const ocrText = await runGlmOcr(apiKey, imageInput)
    const initialAnalysis = await runVisionAnalysis(apiKey, imageInput, eventType, ocrText)
    let analysis = normalizeAnalysis(initialAnalysis)

    if (analysis.needsReview || analysis.fuelLevelPercent == null) {
      const focusedFuel = await runFocusedFuelAnalysis(apiKey, imageInput, eventType, ocrText, initialAnalysis)
      if (focusedFuel) {
        const focused = normalizeAnalysis({
          ...initialAnalysis,
          fuel_level_percent: focusedFuel.fuel_level_percent,
          fuel_level_range: focusedFuel.fuel_level_range,
          fuel_bars_filled: focusedFuel.fuel_bars_filled,
          fuel_bars_total: focusedFuel.fuel_bars_total,
          confidence: focusedFuel.confidence,
          needs_review: focusedFuel.needs_review,
          summary: focusedFuel.summary || initialAnalysis.summary,
        })
        analysis = {
          ...analysis,
          fuelLevelPercent: focused.fuelLevelPercent ?? analysis.fuelLevelPercent,
          fuelLevelRange: focused.fuelLevelRange ?? analysis.fuelLevelRange,
          confidence: Math.max(analysis.confidence ?? 0, focused.confidence ?? 0),
          needsReview: focused.needsReview,
          summary: focused.summary ?? analysis.summary,
        }
      }
    }

    sendJson(res, 200, {
      ocrText,
      odometerKm: analysis.odometerKm,
      fuelLevelPercent: analysis.fuelLevelPercent,
      fuelLevelRange: analysis.fuelLevelRange,
      fuelBarsFilled: analysis.fuelBarsFilled,
      fuelBarsTotal: analysis.fuelBarsTotal,
      fuelLiters: analysis.fuelLiters,
      fuelAmount: analysis.fuelAmount,
      stationName: analysis.stationName,
      confidence: analysis.confidence,
      needsReview: analysis.needsReview,
      summary: analysis.summary,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao processar a imagem do veiculo.'
    sendJson(res, 500, { error: message })
  }
}
