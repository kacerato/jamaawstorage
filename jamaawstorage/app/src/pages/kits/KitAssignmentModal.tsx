import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { KitWithItems } from '../../types'
import { formatQuantity } from '../../lib/utils'
import { Alert, Badge, Button, Modal, Select, Spinner } from '../../components/ui'

interface PreviewRow {
  person_id: string
  person_name: string
  employee_id: string | null
  stock_item_id: string
  stock_item_name: string
  stock_item_code: string | null
  unit: string
  kit_quantity: number
  owned_quantity: number
  missing_quantity: number
  available_in_stock: number
}

interface AssignmentResultRow {
  person_id: string
  person_name: string
  assigned_quantity: number
  skipped_reason: string | null
}

interface PersonPreview {
  personId: string
  personName: string
  employeeId: string | null
  rows: PreviewRow[]
  totalMissing: number
  hasShortage: boolean
}

const JOB_TITLE_OPTIONS = [
  { value: 'cabista', label: 'Cabista' },
  { value: 'ajudante de cabista', label: 'Ajudante de cabista' },
]

interface KitAssignmentModalProps {
  kit: KitWithItems
  isOpen: boolean
  onClose: () => void
}

/**
 * Entrega de kit por função. Completa apenas a diferença entre o kit e o que
 * cada colaborador já tem — quem já está completo não recebe nada.
 */
export function KitAssignmentModal({ kit, isOpen, onClose }: KitAssignmentModalProps) {
  const [jobTitle, setJobTitle] = useState('cabista')
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AssignmentResultRow[] | null>(null)

  const loadPreview = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    const { data, error: rpcError } = await supabase.rpc('preview_kit_assignment_by_job_title', {
      p_kit_id: kit.id,
      p_job_title: jobTitle,
    })

    if (rpcError) {
      setError(rpcError.message)
      setPreview([])
    } else {
      setPreview((data ?? []) as PreviewRow[])
    }

    setLoading(false)
  }, [kit.id, jobTitle])

  useEffect(() => {
    if (isOpen) void loadPreview()
  }, [isOpen, loadPreview])

  const people = useMemo(() => {
    const grouped = new Map<string, PersonPreview>()

    preview.forEach((row) => {
      const existing = grouped.get(row.person_id) ?? {
        personId: row.person_id,
        personName: row.person_name,
        employeeId: row.employee_id,
        rows: [],
        totalMissing: 0,
        hasShortage: false,
      }

      existing.rows.push(row)
      existing.totalMissing += row.missing_quantity
      if (row.missing_quantity > row.available_in_stock) existing.hasShortage = true

      grouped.set(row.person_id, existing)
    })

    return [...grouped.values()]
  }, [preview])

  const peopleToReceive = useMemo(() => people.filter((person) => person.totalMissing > 0), [people])
  const peopleComplete = useMemo(() => people.filter((person) => person.totalMissing === 0), [people])
  const shortageCount = useMemo(() => peopleToReceive.filter((person) => person.hasShortage).length, [peopleToReceive])

  const handleApply = async () => {
    setApplying(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('assign_kit_to_job_title', {
      p_kit_id: kit.id,
      p_job_title: jobTitle,
    })

    if (rpcError) {
      setError(rpcError.message)
      setApplying(false)
      return
    }

    setResult((data ?? []) as AssignmentResultRow[])
    setApplying(false)
    await loadPreview()
  }

  const jobTitleLabel = JOB_TITLE_OPTIONS.find((option) => option.value === jobTitle)?.label ?? jobTitle

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Entregar "${kit.name}" por função`} size="lg">
      <div className="flex flex-col gap-4">
        <Select
          label="Função"
          value={jobTitle}
          onChange={(event) => setJobTitle(event.target.value)}
          options={JOB_TITLE_OPTIONS}
        />

        {error && <Alert variant="danger">{error}</Alert>}

        {result ? (
          <div className="flex flex-col gap-2">
            <Alert variant="success">Entrega concluída.</Alert>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-700">
              {result.map((row) => (
                <div
                  key={row.person_id}
                  className="flex items-center justify-between gap-3 border-b border-gray-800 px-3 py-2 last:border-b-0"
                >
                  <span className="text-sm text-white">{row.person_name}</span>
                  {row.skipped_reason ? (
                    <span className="text-xs text-gray-400">{row.skipped_reason}</span>
                  ) : (
                    <Badge variant="success" size="sm">
                      +{row.assigned_quantity} un
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : loading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <Spinner />
          </div>
        ) : people.length === 0 ? (
          <Alert variant="info">Nenhum colaborador ativo com a função {jobTitleLabel}.</Alert>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="primary">{peopleToReceive.length} vão receber</Badge>
              {peopleComplete.length > 0 && (
                <Badge variant="default">{peopleComplete.length} já completos</Badge>
              )}
              {shortageCount > 0 && (
                <Badge variant="warning">{shortageCount} com estoque insuficiente</Badge>
              )}
            </div>

            {shortageCount > 0 && (
              <Alert variant="warning">
                Colaboradores sem estoque suficiente serão pulados. Os demais recebem normalmente.
              </Alert>
            )}

            <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-700">
              {peopleToReceive.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-gray-400">
                  Todos os colaboradores desta função já possuem o kit completo.
                </p>
              ) : (
                peopleToReceive.map((person) => (
                  <div key={person.personId} className="border-b border-gray-800 px-3 py-2 last:border-b-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white">
                        {person.personName}
                        {person.employeeId && (
                          <span className="ml-2 font-mono text-xs text-gray-500">{person.employeeId}</span>
                        )}
                      </span>
                      <Badge variant={person.hasShortage ? 'warning' : 'primary'} size="sm">
                        {person.totalMissing} un
                      </Badge>
                    </div>

                    <div className="mt-1 flex flex-col gap-0.5">
                      {person.rows
                        .filter((row) => row.missing_quantity > 0)
                        .map((row) => (
                          <div key={row.stock_item_id} className="flex justify-between text-xs">
                            <span className="text-gray-400">{row.stock_item_name}</span>
                            <span
                              className={
                                row.missing_quantity > row.available_in_stock ? 'text-amber-300' : 'text-gray-300'
                              }
                            >
                              tem {row.owned_quantity} de {row.kit_quantity} · entregar{' '}
                              {formatQuantity(row.missing_quantity, row.unit)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={applying}>
            {result ? 'Fechar' : 'Cancelar'}
          </Button>
          {!result && (
            <Button onClick={handleApply} disabled={applying || loading || peopleToReceive.length === 0}>
              {applying ? 'Entregando...' : `Entregar para ${peopleToReceive.length}`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
