import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { WithdrawalWithDetails, WithdrawalStatus } from '../../types'
import { buildPublicStorageUrl } from '../../lib/storage'
import {
  buildSavedWithdrawalTermDocuments,
  downloadIndividualWithdrawalTermPdfs,
  downloadWithdrawalTermPdf,
  printWithdrawalTermPdf,
} from './withdrawalTermPdf'
import {
  Button,
  Card,
  Badge,
  Modal,
  Alert,
  Spinner,
  EmptyState,
  InfoTip,
  Input,
} from '../../components/ui'
import {
  ClipboardIcon,
  SignatureIcon,
  CameraIcon,
} from '../../components/icons'
import { formatDateTime } from '../../lib/utils'
import {
  activeRequirementDocument,
  openWithdrawalPdf,
  registerWithdrawalPdf,
  requirementStatusLabels,
  type WithdrawalDocumentRequirement,
} from './withdrawalDocuments'

type WithdrawalRow = WithdrawalWithDetails
type WithdrawalItem = WithdrawalRow['withdrawal_items'][number]
type ReturnTotals = { registered: number; returnedToStock: number }

const statusBadgeVariant: Record<WithdrawalStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  completed: 'success',
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
}

const statusLabels: Record<WithdrawalStatus, string> = {
  completed: 'Concluida',
  approved: 'Aprovada',
  pending: 'Pendente',
  rejected: 'Rejeitada',
}

