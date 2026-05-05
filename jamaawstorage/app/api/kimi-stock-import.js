const KIMI_API_URL = 'https://api.moonshot.ai/v1'

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload)
}

function extractXmlPayload(content) {
  if (typeof content !== 'string') return ''

  const trimmed = content.trim()
  const fencedMatch = trimmed.match(/```(?:xml)?\s*([\s\S]*?)```/i)
  const unfenced = fencedMatch ? fencedMatch[1].trim() : trimmed
  const xmlMatch = unfenced.match(/<stock_import[\s\S]*<\/stock_import>/i)

  return (xmlMatch ? xmlMatch[0] : unfenced).trim()
}

function buildCatalogPrompt(stockItems) {
  return stockItems
    .map((item) => `- code="${item.code}" | name="${item.name}" | id="${item.id}"`)
    .join('\n')
}

function buildMessages(fileContent, stockItems) {
  const catalogPrompt = buildCatalogPrompt(stockItems)

  return [
    {
      role: 'system',
      content: [
        'You extract stock-import items from OCR or document text.',
        'Return XML only. No markdown fences. No explanation.',
        'Match stock items case-insensitively and accent-insensitively.',
        'If text has extra descriptors, keep only the canonical stock item name when the catalog makes the match clear.',
        'Never create a separate item only because uppercase/lowercase changed.',
        'When a safe match exists, fill matched_stock_code, matched_stock_name, and stock_item_id from the provided catalog.',
        'When a safe match does not exist, leave matched_stock_code, matched_stock_name, and stock_item_id empty.',
        'Output schema:',
        '<stock_import><items><item><name>...</name><quantity>...</quantity><matched_stock_code>...</matched_stock_code><matched_stock_name>...</matched_stock_name><stock_item_id>...</stock_item_id></item></items></stock_import>',
      ].join('\n'),
    },
    {
      role: 'system',
      content: `STOCK CATALOG\n${catalogPrompt}`,
    },
    {
      role: 'system',
      content: `EXTRACTED FILE CONTENT\n${fileContent}`,
    },
    {
      role: 'user',
      content: 'Extract the stock items from this document and return the XML.',
    },
  ]
}

async function uploadFileToKimi(apiKey, fileName, mimeType, base64) {
  const fileBytes = Buffer.from(base64, 'base64')
  const formData = new FormData()
  formData.append('purpose', 'file-extract')
  formData.append('file', new Blob([fileBytes], { type: mimeType }), fileName)

  const response = await fetch(`${KIMI_API_URL}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.error?.message || 'Falha ao enviar arquivo para a Kimi.')
  }

  return payload.id
}

async function fetchExtractedFileContent(apiKey, fileId) {
  const response = await fetch(`${KIMI_API_URL}/files/${fileId}/content`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  const fileContent = await response.text()
  if (!response.ok || !fileContent.trim()) {
    throw new Error('A Kimi nao retornou conteudo extraido para este arquivo.')
  }

  return fileContent
}

async function runKimiStructuredImport(apiKey, fileContent, stockItems) {
  const response = await fetch(`${KIMI_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'kimi-k2.6',
      thinking: { type: 'disabled' },
      messages: buildMessages(fileContent, stockItems),
    }),
  })

  const payload = await response.json().catch(() => null)
  const content = payload?.choices?.[0]?.message?.content
  const xml = extractXmlPayload(content)

  if (!response.ok || !xml) {
    throw new Error(payload?.error?.message || 'A Kimi nao retornou XML estruturado.')
  }

  return xml
}

async function deleteUploadedFile(apiKey, fileId) {
  try {
    await fetch(`${KIMI_API_URL}/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
  } catch {
    // Ignore cleanup failures to avoid breaking the import flow.
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { error: 'Method not allowed.' })
    return
  }

  const apiKey = process.env.KIMI_API
  if (!apiKey) {
    sendJson(res, 500, { error: 'KIMI_API nao configurada no servidor.' })
    return
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    sendJson(res, 400, { error: 'JSON invalido.' })
    return
  }
  const fileName = typeof body?.fileName === 'string' ? body.fileName : ''
  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType : 'application/octet-stream'
  const base64 = typeof body?.base64 === 'string' ? body.base64 : ''
  const stockItems = Array.isArray(body?.stockItems) ? body.stockItems : []

  if (!fileName || !base64 || stockItems.length === 0) {
    sendJson(res, 400, { error: 'Arquivo ou catalogo de estoque ausente.' })
    return
  }

  let fileId = ''

  try {
    fileId = await uploadFileToKimi(apiKey, fileName, mimeType, base64)
    const fileContent = await fetchExtractedFileContent(apiKey, fileId)
    const xml = await runKimiStructuredImport(apiKey, fileContent, stockItems)

    sendJson(res, 200, { xml })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao processar o arquivo com a Kimi.'
    sendJson(res, 500, { error: message })
  } finally {
    if (fileId) {
      await deleteUploadedFile(apiKey, fileId)
    }
  }
}
