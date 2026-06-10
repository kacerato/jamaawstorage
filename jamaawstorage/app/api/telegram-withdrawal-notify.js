function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload)
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function isImageUrl(url) {
  return typeof url === 'string' && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)
}

function formatDateTime(value) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function itemDestinationLabel(item, withdrawal) {
  const destinationType = item.destination_type || withdrawal.destination_type

  if (destinationType === 'collaborator') {
    return item.collaborator?.full_name || withdrawal.collaborator?.full_name || 'Colaborador'
  }

  return item.work_site?.name || withdrawal.work_site?.name || 'Obra'
}

function destinationLabel(withdrawal) {
  const items = Array.isArray(withdrawal.withdrawal_items) ? withdrawal.withdrawal_items : []
  const destinations = [...new Set(items.map((item) => itemDestinationLabel(item, withdrawal)).filter(Boolean))]

  if (destinations.length > 0) {
    return destinations.join(' / ')
  }

  if (withdrawal.destination_type === 'collaborator') {
    return withdrawal.collaborator?.full_name || 'Colaborador'
  }

  return withdrawal.work_site?.name || 'Obra'
}

function buildItemsList(withdrawal) {
  const items = Array.isArray(withdrawal.withdrawal_items) ? withdrawal.withdrawal_items : []
  if (items.length === 0) {
    return '- Sem itens'
  }

  return items
    .map((item) => `- ${escapeHtml(item.stock_items?.name || 'Item')} - <b>${item.quantity} ${escapeHtml(item.unit || 'un')}</b> - ${escapeHtml(itemDestinationLabel(item, withdrawal))}`)
    .join('\n')
}

function resolveSharedSignatureAttachment(withdrawal) {
  return {
    url: withdrawal.supervisor_signature_attachment_url || withdrawal.requester_signature_attachment_url || null,
    name: withdrawal.supervisor_signature_attachment_name || withdrawal.requester_signature_attachment_name || null,
  }
}

function buildMessage(withdrawal, channelUrl) {
  const totalUnits = (withdrawal.withdrawal_items || []).reduce((sum, item) => sum + (item.quantity || 0), 0)
  const sharedAttachment = resolveSharedSignatureAttachment(withdrawal)
  const sharedAttachmentLine = sharedAttachment.name
    ? `\n<b>Documento de assinaturas:</b> ${escapeHtml(sharedAttachment.name)}`
    : ''

  return [
    '<b>Nova Retirada Registrada</b>',
    '',
    `<b>Codigo:</b> ${escapeHtml(withdrawal.code || 'Sem codigo')}`,
    `<b>Data:</b> ${escapeHtml(formatDateTime(withdrawal.created_at))}`,
    `<b>Destino:</b> ${escapeHtml(destinationLabel(withdrawal))}`,
    `<b>Solicitante:</b> ${escapeHtml(withdrawal.requested_by_person?.full_name || 'Nao informado')}`,
    `<b>Supervisor:</b> ${escapeHtml(withdrawal.approved_by_profile?.full_name || 'Nao informado')}`,
    `<b>Status:</b> ${escapeHtml(withdrawal.status)}`,
    `<b>Total de unidades:</b> ${totalUnits}`,
    withdrawal.notes ? `<b>Observacoes:</b> ${escapeHtml(withdrawal.notes)}` : '<b>Observacoes:</b> Nenhuma',
    '',
    '<b>Itens</b>',
    buildItemsList(withdrawal),
    '',
    `<b>Print assinatura supervisor:</b> ${withdrawal.supervisor_signature ? 'Sim' : 'Nao'}`,
    `<b>Print assinatura responsavel:</b> ${withdrawal.requester_signature ? 'Sim' : 'Nao'}`,
    `<b>Foto retirada:</b> ${withdrawal.photo_url ? 'Sim' : 'Nao'}`,
    sharedAttachmentLine,
    channelUrl ? `\n<a href="${channelUrl}">Canal da operacao</a>` : '',
  ].filter(Boolean).join('\n')
}

async function callTelegram(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || `Falha em ${method}.`)
  }

  return data
}

async function sendAsset(token, chatId, label, url, fileName) {
  if (!url) return

  if (isImageUrl(url)) {
    await callTelegram(token, 'sendPhoto', {
      chat_id: chatId,
      photo: url,
      caption: label,
    })
    return
  }

  await callTelegram(token, 'sendDocument', {
    chat_id: chatId,
    document: url,
    caption: fileName ? `${label}: ${fileName}` : label,
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { error: 'Method not allowed.' })
    return
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  const channelUrl = process.env.TELEGRAM_CHANNEL_URL || ''

  if (!token) {
    sendJson(res, 500, { error: 'TELEGRAM_BOT_TOKEN nao configurado no servidor.' })
    return
  }

  if (!chatId) {
    sendJson(res, 500, { error: 'TELEGRAM_CHAT_ID nao configurado. Link de convite nao basta; use @canal ou chat_id numerico.' })
    return
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    sendJson(res, 400, { error: 'JSON invalido.' })
    return
  }

  const withdrawals = Array.isArray(body?.withdrawals) ? body.withdrawals : []
  if (withdrawals.length === 0) {
    sendJson(res, 400, { error: 'Nenhuma retirada enviada.' })
    return
  }

  try {
    for (const withdrawal of withdrawals) {
      const sharedAttachment = resolveSharedSignatureAttachment(withdrawal)

      await callTelegram(token, 'sendMessage', {
        chat_id: chatId,
        text: buildMessage(withdrawal, channelUrl),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })

      await sendAsset(token, chatId, `📸 Foto da retirada ${withdrawal.code || ''}`.trim(), withdrawal.photo_url, null)
      await sendAsset(token, chatId, `✍️ Assinatura supervisor ${withdrawal.code || ''}`.trim(), withdrawal.supervisor_signature, null)
      await sendAsset(token, chatId, `🧾 Assinatura responsavel ${withdrawal.code || ''}`.trim(), withdrawal.requester_signature, null)
      await sendAsset(token, chatId, `👀 Assinatura testemunha ${withdrawal.code || ''}`.trim(), withdrawal.witness_signature, null)
      await sendAsset(token, chatId, '📎 Documento compartilhado das assinaturas', sharedAttachment.url, sharedAttachment.name)
    }

    sendJson(res, 200, { ok: true })
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Falha ao enviar notificacao Telegram.',
    })
  }
}