export function WithdrawalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const shouldAutoPrint = searchParams.get('printTerm') === '1'
  const wasUpdated = searchParams.get('updated') === '1'
  const wasReopened = searchParams.get('reopened') === '1'
  const documentsWarning = searchParams.get('documentsWarning')
  const autoPrintHandledRef = useRef(false)

  const [withdrawal, setWithdrawal] = useState<WithdrawalRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updateLogCount, setUpdateLogCount] = useState(0)
  const [documentRequirements, setDocumentRequirements] = useState<WithdrawalDocumentRequirement[]>([])
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [uploadingRequirementId, setUploadingRequirementId] = useState<string | null>(null)

  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [showReopenModal, setShowReopenModal] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [reopenError, setReopenError] = useState<string | null>(null)
  const [returnTotals, setReturnTotals] = useState<Record<string, ReturnTotals>>({})
  const [returningItem, setReturningItem] = useState<WithdrawalItem | null>(null)
  const [returnQuantity, setReturnQuantity] = useState('1')
  const [returnCondition, setReturnCondition] = useState<'used' | 'damaged'>('used')
  const [returning, setReturning] = useState(false)
  const [returnError, setReturnError] = useState<string | null>(null)

  const fetchReturnTotals = useCallback(async (items: WithdrawalItem[]) => {
    if (items.length === 0) {
      setReturnTotals({})
      return
    }

    const { data, error: returnsError } = await supabase
      .from('stock_return_requests')
      .select('origin_withdrawal_item_id, quantity, approved_quantity')
      .in('origin_withdrawal_item_id', items.map((item) => item.id))

    if (returnsError) {
      setReturnError(returnsError.message)
      return
    }

    const nextTotals = (data ?? []).reduce<Record<string, ReturnTotals>>((totals, entry) => {
      if (entry.origin_withdrawal_item_id) {
        const previous = totals[entry.origin_withdrawal_item_id] ?? { registered: 0, returnedToStock: 0 }
        totals[entry.origin_withdrawal_item_id] = {
          registered: previous.registered + entry.quantity,
          returnedToStock: previous.returnedToStock + entry.approved_quantity,
        }
      }
      return totals
    }, {})

    setReturnTotals(nextTotals)
  }, [])

  const fetchDocumentRequirements = useCallback(async () => {
    if (!id) return
    const { data, error: requirementsError } = await supabase
      .from('withdrawal_document_requirements')
      .select('*, documents:withdrawal_person_documents(*)')
      .eq('withdrawal_id', id)
      .neq('status', 'not_required')
      .order('created_at')

    if (requirementsError) {
      setDocumentError(requirementsError.message)
      return
    }

    setDocumentRequirements((data ?? []) as WithdrawalDocumentRequirement[])
    setDocumentError(null)
  }, [id])

  useEffect(() => {
    if (!id) return
    let cancelled = false

    supabase
      .from('withdrawals')
      .select(
        '*, withdrawal_items(*, stock_items(*), collaborator:people!withdrawal_items_collaborator_id_fkey(id, full_name, employee_id, cpf), work_site:work_sites!withdrawal_items_work_site_id_fkey(id, name)), requested_by_person:people!withdrawals_requested_by_fkey(*), collaborator:people!withdrawals_collaborator_id_fkey(*), work_site:work_sites!withdrawals_work_site_id_fkey(*), approved_by_profile:profiles!withdrawals_authorized_by_fkey(*)',
      )
      .eq('id', id)
      .single<WithdrawalRow>()
      .then(({ data, error: fetchError }) => {
        if (cancelled) return
        setError(null)
        if (fetchError || !data) {
          setError(fetchError?.message ?? 'Retirada nao encontrada')
        } else {
          setWithdrawal(data)
          void fetchReturnTotals(data.withdrawal_items)
        }
        setLoading(false)
      })

    void fetchDocumentRequirements()

    supabase
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('table_name', 'withdrawals')
      .eq('record_id', id)
      .eq('action', 'UPDATE')
      .then(({ count }) => {
        if (!cancelled) {
          setUpdateLogCount(count ?? 0)
        }
      })

    return () => { cancelled = true }
  }, [fetchDocumentRequirements, fetchReturnTotals, id])

  const handleDocumentUpload = async (requirement: WithdrawalDocumentRequirement, file?: File) => {
    if (!file) return
    setUploadingRequirementId(requirement.id)
    setDocumentError(null)
    try {
      await registerWithdrawalPdf({ requirement, file })
      await fetchDocumentRequirements()
    } catch (uploadError) {
      setDocumentError(uploadError instanceof Error ? uploadError.message : 'Nao foi possivel anexar o PDF.')
    } finally {
      setUploadingRequirementId(null)
    }
  }

  useEffect(() => {
    if (!withdrawal || !shouldAutoPrint || autoPrintHandledRef.current) return
    autoPrintHandledRef.current = true
    void printWithdrawalTermPdf(buildSavedWithdrawalTermDocuments(withdrawal), {
      fileName: `${withdrawal.code}-termo-retirada.pdf`,
    })
  }, [shouldAutoPrint, withdrawal])

  const handleCancel = async () => {
    if (!withdrawal) return
    setCancelling(true)
    setCancelError(null)

    const { error: updateError } = await supabase
      .from('withdrawals')
      .update({ status: 'rejected' as const })
      .eq('id', withdrawal.id)

    if (updateError) {
      setCancelError(updateError.message)
      setCancelling(false)
      return
    }

    setWithdrawal((prev) =>
      prev ? { ...prev, status: 'rejected' as WithdrawalStatus } : prev,
    )
    setCancelling(false)
    setShowCancelModal(false)
  }

  const handleReopen = async () => {
    if (!withdrawal) return
    setReopening(true)
    setReopenError(null)

    const { error: reopenRequestError } = await supabase.rpc('reopen_rejected_withdrawal', {
      p_withdrawal_id: withdrawal.id,
    })

    if (reopenRequestError) {
      setReopenError(reopenRequestError.message)
      setReopening(false)
      return
    }

    setWithdrawal((prev) =>
      prev ? { ...prev, status: 'completed' as WithdrawalStatus } : prev,
    )
    setReopening(false)
    setShowReopenModal(false)
    navigate(`/withdrawals/${withdrawal.id}?reopened=1`, { replace: true })
  }

  const openReturnModal = (item: WithdrawalItem) => {
    const available = Math.max(item.quantity - (returnTotals[item.id]?.registered ?? 0), 0)
    setReturningItem(item)
    setReturnQuantity(String(Math.max(available, 1)))
    setReturnCondition('used')
    setReturnError(null)
  }

  const closeReturnModal = () => {
    if (returning) return
    setReturningItem(null)
    setReturnError(null)
  }

  const handleReturn = async () => {
    if (!withdrawal || !returningItem) return

    const quantity = Number.parseInt(returnQuantity, 10)
    const registeredQuantity = returnTotals[returningItem.id]?.registered ?? 0
    const available = Math.max(returningItem.quantity - registeredQuantity, 0)

    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > available) {
      setReturnError(`Informe uma quantidade entre 1 e ${available}.`)
      return
    }

    setReturning(true)
    setReturnError(null)
    try {
      const { error: returnError } = await supabase.rpc('register_linked_stock_return', {
        p_withdrawal_item_id: returningItem.id,
        p_quantity: quantity,
        p_item_condition: returnCondition,
      })

      if (returnError) {
        throw new Error(returnError.message)
      }

      await fetchReturnTotals(withdrawal.withdrawal_items)
      setReturningItem(null)
      setReturnError(null)
    } catch (submitError) {
      setReturnError(submitError instanceof Error ? submitError.message : 'Nao foi possivel registrar a devolucao.')
    } finally {
      setReturning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error || !withdrawal) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" onClick={() => navigate('/withdrawals')}>
          Voltar para Retiradas
        </Button>
        <EmptyState
          icon={<ClipboardIcon size={48} />}
          title="Retirada nao encontrada"
          description={error ?? 'A retirada solicitada nao foi encontrada.'}
        />
      </div>
    )
  }

  const canCancel = withdrawal.status === 'completed' || withdrawal.status === 'approved' || withdrawal.status === 'pending'
  const canEdit = withdrawal.status === 'completed' || withdrawal.status === 'approved'
  const canReopen = withdrawal.status === 'rejected'
  const hasSupervisorSignature = !!withdrawal.supervisor_signature
  const hasRequesterSignature = !!withdrawal.requester_signature
  const bothSignaturesPresent = hasSupervisorSignature && hasRequesterSignature
  const sharedSignatureAttachment = resolveSharedSignatureAttachment(withdrawal)
  const photoUrls = getWithdrawalPhotoUrls(withdrawal)
  const attachedDocumentCount = documentRequirements.filter((requirement) => requirement.status === 'attached').length

  const destinationLabel = withdrawalDestinationsSummary(withdrawal)
  const canReturn = withdrawal.status !== 'rejected'
  const pendingTriageTotal = Object.values(returnTotals).reduce(
    (total, value) => total + value.registered - value.returnedToStock,
    0,
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate('/withdrawals')}>
            Voltar
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-white">{withdrawal.code}</h2>
              <Badge variant={statusBadgeVariant[withdrawal.status]} dot>
                {statusLabels[withdrawal.status]}
              </Badge>
              <InfoTip text="Use os PDFs para gerar termos. Editar retirada ajusta itens e destinos mantendo registro de auditoria." />
            </div>
            <p className="mt-1 text-sm text-gray-400">
              {formatDateTime(withdrawal.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => void downloadWithdrawalTermPdf(buildSavedWithdrawalTermDocuments(withdrawal), {
              fileName: `${withdrawal.code}-termo-retirada.pdf`,
            })}
          >
            PDF Geral
          </Button>
          <Button
            variant="outline"
            onClick={() => void downloadIndividualWithdrawalTermPdfs(buildSavedWithdrawalTermDocuments(withdrawal))}
          >
            PDFs Individuais
          </Button>
          {canEdit && (
            <Button
              variant="outline"
              onClick={() => navigate(`/withdrawals/${withdrawal.id}/edit`)}
            >
              Editar Retirada
            </Button>
          )}
          {canReopen && (
            <Button
              variant="primary"
              onClick={() => setShowReopenModal(true)}
            >
              Reabrir Retirada
            </Button>
          )}
          {canCancel && (
            <Button
              variant="danger"
              onClick={() => setShowCancelModal(true)}
            >
              Cancelar Retirada
            </Button>
          )}
        </div>
      </div>

      {wasUpdated && (
        <Alert variant="success" title="Retirada atualizada">
          As alteracoes foram salvas e registradas na auditoria.
        </Alert>
      )}

      {wasReopened && (
        <Alert variant="success" title="Retirada reaberta">
          A retirada voltou para concluida e o estoque foi baixado novamente.
        </Alert>
      )}

      {documentsWarning && (
        <Alert variant="warning" title="Retirada criada; existem documentos pendentes">
          {documentsWarning}
        </Alert>
      )}

      {pendingTriageTotal > 0 && (
        <Alert variant="warning" title="Existem devoluções antigas ainda em triagem">
          {pendingTriageTotal} unidade(s) ja foram registradas como devolvidas, mas ainda nao entraram no estoque. Regularize-as em Pendências de devolução antes de realizar outra movimentação desse item.
          <Button className="ml-3" size="sm" variant="outline" onClick={() => navigate('/stock?tab=returns')}>
            Abrir pendências
          </Button>
        </Alert>
      )}

      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">Detalhes</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-gray-400">Autorizado por</p>
            <p className="text-sm text-white">
              {withdrawal.approved_by_profile?.full_name ?? 'Nao informado'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Solicitado por</p>
            <p className="text-sm text-white">
              {withdrawal.requested_by_person?.full_name ?? 'Nao informado'}
              {withdrawal.requested_by_person?.employee_id
                ? ` (${withdrawal.requested_by_person.employee_id})`
                : ''}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Destinos dos itens</p>
            <p className="text-sm text-white">{destinationLabel}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Observacoes</p>
            <p className="text-sm text-white">{withdrawal.notes ?? 'Nenhuma'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Alteracoes em log</p>
            <p className="text-sm text-white">
              {updateLogCount > 0 ? `${updateLogCount} atualizacao(oes) registrada(s)` : 'Nenhuma alteracao apos a criacao'}
            </p>
          </div>
        </div>
      </Card>

      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">
          Itens ({withdrawal.withdrawal_items?.length ?? 0})
        </h3>
        {(!withdrawal.withdrawal_items || withdrawal.withdrawal_items.length === 0) ? (
          <p className="text-sm text-gray-400">Nenhum item registrado</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Item</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Categoria</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Destino</th>
                  <th className="px-3 py-2 text-center text-sm font-medium text-gray-300">Qtd</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Unidade</th>
                  <th className="px-3 py-2 text-right text-sm font-medium text-gray-300">Devolucao</th>
                </tr>
              </thead>
              <tbody>
                {withdrawal.withdrawal_items.map((wi) => {
                  const totals = returnTotals[wi.id] ?? { registered: 0, returnedToStock: 0 }
                  const pendingTriage = totals.registered - totals.returnedToStock
                  const availableToReturn = Math.max(wi.quantity - totals.registered, 0)
                  return (
                  <tr key={wi.id} className="border-b border-gray-800">
                    <td className="px-3 py-2 text-sm text-white">
                      {wi.stock_items?.name ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-400">
                      {wi.stock_items?.category ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-300">
                      {withdrawalItemDestinationLabel(wi, withdrawal)}
                    </td>
                    <td className="px-3 py-2 text-center text-sm text-gray-300">
                      {wi.quantity}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-300">
                      {wi.unit}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {totals.returnedToStock > 0 && (
                        <p className="mb-1 text-xs text-emerald-300">
                          No estoque: {totals.returnedToStock}
                        </p>
                      )}
                      {pendingTriage > 0 && (
                        <p className="mb-1 text-xs text-amber-300">
                          Em triagem: {pendingTriage}
                        </p>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canReturn || availableToReturn === 0}
                        onClick={() => openReturnModal(wi)}
                      >
                        {availableToReturn === 0 ? 'Devolucao registrada' : 'Devolver item'}
                      </Button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {withdrawal.withdrawal_items && withdrawal.withdrawal_items.length > 0 && (
          <div className="mt-3 border-t border-gray-700 pt-3 text-sm text-gray-400">
            Total: {withdrawal.withdrawal_items.reduce((sum, wi) => sum + wi.quantity, 0)} unidades
          </div>
        )}
      </Card>

      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">
          <CameraIcon size={18} className="mr-2 inline-block" />
          Registro Fotografico
        </h3>
        {photoUrls.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photoUrls.map((photoUrl, index) => (
              <a
                key={`${photoUrl}-${index}`}
                href={photoUrl}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-lg border border-gray-700 bg-gray-900"
              >
                <img
                  src={photoUrl}
                  alt={`Registro fotografico ${index + 1}`}
                  className="h-40 w-full object-cover transition-transform group-hover:scale-105"
                />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">Sem registro fotografico</p>
        )}
      </Card>

      <Card variant="bordered" padding="lg">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">
              <SignatureIcon size={18} className="mr-2 inline-block" />
              PDFs assinados por pessoa
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              {attachedDocumentCount}/{documentRequirements.length} documento(s) anexado(s)
            </p>
          </div>
          <Badge variant={documentRequirements.length > 0 && attachedDocumentCount === documentRequirements.length ? 'success' : attachedDocumentCount > 0 ? 'warning' : 'default'}>
            {documentRequirements.length > 0 && attachedDocumentCount === documentRequirements.length
              ? 'Completo'
              : attachedDocumentCount > 0
                ? 'Parcial'
                : 'Pendente'}
          </Badge>
        </div>

        {documentError && <Alert variant="danger" className="mb-4">{documentError}</Alert>}

        {documentRequirements.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 bg-white/3 px-4 py-5 text-sm text-gray-500">
            Nenhuma pendencia individual foi encontrada. Se esta retirada e anterior a atualizacao, os anexos legados continuam abaixo.
          </p>
        ) : (
          <div className="space-y-3">
            {documentRequirements.map((requirement) => {
              const activeDocument = activeRequirementDocument(requirement)
              const isUploading = uploadingRequirementId === requirement.id
              return (
                <div key={requirement.id} className="rounded-2xl border border-white/8 bg-white/3 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-white">{requirement.person_name_snapshot}</p>
                        <Badge variant={requirement.status === 'attached' ? 'success' : requirement.status === 'rejected' ? 'danger' : 'default'} size="sm">
                          {requirementStatusLabels[requirement.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{requirement.destination_label_snapshot}</p>
                      {activeDocument && (
                        <p className="mt-1 text-xs text-gray-400">
                          {activeDocument.file_name} • versao {activeDocument.version} • {formatDateTime(activeDocument.uploaded_at)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {activeDocument && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void openWithdrawalPdf(activeDocument.storage_path).catch((openError) => {
                            setDocumentError(openError instanceof Error ? openError.message : 'Nao foi possivel abrir o PDF.')
                          })}
                        >
                          Abrir PDF
                        </Button>
                      )}
                      <label className="cursor-pointer rounded-lg bg-orange-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-orange-600">
                        {isUploading ? 'Enviando...' : activeDocument ? 'Substituir PDF' : 'Anexar PDF assinado'}
                        <input
                          type="file"
                          accept=".pdf,application/pdf"
                          disabled={isUploading}
                          className="sr-only"
                          onChange={(event) => {
                            void handleDocumentUpload(requirement, event.target.files?.[0])
                            event.target.value = ''
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {(withdrawal.supervisor_signature || withdrawal.requester_signature || withdrawal.witness_signature || sharedSignatureAttachment.url) && (
      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">
          <SignatureIcon size={18} className="mr-2 inline-block" />
          Assinaturas e anexos legados
          {bothSignaturesPresent && (
            <Badge variant="success" size="sm" className="ml-2">
              OK Completas
            </Badge>
          )}
        </h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-gray-400">Supervisor</p>
            {withdrawal.supervisor_signature ? (
              <div className="flex min-h-[220px] items-center justify-center rounded border border-gray-700 bg-white p-3">
                <img
                  src={withdrawal.supervisor_signature}
                  alt="Assinatura do supervisor"
                  className="h-[190px] w-full object-contain"
                />
              </div>
            ) : (
              <span className="text-xs text-gray-500">Nao assinado</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-gray-400">Solicitante</p>
            {withdrawal.requester_signature ? (
              <div className="flex min-h-[220px] items-center justify-center rounded border border-gray-700 bg-white p-3">
                <img
                  src={withdrawal.requester_signature}
                  alt="Assinatura do solicitante"
                  className="h-[190px] w-full object-contain"
                />
              </div>
            ) : (
              <span className="text-xs text-gray-500">Nao assinado</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-gray-400">Testemunha</p>
            {withdrawal.witness_signature ? (
              <div className="flex min-h-[220px] items-center justify-center rounded border border-gray-700 bg-white p-3">
                <img
                  src={withdrawal.witness_signature}
                  alt="Assinatura da testemunha"
                  className="h-[190px] w-full object-contain"
                />
              </div>
            ) : (
              <span className="text-xs text-gray-500">Opcional</span>
            )}
          </div>
        </div>

        {sharedSignatureAttachment.url && (
          <div className="mt-6">
            <AttachmentCard
              label="Documento/Foto compartilhado das assinaturas"
              url={sharedSignatureAttachment.url}
              fileName={sharedSignatureAttachment.name}
            />
          </div>
        )}
      </Card>
      )}

      <Modal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="Cancelar Retirada"
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-300">
            Tem certeza que deseja cancelar esta retirada? O estoque sera restaurado automaticamente.
          </p>
          {cancelError && (
            <Alert variant="danger">{cancelError}</Alert>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowCancelModal(false)}
              disabled={cancelling}
            >
              Nao
            </Button>
            <Button
              variant="danger"
              onClick={handleCancel}
              isLoading={cancelling}
            >
              Sim, Cancelar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showReopenModal}
        onClose={() => setShowReopenModal(false)}
        title="Reabrir Retirada"
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-300">
            Esta retirada voltara para concluida. O sistema vai baixar novamente os itens do estoque e recriar o inventario do colaborador quando houver destino pessoal.
          </p>
          {reopenError && (
            <Alert variant="danger">{reopenError}</Alert>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowReopenModal(false)}
              disabled={reopening}
            >
              Manter rejeitada
            </Button>
            <Button
              variant="primary"
              onClick={handleReopen}
              isLoading={reopening}
            >
              Sim, Reabrir
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(returningItem)}
        onClose={closeReturnModal}
        title="Registrar devolucao"
        size="sm"
      >
        {returningItem && (() => {
          const registeredQuantity = returnTotals[returningItem.id]?.registered ?? 0
          const available = Math.max(returningItem.quantity - registeredQuantity, 0)
          return (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/4 p-3 text-sm">
                <p className="font-medium text-white">{returningItem.stock_items?.name ?? 'Item da retirada'}</p>
                <p className="mt-1 text-gray-400">
                  Retirada {withdrawal.code} · {withdrawalItemDestinationLabel(returningItem, withdrawal)}
                </p>
                <p className="mt-1 text-emerald-300">Disponivel para devolver: {available} {returningItem.unit}</p>
              </div>

              <Input
                label="Quantidade devolvida"
                type="number"
                min="1"
                max={available}
                value={returnQuantity}
                onChange={(event) => setReturnQuantity(event.target.value)}
                disabled={returning}
              />

              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: 'used', label: 'Usado', description: 'Vai para triagem para limpeza ou nova liberacao.' },
                  { value: 'damaged', label: 'Com avaria', description: 'Vai para triagem para avaliacao tecnica.' },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setReturnCondition(option.value)}
                    disabled={returning}
                    className={`rounded-xl border p-3 text-left text-sm transition-colors ${returnCondition === option.value ? 'border-orange-400 bg-orange-500/10 text-white' : 'border-white/10 bg-white/3 text-gray-300'}`}
                  >
                    <p className="font-medium">{option.label}</p>
                    <p className="mt-1 text-xs text-gray-400">{option.description}</p>
                  </button>
                ))}
              </div>

              {returnError && <Alert variant="danger">{returnError}</Alert>}

              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={closeReturnModal} disabled={returning}>Cancelar</Button>
                <Button onClick={() => void handleReturn()} isLoading={returning} disabled={available === 0}>
                  Confirmar devolucao
                </Button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}

function resolveSharedSignatureAttachment(withdrawal: WithdrawalRow): { url: string | null; name: string | null } {
  return {
    url: withdrawal.supervisor_signature_attachment_url ?? withdrawal.requester_signature_attachment_url ?? null,
    name: withdrawal.supervisor_signature_attachment_name ?? withdrawal.requester_signature_attachment_name ?? null,
  }
}

function getWithdrawalPhotoUrls(withdrawal: WithdrawalRow): string[] {
  const urls = [
    ...(withdrawal.photo_urls ?? []),
    withdrawal.photo_url,
  ].filter((url): url is string => !!url)

  return Array.from(new Set(urls))
}

function withdrawalItemDestinationLabel(
  item: WithdrawalRow['withdrawal_items'][number],
  withdrawal: WithdrawalRow,
): string {
  const destinationType = item.destination_type ?? withdrawal.destination_type

  if (destinationType === 'collaborator') {
    const collaborator = item.collaborator ?? withdrawal.collaborator
    if (!collaborator) return 'Colaborador nao informado'
    return `${collaborator.full_name}${collaborator.employee_id ? ` (${collaborator.employee_id})` : ''}`
  }

  return item.work_site?.name ?? withdrawal.work_site?.name ?? 'Obra'
}

function withdrawalDestinationsSummary(withdrawal: WithdrawalRow): string {
  const itemDestinations = withdrawal.withdrawal_items?.map((item) =>
    withdrawalItemDestinationLabel(item, withdrawal),
  ) ?? []
  const uniqueDestinations = Array.from(new Set(itemDestinations.filter(Boolean)))

  if (uniqueDestinations.length === 0) {
    if (withdrawal.destination_type === 'collaborator') {
      return withdrawal.collaborator
        ? `${withdrawal.collaborator.full_name} - Inventario pessoal`
        : 'Colaborador nao informado'
    }

    return withdrawal.work_site?.name ?? 'Obra'
  }

  return uniqueDestinations.join(' / ')
}

function isImageUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)
}

function AttachmentCard({
  label,
  url,
  fileName,
}: {
  label: string
  url: string | null
  fileName: string | null
}) {
  if (!url) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900/40 p-4">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="mt-2 text-sm text-gray-500">Nao enviado</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/40 p-4">
      <p className="text-sm font-medium text-white">{label}</p>
      <p className="mt-2 text-xs text-gray-400">{fileName ?? 'Arquivo anexado'}</p>
      {isImageUrl(url) ? (
        <img
          src={buildPublicStorageUrl(url)}
          alt={label}
          className="mt-3 max-h-56 rounded-lg border border-gray-700"
        />
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-gray-700 px-4 py-8 text-sm text-gray-500">
          Documento anexado
        </div>
      )}
      <a
        href={buildPublicStorageUrl(url)}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block text-sm font-medium text-orange-300 hover:text-orange-200"
      >
        Abrir anexo
      </a>
    </div>
  )
}
