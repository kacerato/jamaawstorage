import { useState, useMemo } from 'react'
import { cn } from '../../lib/utils'

interface Column<T> {
  key: keyof T | string
  header: string
  render?: (value: T[keyof T], row: T) => React.ReactNode
  className?: string
  sortable?: boolean
  /*
   * Papel da coluna quando a linha vira registro empilhado, abaixo de md:
   * 'lead'  - titulo do registro (primeira coluna, se nenhuma for marcada)
   * 'trail' - valor a direita do titulo, tipicamente a quantidade
   * 'meta'  - vai para a linha de apoio; o rotulo so aparece quando
   *           a coluna pede, via mobileLabel
   * 'hide'  - nao aparece no modo empilhado
   */
  mobile?: 'lead' | 'trail' | 'meta' | 'hide'
  /* Mostra o nome da coluna antes do valor no modo empilhado. */
  mobileLabel?: boolean
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (row: T) => string
  isLoading?: boolean
  emptyMessage?: string
  onRowClick?: (row: T) => void
  selectedId?: string | null
}

type SortDirection = 'asc' | 'desc' | null

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  emptyMessage = 'Nenhum dado encontrado',
  onRowClick,
  selectedId = null,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)

  const handleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDirection === 'asc') {
        setSortDirection('desc')
      } else if (sortDirection === 'desc') {
        setSortKey(null)
        setSortDirection(null)
      }
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  const sortedData = useMemo(() => {
    if (!sortKey || !sortDirection) return data

    return [...data].sort((a, b) => {
      const aVal = a[sortKey as keyof T]
      const bVal = b[sortKey as keyof T]

      if (aVal === bVal) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1

      const comparison = String(aVal).localeCompare(String(bVal), 'pt-BR', {
        numeric: true,
      })
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [data, sortKey, sortDirection])

  /* Sem marcacao explicita, a primeira coluna lidera e as demais viram apoio. */
  const mobileRoles = useMemo(() => {
    const hasLead = columns.some((col) => col.mobile === 'lead')
    return columns.map((col, idx) => {
      if (col.mobile) return col.mobile
      if (!hasLead && idx === 0) return 'lead' as const
      return 'meta' as const
    })
  }, [columns])

  const leadIndex = mobileRoles.indexOf('lead')
  const trailIndex = mobileRoles.indexOf('trail')

  const getCellValue = (row: T, key: keyof T | string): unknown => {
    return row[key as keyof T]
  }

  const renderCellValue = (row: T, column: Column<T>): React.ReactNode => {
    const value = getCellValue(row, column.key)
    if (column.render) {
      return column.render(value as T[keyof T], row)
    }
    return value != null ? String(value) : null
  }

  if (isLoading) {
    return (
      <div className="bg-surface">
        {Array.from({ length: 5 }).map((_, idx) => (
          <div
            key={idx}
            className="flex gap-3 border-b border-line px-3 py-3.5 last:border-b-0"
          >
            {columns.map((col, colIdx) => (
              <div
                key={`${String(col.key)}-${colIdx}`}
                className="h-4 flex-1 animate-pulse bg-line"
              />
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center bg-surface py-12">
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="mb-3 text-ink-mute"
        >
          <rect
            x="4"
            y="8"
            width="40"
            height="32"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <path d="M4 18H44" stroke="currentColor" strokeWidth="2.5" />
          <path
            d="M14 28H34"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
        <p className="text-sm text-ink-dim">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="bg-surface">
      {/* Tabela: md para cima */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              {columns.map((col, idx) => (
                <th
                  key={`${String(col.key)}-${idx}`}
                  className={cn(
                    'label-mono px-3 py-3 text-left font-normal',
                    col.sortable && 'cursor-pointer select-none hover:text-ink',
                    col.className,
                  )}
                  onClick={col.sortable ? () => handleSort(String(col.key)) : undefined}
                >
                  <div className="flex items-center gap-1.5">
                    {col.header}
                    {col.sortable && sortKey === String(col.key) && sortDirection && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className={cn(
                          'text-ink transition-transform',
                          sortDirection === 'desc' && 'rotate-180',
                        )}
                      >
                        <path d="M7 3L11 9H3L7 3Z" fill="currentColor" />
                      </svg>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.map((row) => {
              const rowKey = keyExtractor(row)
              const isSelected = selectedId === rowKey

              return (
                <tr
                  key={rowKey}
                  className={cn(
                    'border-b border-line transition-colors last:border-b-0',
                    onRowClick && 'cursor-pointer',
                    isSelected ? 'bg-void' : 'hover:bg-void/60',
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col, idx) => (
                    <td
                      key={`${String(col.key)}-${idx}`}
                      className={cn('px-3 py-3 text-sm text-ink-dim', col.className)}
                    >
                      {renderCellValue(row, col)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Registro empilhado: abaixo de md, sem rolagem lateral */}
      <div className="md:hidden">
        {sortedData.map((row) => {
          const rowKey = keyExtractor(row)
          const isSelected = selectedId === rowKey
          const metaColumns = columns.filter(
            (_, idx) => mobileRoles[idx] === 'meta',
          )

          return (
            <div
              key={rowKey}
              className={cn(
                'border-b border-line px-3 py-3 last:border-b-0',
                onRowClick && 'cursor-pointer',
                isSelected && 'bg-void',
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              <div className="flex items-baseline justify-between gap-3">
                {leadIndex >= 0 && (
                  <div className="min-w-0 flex-1 text-sm font-semibold text-ink">
                    {renderCellValue(row, columns[leadIndex])}
                  </div>
                )}
                {trailIndex >= 0 && (
                  <div className="num flex-shrink-0 text-sm text-ink">
                    {renderCellValue(row, columns[trailIndex])}
                  </div>
                )}
              </div>

              {metaColumns.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {metaColumns.map((col, idx) => (
                    <div
                      key={`${String(col.key)}-${idx}`}
                      className="flex min-w-0 items-center gap-1.5"
                    >
                      {col.mobileLabel && (
                        <span className="label-mono">{col.header}</span>
                      )}
                      <span className="min-w-0 truncate text-xs text-ink-dim">
                        {renderCellValue(row, col)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
