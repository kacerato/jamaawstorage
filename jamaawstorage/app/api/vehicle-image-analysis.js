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
            'Estime odometer_km, fuel_level_percent, fuel_liters, fuel_amount, station_name, confidence e summary quando estiverem visiveis.',
            'Use null para campos que nao estiverem visiveis ou confiaveis.',
            'fuel_level_percent deve ser de 0 a 100.',
            'summary deve ser uma frase curta em portugues brasileiro, objetiva, citando o que foi possivel confirmar na imagem.',
            'O primeiro veiculo cadastrado e um Shineray TLux T30 2025.',
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
    const analysis = await runVisionAnalysis(apiKey, imageInput, eventType, ocrText)

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
