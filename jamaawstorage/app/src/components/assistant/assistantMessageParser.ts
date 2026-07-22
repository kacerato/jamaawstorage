export interface TableBlock {
  type: 'table'
  headers: string[]
  rows: string[][]
}

export interface TextBlock {
  type: 'heading' | 'paragraph' | 'list'
  content: string | string[]
  level?: number
}

export type MessageBlock = TableBlock | TextBlock

function cells(line: string) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
}

function isDivider(line: string) {
  const values = cells(line)
  return values.length > 0 && values.every((cell) => /^:?-{3,}:?$/.test(cell))
}

export function parseAssistantMessageBlocks(content: string): MessageBlock[] {
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
