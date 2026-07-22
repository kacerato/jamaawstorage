import { Fragment, type ReactNode } from 'react'
import { AlertTriangle, CircleAlert, Info } from 'lucide-react'
import { cn } from '../../lib/utils'

interface AssistantRichMessageProps {
  content: string
}

interface TableBlock {
  type: 'table'
  headers: string[]
  rows: string[][]
}

interface TextBlock {
  type: 'heading' | 'paragraph' | 'list'
  content: string | string[]
  level?: number
}

type MessageBlock = TableBlock | TextBlock

function cells(line: string) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
}

function isDivider(line: string) {
  const values = cells(line)
  return values.length > 0 && values.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function parseBlocks(content: string): MessageBlock[] {
  const lines = content.replace(/\r/g, '').split('\n')
  const blocks: MessageBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: heading[2] })
      index += 1
      continue
    }

    if (line.includes('|') && index + 1 < lines.length && isDivider(lines[index + 1])) {
      const headers = cells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(cells(lines[index]))
        index += 1
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'list', content: items })
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (
      index < lines.length
      && lines[index].trim()
      && !/^(#{1,3})\s+/.test(lines[index].trim())
      && !/^[-*]\s+/.test(lines[index].trim())
      && !(lines[index].includes('|') && index + 1 < lines.length && isDivider(lines[index + 1]))
    ) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', content: paragraph.join(' ') })
  }

  return blocks
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-bold text-white">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded bg-black/35 px-1.5 py-0.5 font-mono text-[0.88em] text-orange-200">{part.slice(1, -1)}</code>
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}

function headingTone(value: string) {
  if (/🔴|abaixo|crítico|critico/i.test(value)) return 'border-red-400/20 bg-red-500/[0.07] text-red-200'
  if (/🟡|limite|atenção|atencao|próximo|proximo/i.test(value)) return 'border-amber-400/20 bg-amber-500/[0.07] text-amber-200'
  if (/🟢|normal|confortável|confortavel/i.test(value)) return 'border-emerald-400/20 bg-emerald-500/[0.07] text-emerald-200'
  return 'border-orange-400/15 bg-orange-500/[0.06] text-orange-100'
}

function HeadingIcon({ value }: { value: string }) {
  if (/🔴|abaixo|crítico|critico/i.test(value)) return <CircleAlert size={15} />
  if (/🟡|limite|atenção|atencao|próximo|proximo/i.test(value)) return <AlertTriangle size={15} />
  return <Info size={15} />
}

export function AssistantRichMessage({ content }: AssistantRichMessageProps) {
  const blocks = parseBlocks(content)

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const value = String(block.content)
          return (
            <div key={index} className={cn('flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold', headingTone(value))}>
              <HeadingIcon value={value} />
              <span>{inline(value.replace(/^[🔴🟡🟢]\s*/u, ''))}</span>
            </div>
          )
        }

        if (block.type === 'table') {
          return (
            <div key={index} className="overflow-hidden rounded-xl border border-white/[0.075] bg-black/20">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[390px] border-collapse text-left text-xs">
                  <thead className="bg-white/[0.055] text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">
                    <tr>{block.headers.map((header, cellIndex) => <th key={cellIndex} className="border-b border-white/[0.06] px-3 py-2.5">{inline(header)}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.055]">
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="transition-colors hover:bg-white/[0.035]">
                        {block.headers.map((_, cellIndex) => (
                          <td key={cellIndex} className={cn('px-3 py-2.5 text-gray-300', cellIndex === 0 && 'font-medium text-gray-100')}>
                            {inline(row[cellIndex] || '—')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        }

        if (block.type === 'list') {
          return (
            <ul key={index} className="space-y-2">
              {(block.content as string[]).map((item, itemIndex) => (
                <li key={itemIndex} className="flex items-start gap-2 text-sm leading-6 text-gray-300">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" />
                  <span>{inline(item)}</span>
                </li>
              ))}
            </ul>
          )
        }

        return <p key={index} className="text-sm leading-6 text-gray-300">{inline(String(block.content))}</p>
      })}
    </div>
  )
}
