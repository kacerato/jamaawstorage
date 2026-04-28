import { useState, useMemo } from 'react'
import { cn } from '../../lib/utils'

interface Column<T> {
  key: keyof T | string
  header: string
  render?: (value: T[keyof T], row: T) => React.ReactNode
  className?: string
  sortable?: boolean
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
      <div className="overflow-hidden rounded-xl border border-gray-700">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-800">
              {columns.map((col, idx) => (
                <th
                  key={`${String(col.key)}-${idx}`}
                  className="px-4 py-3 text-left text-sm font-medium text-gray-300"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, idx) => (
              <tr key={idx} className="border-t border-gray-800">
                {columns.map((col, colIdx) => (
                  <td
                    key={`${String(col.key)}-${colIdx}`}
                    className="px-4 py-3"
                  >
                    <div className="h-4 animate-pulse rounded bg-gray-800" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-gray-700 bg-gray-900 py-12">
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="mb-3 text-gray-600"
        >
          <rect
            x="4"
            y="8"
            width="40"
            height="32"
            rx="4"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <path
            d="M4 18H44"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <path
            d="M14 28H34"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
        <p className="text-sm text-gray-400">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-700">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="sticky top-0 bg-gray-800">
              {columns.map((col, idx) => (
                <th
                  key={`${String(col.key)}-${idx}`}
                  className={cn(
                    'px-4 py-3 text-left text-sm font-medium text-gray-300',
                    col.sortable && 'cursor-pointer select-none hover:text-orange-400',
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
                          'transition-transform text-orange-500',
                          sortDirection === 'desc' && 'rotate-180',
                        )}
                      >
                        <path
                          d="M7 3L11 9H3L7 3Z"
                          fill="currentColor"
                        />
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
                    'border-t border-gray-800 transition-colors',
                    onRowClick && 'cursor-pointer',
                    isSelected
                      ? 'border-l-2 border-l-orange-500 bg-orange-500/10'
                      : 'hover:bg-gray-800/50',
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col, idx) => (
                    <td
                      key={`${String(col.key)}-${idx}`}
                      className={cn('px-4 py-3 text-sm text-gray-300', col.className)}
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
    </div>
  )
}
