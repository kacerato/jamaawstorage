export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function generateWithdrawalCodePreview(): string {
  const now = new Date()
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0')
  return `RET-${dateStr}-???`
}

export function isValidUUID(uuid: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

export function formatQuantity(quantity: number, unit: string): string {
  return `${quantity} ${unit}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

interface PrintTableColumn {
  key: string
  label: string
}

interface PrintTableDocumentOptions {
  title: string
  subtitle?: string
  filename?: string
  generatedAt?: string
  columns: PrintTableColumn[]
  rows: Record<string, unknown>[]
}

interface PrintTableSection {
  title: string
  subtitle?: string
  columns: PrintTableColumn[]
  rows: Record<string, unknown>[]
}

interface PrintSectionedTableDocumentOptions {
  title: string
  subtitle?: string
  filename?: string
  generatedAt?: string
  sections: PrintTableSection[]
}

export function openPrintTableDocument({
  title,
  subtitle,
  filename,
  generatedAt,
  columns,
  rows,
}: PrintTableDocumentOptions): void {
  const generatedLabel = generatedAt ?? new Date().toLocaleString('pt-BR')
  const tableHead = columns
    .map((column) => `<th>${escapeHtml(column.label)}</th>`)
    .join('')

  const tableRows = rows.length > 0
    ? rows
      .map((row) => {
        const cells = columns
          .map((column) => `<td>${escapeHtml(String(row[column.key] ?? '-'))}</td>`)
          .join('')
        return `<tr>${cells}</tr>`
      })
      .join('')
    : `<tr><td colspan="${columns.length}" class="empty">Nenhum dado disponivel</td></tr>`

  const safeTitle = escapeHtml(title)
  const safeSubtitle = subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''
  const safeFilename = escapeHtml(filename ?? title)

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #1f2937;
        --muted: #6b7280;
        --line: #e5e7eb;
        --soft: #f8fafc;
        --brand: #ea580c;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        color: var(--ink);
        background: white;
      }
      .page {
        padding: 32px;
      }
      .header {
        margin-bottom: 24px;
        border-bottom: 2px solid var(--line);
        padding-bottom: 18px;
      }
      .eyebrow {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--brand);
        margin: 0 0 8px;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.1;
      }
      .subtitle,
      .meta {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      th, td {
        border: 1px solid var(--line);
        padding: 10px 12px;
        text-align: left;
        vertical-align: top;
        font-size: 12px;
        word-break: break-word;
      }
      th {
        background: var(--soft);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .empty {
        text-align: center;
        color: var(--muted);
        padding: 28px 12px;
      }
      .footer {
        margin-top: 18px;
        color: var(--muted);
        font-size: 11px;
      }
      @media print {
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .page { padding: 20px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="header">
        <p class="eyebrow">Relatorio</p>
        <h1>${safeTitle}</h1>
        ${safeSubtitle}
        <p class="meta">Gerado em ${escapeHtml(generatedLabel)} | ${safeFilename}</p>
      </header>
      <table>
        <thead><tr>${tableHead}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <p class="footer">Documento preparado para impressao e exportacao em PDF.</p>
    </main>
  </body>
</html>`

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  document.body.appendChild(iframe)

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove()
    }, 1000)
  }

  const iframeWindow = iframe.contentWindow
  if (!iframeWindow) {
    iframe.remove()
    throw new Error('Nao foi possivel preparar a impressao.')
  }

  iframeWindow.document.open()
  iframeWindow.document.write(html)
  iframeWindow.document.close()

  const triggerPrint = () => {
    iframeWindow.focus()
    iframeWindow.print()
    cleanup()
  }

  if (iframe.contentDocument?.readyState === 'complete') {
    triggerPrint()
  } else {
    iframe.onload = () => {
      triggerPrint()
    }
  }
}

