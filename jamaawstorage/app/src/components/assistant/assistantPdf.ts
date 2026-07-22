import { openPrintSectionedTableDocument } from '../../lib/utils'
import { parseAssistantMessageBlocks } from './assistantMessageParser'

export interface AssistantPdfSection {
  title: string
  subtitle?: string
  columns: string[]
  rows: string[][]
}

export interface AssistantPdfReport {
  title: string
  subtitle?: string
  filename: string
  sections: AssistantPdfSection[]
}

export function isAssistantPdfReport(value: unknown): value is AssistantPdfReport {
  if (!value || typeof value !== 'object') return false
  const report = value as Partial<AssistantPdfReport>
  return typeof report.title === 'string'
    && typeof report.filename === 'string'
    && Array.isArray(report.sections)
    && report.sections.every((section) =>
      section
      && typeof section.title === 'string'
      && Array.isArray(section.columns)
      && Array.isArray(section.rows),
    )
}

export async function downloadAssistantPdf(report: AssistantPdfReport): Promise<void> {
  await openPrintSectionedTableDocument({
    title: report.title,
    subtitle: report.subtitle,
    filename: report.filename,
    sections: report.sections.map((section) => ({
      title: section.title,
      subtitle: section.subtitle,
      columns: section.columns.map((label, index) => ({ key: `column_${index}`, label })),
      rows: section.rows.map((row) => Object.fromEntries(
        section.columns.map((_, index) => [`column_${index}`, row[index] ?? '-']),
      )),
    })),
  })
}

export function createAssistantMessagePdfReport(content: string): AssistantPdfReport {
  const blocks = parseAssistantMessageBlocks(content)
  const sections: AssistantPdfSection[] = []
  let currentTitle = 'Resumo da análise'
  let narrative: string[] = []

  const flushNarrative = () => {
    if (!narrative.length) return
    sections.push({
      title: currentTitle,
      columns: ['Informações'],
      rows: narrative.map((line) => [line]),
    })
    narrative = []
  }

  blocks.forEach((block) => {
    if (block.type === 'heading') {
      flushNarrative()
      currentTitle = String(block.content).replace(/^[🔴🟡🟢]\s*/u, '')
      return
    }
    if (block.type === 'table') {
      sections.push({
        title: currentTitle,
        subtitle: narrative.join(' '),
        columns: block.headers,
        rows: block.rows,
      })
      narrative = []
      currentTitle = 'Observações'
      return
    }
    if (block.type === 'list') narrative.push(...(block.content as string[]))
    else narrative.push(String(block.content))
  })
  flushNarrative()

  const generatedDate = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')
  return {
    title: 'Análise do JAMAAW Assistente',
    subtitle: 'Documento gerado a partir da consulta operacional apresentada no assistente.',
    filename: `analise-jamaaw-${generatedDate}.pdf`,
    sections: sections.length > 0 ? sections : [{ title: 'Análise', columns: ['Informações'], rows: [[content]] }],
  }
}
