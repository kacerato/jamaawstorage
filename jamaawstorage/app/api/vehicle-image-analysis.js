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

async function runGlmOcr(apiKey, dataUrl) {
  const response = await fetch(`${ZAI_API_URL}/layout_parsing`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'glm-ocr',
      file: dataUrl,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.msg || 'Falha ao executar GLM-OCR.')
  }

  return JSON.stringify(payload?.data ?? payload)
}

async function runVisionAnalysis(apiKey, dataUrl, eventType, ocrText) {
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
            'Analyze vehicle evidence photos for a fleet log.',
            'Return JSON only, no markdown.',
            'Estimate odometer_km, fuel_level_percent, fuel_liters, fuel_amount, station_name, confidence, and summary when visible.',
            'Use null for fields that are not visible or uncertain.',
            'fuel_level_percent must be 0 to 100.',
            'The first registered vehicle model is Shineray TLux T30 2025.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Event type: ${eventType}. OCR text: ${ocrText.slice(0, 6000)}` },
            { type: 'image_url', image_url: { url: dataUrl } },
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
  const eventType = typeof body?.eventType === 'string' ? body.eventType : 'pickup'

  if (!dataUrl.startsWith('data:image/')) {
    sendJson(res, 400, { error: 'Envie uma imagem em base64 data URL.' })
    return
  }

  try {
    const ocrText = await runGlmOcr(apiKey, dataUrl)
    const analysis = await runVisionAnalysis(apiKey, dataUrl, eventType, ocrText)

    sendJson(res, 200, {
      ocrText,
      odometerKm: analysis.odometer_km ?? null,
      fuelLevelPercent: analysis.fuel_level_percent ?? null,
      fuelLiters: analysis.fuel_liters ?? null,
      fuelAmount: analysis.fuel_amount ?? null,
      stationName: analysis.station_name ?? null,
      confidence: analysis.confidence ?? null,
      summary: analysis.summary ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao processar a imagem do veiculo.'
    sendJson(res, 500, { error: message })
  }
}
