export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const serviceUrl = process.env.VEHICLE_CV_SERVICE_URL?.replace(/\/$/, '')
  const serviceToken = process.env.VEHICLE_CV_SERVICE_TOKEN
  if (!serviceUrl) {
    res.status(503).json({ error: 'VEHICLE_CV_SERVICE_URL nao configurada.' })
    return
  }

  const code = String(req.query?.code ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    res.status(400).json({ error: 'Codigo do veiculo invalido.' })
    return
  }

  try {
    const response = await fetch(`${serviceUrl}/v1/markers/${encodeURIComponent(code)}.png`, {
      headers: serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {},
    })
    if (!response.ok) {
      res.status(502).json({ error: 'Nao foi possivel gerar o marcador do veiculo.' })
      return
    }
    const marker = Buffer.from(await response.arrayBuffer())
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Disposition', `attachment; filename="${code}-marker.png"`)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.status(200).send(marker)
  } catch {
    res.status(502).json({ error: 'Servico de marcadores indisponivel.' })
  }
}
