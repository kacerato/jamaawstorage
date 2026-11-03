import { Fragment, type ReactNode } from 'react'
import { AlertTriangle, CircleAlert, Info } from 'lucide-react'
import { cn } from '../../lib/utils'
import { parseAssistantMessageBlocks } from './assistantMessageParser'

interface AssistantRichMessageProps {
  content: string
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-bold text-ink">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded-none bg-void px-1.5 py-0.5 font-mono text-[0.88em] text-ink">{part.slice(1, -1)}</code>
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}

function headingTone(value: string) {
  if (/🔴|abaixo|crítico|critico/i.test(value)) return 'border-crit bg-crit/[0.07] text-crit'
  if (/🟡|limite|atenção|atencao|próximo|proximo/i.test(value)) return 'border-warn bg-warn/[0.07] text-warn'
  if (/🟢|normal|confortável|confortavel/i.test(value)) return 'border-ok bg-ok/[0.07] text-ok'
  return 'border-line bg-blaze/[0.06] text-ink'
}

function HeadingIcon({ value }: { value: string }) {
  if (/🔴|abaixo|crítico|critico/i.test(value)) return <CircleAlert size={15} />
  if (/🟡|limite|atenção|atencao|próximo|proximo/i.test(value)) return <AlertTriangle size={15} />
  return <Info size={15} />
}

export function AssistantRichMessage({ content }: AssistantRichMessageProps) {
  const blocks = parseAssistantMessageBlocks(content)

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const value = String(block.content)
          return (
            <div key={index} className={cn('flex items-center gap-2 rounded-none border px-3 py-2.5 text-sm font-bold', headingTone(value))}>
              <HeadingIcon value={value} />
              <span>{inline(value.replace(/^[🔴🟡🟢]\s*/u, ''))}</span>
            </div>
          )
        }

        if (block.type === 'table') {
          return (
            <div key={index} className="overflow-hidden rounded-none border border-line bg-void">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[390px] border-collapse text-left text-xs">
                  <thead className="bg-surface text-[10px] font-bold uppercase tracking-[0.1em] text-ink-mute">
                    <tr>{block.headers.map((header, cellIndex) => <th key={cellIndex} className="border-b border-line px-3 py-2.5">{inline(header)}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="transition-colors hover:bg-surface">
                        {block.headers.map((_, cellIndex) => (
                          <td key={cellIndex} className={cn('px-3 py-2.5 text-ink-dim', cellIndex === 0 && 'font-medium text-ink-mute')}>
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
                <li key={itemIndex} className="flex items-start gap-2 text-sm leading-6 text-ink-dim">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blaze" />
                  <span>{inline(item)}</span>
                </li>
              ))}
            </ul>
          )
        }

        return <p key={index} className="text-sm leading-6 text-ink-dim">{inline(String(block.content))}</p>
      })}
    </div>
  )
}
