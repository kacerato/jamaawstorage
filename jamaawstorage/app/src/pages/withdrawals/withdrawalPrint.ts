import logoJamaaw from '../../assets/logojamaaw.png'
import type { WithdrawalWithDetails } from '../../types'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatCpf(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (digits.length !== 11) return value?.trim() || ''
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

function formatTermDate(value: string | null | undefined): string {
  const baseDate = value ? new Date(value) : new Date()
  const day = `${baseDate.getDate()}`.padStart(2, '0')
  const month = `${baseDate.getMonth() + 1}`.padStart(2, '0')
  const year = `${baseDate.getFullYear()}`
  return `${day} / ${month} / ${year}`
}

function buildResponsiblePerson(withdrawal: WithdrawalWithDetails) {
  if (withdrawal.destination_type === 'collaborator' && withdrawal.collaborator) {
    return withdrawal.collaborator
  }

  return withdrawal.requested_by_person
}

export function openPrintWithdrawalTerm(withdrawal: WithdrawalWithDetails): void {
  const responsiblePerson = buildResponsiblePerson(withdrawal)
  const itemsRows = withdrawal.withdrawal_items.length > 0
    ? withdrawal.withdrawal_items
      .map((item) => `
        <tr>
          <td class="qty-cell">${escapeHtml(String(item.quantity))}</td>
          <td>${escapeHtml(item.stock_items?.name ?? 'Item')}</td>
        </tr>
      `)
      .join('')
    : `
      <tr>
        <td class="qty-cell">-</td>
        <td>Nenhum item informado</td>
      </tr>
    `

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Termo de Retirada</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #1b2542;
        --line: #1f1f1f;
        --muted: #4b5563;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Arial, Helvetica, sans-serif;
        color: var(--ink);
        background: #ffffff;
      }
      .page {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        padding: 14mm 16mm 16mm;
      }
      .brand {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        margin-bottom: 14px;
      }
      .brand img {
        width: 112px;
        height: auto;
      }
      .title {
        margin: 10px 0 6px;
        text-align: center;
        font-size: 19px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      .subtitle {
        margin: 0 0 16px;
        text-align: center;
        font-size: 15px;
        font-weight: 700;
      }
      .body-text {
        margin: 0 0 10px;
        text-align: justify;
        font-size: 12px;
        line-height: 1.45;
      }
      .important {
        margin: 0 0 16px;
        text-align: center;
        font-size: 12px;
        font-weight: 700;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 16px;
      }
      td, th {
        border: 1px solid var(--line);
        padding: 8px 10px;
        font-size: 12px;
        color: #111827;
      }
      th {
        text-align: left;
        font-weight: 700;
      }
      .section-title {
        margin: 18px 0 8px;
        font-size: 12px;
        font-weight: 700;
      }
      .qty-cell {
        width: 86px;
        text-align: center;
      }
      .signature-label {
        font-weight: 700;
      }
      .signature-line {
        display: block;
        margin-bottom: 6px;
        letter-spacing: 0.02em;
      }
      .date {
        margin-top: 14px;
        text-align: right;
        font-size: 12px;
      }
      @page {
        size: A4 portrait;
        margin: 8mm;
      }
      @media print {
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="brand">
        <img src="${logoJamaaw}" alt="Logo Jamaaw" />
      </div>
      <h1 class="title">TERMO DE RETIRADA DO ALMOXARIFADO</h1>
      <p class="subtitle">JAMAAW SOLUÇÕES INTELIGENTES</p>

      <p class="body-text">
        Declaro, para os devidos fins, que os itens abaixo relacionados foram retirados do almoxarifado JAMAAW.
        O colaborador declara estar ciente do recebimento dos materiais, responsabilizando-se pelo uso adequado,
        guarda, conservação e zelo de todos os itens retirados, comprometendo-se a devolvê-los em boas condições,
        salvo desgaste natural de uso.
      </p>
      <p class="important">
        IMPORTANTE: O colaborador é responsável por zelar pelos materiais retirados e utilizá-los de forma adequada e segura.
      </p>

      <table>
        <tbody>
          <tr>
            <td class="signature-label">Colaborador responsável pela retirada</td>
            <td>${escapeHtml(responsiblePerson?.full_name ?? 'Nao informado')}</td>
          </tr>
          <tr>
            <td class="signature-label">CPF</td>
            <td>${escapeHtml(formatCpf(responsiblePerson?.cpf) || '-')}</td>
          </tr>
        </tbody>
      </table>

      <p class="section-title">ITENS RETIRADOS</p>
      <table>
        <thead>
          <tr>
            <th class="qty-cell">Quantidade</th>
            <th>Descrição</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <p class="section-title">ASSINATURAS</p>
      <table>
        <tbody>
          <tr>
            <td class="signature-label">Supervisor (Autorização)</td>
            <td class="signature-label">Colaborador (Retirada)</td>
          </tr>
          <tr>
            <td>
              <span class="signature-line">________________________________</span>
              Assinatura do supervisor
            </td>
            <td>
              <span class="signature-line">________________________________</span>
              Assinatura do colaborador
            </td>
          </tr>
        </tbody>
      </table>

      <p class="date">Data: ${escapeHtml(formatTermDate(withdrawal.withdrawn_at ?? withdrawal.updated_at ?? withdrawal.created_at))}</p>
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
    throw new Error('Nao foi possivel preparar o termo para impressao.')
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
