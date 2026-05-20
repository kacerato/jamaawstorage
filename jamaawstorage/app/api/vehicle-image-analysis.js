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

function normalizeAnalysis(analysis) {
  const fuelLevelPercent = clampNumber(analysis?.fuel_level_percent, 0, 100)
  const confidence = normalizeConfidence(analysis?.confidence)
  const needsReview = Boolean(analysis?.needs_review) || confidence == null || confidence < 0.88 || fuelLevelPercent == null

  return {
    odometerKm: clampNumber(analysis?.odometer_km, 0, 9999999),
    fuelLevelPercent,
    fuelLevelRange: normalizeFuelRange(analysis?.fuel_level_range),
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
            'Interprete o combustivel primeiro por faixa visual: reserva ~= 5, baixo ~= 20, meio ~= 50, alto ~= 75, cheio ~= 100. Depois ajuste a porcentagem conforme ponteiro, barras ou display.',
            'Para saida e chegada, priorize painel: odometro e marcador de combustivel. Para abastecimento, tambem leia bomba/cupom se aparecer.',
            'Marque needs_review como true se a foto estiver inclinada, cortada, com reflexo, painel ilegivel, ou se combustivel tiver baixa confianca.',
            'confidence deve ser decimal de 0 a 1 considerando principalmente combustivel e odometro.',
            'summary deve ser uma frase curta em portugues brasileiro, objetiva, citando o que foi possivel confirmar na imagem.',
            'O primeiro veiculo cadastrado e um Shineray TLux T30 2025.',
            'Formato obrigatorio:',
            '{"odometer_km":number|null,"fuel_level_percent":number|null,"fuel_level_range":"reserva|baixo|meio|alto|cheio"|null,"fuel_liters":number|null,"fuel_amount":number|null,"station_name":string|null,"confidence":number,"needs_review":boolean,"summary":string}',
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
            'Classifique fuel_level_range como reserva, baixo, meio, alto ou cheio.',
            'Converta a faixa para fuel_level_percent com estimativa conservadora.',
            'Use needs_review true se o marcador nao estiver nitido.',
            'confidence deve ser decimal de 0 a 1.',
            'Formato: {"fuel_level_percent":number|null,"fuel_level_range":"reserva|baixo|meio|alto|cheio"|null,"confidence":number,"needs_review":boolean,"summary":string}',
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