export function openPrintSectionedTableDocument({
  title,
  subtitle,
  filename,
  generatedAt,
  sections,
}: PrintSectionedTableDocumentOptions): void {
  const generatedLabel = generatedAt ?? new Date().toLocaleString('pt-BR')
  const safeTitle = escapeHtml(title)
  const safeSubtitle = subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''
  const safeFilename = escapeHtml(filename ?? title)
  const renderedSections = sections.length > 0
    ? sections
      .map((section) => {
        const header = section.columns
          .map((column) => `<th>${escapeHtml(column.label)}</th>`)
          .join('')
        const rows = section.rows.length > 0
          ? section.rows
            .map((row) => {
              const cells = section.columns
                .map((column) => `<td>${escapeHtml(String(row[column.key] ?? '-'))}</td>`)
                .join('')
              return `<tr>${cells}</tr>`
            })
            .join('')
          : `<tr><td colspan="${section.columns.length}" class="empty">Nenhum dado disponivel</td></tr>`

        return `
          <section class="section">
            <div class="section-header">
              <h2>${escapeHtml(section.title)}</h2>
              ${section.subtitle ? `<p class="section-subtitle">${escapeHtml(section.subtitle)}</p>` : ''}
            </div>
            <table>
              <thead><tr>${header}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </section>
        `
      })
      .join('')
    : '<p class="empty">Nenhum dado disponivel</p>'

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #1f2937;
        --muted: #6b7280;
        --line: #e5e7eb;
        --soft: #f8fafc;
        --brand: #ea580c;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        color: var(--ink);
        background: white;
      }
      .page {
        padding: 32px;
      }
      .header {
        margin-bottom: 24px;
        border-bottom: 2px solid var(--line);
        padding-bottom: 18px;
      }
      .eyebrow {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--brand);
        margin: 0 0 8px;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.1;
      }
      h2 {
        margin: 0;
        font-size: 18px;
      }
      .subtitle,
      .meta,
      .section-subtitle {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
      }
      .section {
        margin-top: 24px;
        page-break-inside: avoid;
      }
      .section-header {
        margin-bottom: 12px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      th, td {
        border: 1px solid var(--line);
        padding: 10px 12px;
        text-align: left;
        vertical-align: top;
        font-size: 12px;
        word-break: break-word;
      }
      th {
        background: var(--soft);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .empty {
        text-align: center;
        color: var(--muted);
        padding: 28px 12px;
      }
      .footer {
        margin-top: 18px;
        color: var(--muted);
        font-size: 11px;
      }
      @media print {
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .page { padding: 20px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="header">
        <p class="eyebrow">Relatorio</p>
        <h1>${safeTitle}</h1>
        ${safeSubtitle}
        <p class="meta">Gerado em ${escapeHtml(generatedLabel)} | ${safeFilename}</p>
      </header>
      ${renderedSections}
      <p class="footer">Documento preparado para impressao e exportacao em PDF.</p>
    </main>
  </body>
</html>`

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  document.body.appendChild(iframe)

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove()
    }, 1000)
  }

  const iframeWindow = iframe.contentWindow
  if (!iframeWindow) {
    iframe.remove()
    throw new Error('Nao foi possivel preparar a impressao.')
  }

  iframeWindow.document.open()
  iframeWindow.document.write(html)
  iframeWindow.document.close()

  const triggerPrint = () => {
    iframeWindow.focus()
    iframeWindow.print()
    cleanup()
  }

  if (iframe.contentDocument?.readyState === 'complete') {
    triggerPrint()
  } else {
    iframe.onload = () => {
      triggerPrint()
    }
  }
}

export const DEFAULT_IMAGE_UPLOAD_OPTIONS = {
  maxFileSizeMb: 12,
  maxDimension: 2200,
  quality: 0.86,
} as const

export async function optimizeImageFileToJpegBlob(
  file: File,
  options?: {
    maxFileSizeMb?: number
    maxDimension?: number
    quality?: number
  }
): Promise<Blob> {
  const maxFileSizeMb = options?.maxFileSizeMb ?? DEFAULT_IMAGE_UPLOAD_OPTIONS.maxFileSizeMb
  const maxDimension = options?.maxDimension ?? DEFAULT_IMAGE_UPLOAD_OPTIONS.maxDimension
  const quality = options?.quality ?? DEFAULT_IMAGE_UPLOAD_OPTIONS.quality

  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione uma imagem válida.')
  }

  if (file.size > maxFileSizeMb * 1024 * 1024) {
    throw new Error(`A imagem deve ter no máximo ${maxFileSizeMb} MB.`)
  }

  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)

    image.onload = () => {
      let width = image.width
      let height = image.height

      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('Não foi possível processar a imagem.'))
        return
      }

      ctx.drawImage(image, 0, 0, width, height)
      URL.revokeObjectURL(url)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('NÃ£o foi possÃ­vel gerar a imagem otimizada.'))
            return
          }

          resolve(blob)
        },
        'image/jpeg',
        quality,
      )
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não foi possível ler a imagem.'))
    }

    image.src = url
  })
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('NÃ£o foi possÃ­vel ler a imagem processada.'))
    }

    reader.onerror = () => {
      reject(new Error('NÃ£o foi possÃ­vel ler a imagem processada.'))
    }

    reader.readAsDataURL(blob)
  })
}

export async function imageFileToDataUrl(
  file: File,
  options?: {
    maxFileSizeMb?: number
    maxDimension?: number
    quality?: number
  }
): Promise<string> {
  const blob = await optimizeImageFileToJpegBlob(file, options)
  return blobToDataUrl(blob)
}
