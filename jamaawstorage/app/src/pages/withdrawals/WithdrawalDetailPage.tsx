import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { WithdrawalWithDetails, WithdrawalStatus } from '../../types'
import { buildPublicStorageUrl } from '../../lib/storage'
import { openPrintWithdrawalTerm } from './withdrawalPrint'
import {
  Button,
  Card,
  Badge,
  Modal,
  Alert,
  Spinner,
  EmptyState,
} from '../../components/ui'
import {
  ClipboardIcon,
  SignatureIcon,
  CameraIcon,
} from '../../components/icons'
import { formatDateTime } from '../../lib/utils'

type WithdrawalRow = WithdrawalWithDetails

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
  const autoPrintHandledRef = useRef(false)

  const [withdrawal, setWithdrawal] = useState<WithdrawalRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updateLogCount, setUpdateLogCount] = useState(0)

  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    supabase
      .from('withdrawals')
      .select(
        '*, withdrawal_items(*, stock_items(*), collaborator:people!withdrawal_items_collaborator_id_fkey(id, full_name, employee_id), work_site:work_sites!withdrawal_items_work_site_id_fkey(id, name)), requested_by_person:people!withdrawals_requested_by_fkey(*), collaborator:people!withdrawals_collaborator_id_fkey(*), work_site:work_sites!withdrawals_work_site_id_fkey(*), approved_by_profile:profiles!withdrawals_authorized_by_fkey(*)',
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
        }
        setLoading(false)
      })

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
  }, [id])

  useEffect(() => {
    if (!withdrawal || !shouldAutoPrint || autoPrintHandledRef.current) return
    autoPrintHandledRef.current = true
    openPrintWithdrawalTerm(withdrawal)
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
  const hasSupervisorSignature = !!withdrawal.supervisor_signature
  const hasRequesterSignature = !!withdrawal.requester_signature
  const bothSignaturesPresent = hasSupervisorSignature && hasRequesterSignature
  const sharedSignatureAttachment = resolveSharedSignatureAttachment(withdrawal)
  const photoUrls = getWithdrawalPhotoUrls(withdrawal)

  const destinationLabel =
    withdrawal.destination_type === 'collaborator'
      ? withdrawal.collaborator
        ? `${withdrawal.collaborator.full_name} - Inventario pessoal`
        : 'Colaborador nao informado'
      : 'obra jamaaw'

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
            </div>
            <p className="mt-1 text-sm text-gray-400">
              {formatDateTime(withdrawal.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => openPrintWithdrawalTerm(withdrawal)}
          >
            Gerar Termo PDF
          </Button>
          {canEdit && (
            <Button
              variant="outline"
              onClick={() => navigate(`/withdrawals/${withdrawal.id}/edit`)}
            >
              Editar Retirada
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
            <p className="text-xs font-medium text-gray-400">Destino</p>
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
                </tr>
              </thead>
              <tbody>
                {withdrawal.withdrawal_items.map((wi) => (
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
                  </tr>
                ))}
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
        <h3 className="mb-4 text-lg font-semibold text-white">
          <SignatureIcon size={18} className="mr-2 inline-block" />
          Assinaturas
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
