import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { WithdrawalWithDetails, WithdrawalStatus } from '../../types'
import { buildPublicStorageUrl } from '../../lib/storage'
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

  const [withdrawal, setWithdrawal] = useState<WithdrawalRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    supabase
      .from('withdrawals')
      .select(
        '*, withdrawal_items(*, stock_items(*)), requested_by_person:people!withdrawals_requested_by_fkey(*), collaborator:people!withdrawals_collaborator_id_fkey(*), work_site:work_sites!withdrawals_work_site_id_fkey(*), approved_by_profile:profiles!withdrawals_authorized_by_fkey(*)',
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

    return () => { cancelled = true }
  }, [id])

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
  const hasSupervisorSignature = !!withdrawal.supervisor_signature
  const hasRequesterSignature = !!withdrawal.requester_signature
  const bothSignaturesPresent = hasSupervisorSignature && hasRequesterSignature
  const sharedSignatureAttachment = resolveSharedSignatureAttachment(withdrawal)

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
        {canCancel && (
          <Button
            variant="danger"
            onClick={() => setShowCancelModal(true)}
          >
            Cancelar Retirada
          </Button>
        )}
      </div>

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
        {withdrawal.photo_url ? (
          <img
            src={withdrawal.photo_url}
            alt="Registro fotografico"
            className="max-h-64 rounded-lg border border-gray-700"
          />
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
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-medium text-gray-400">Supervisor</p>
            {withdrawal.supervisor_signature ? (
              <img
                src={withdrawal.supervisor_signature}
                alt="Assinatura do supervisor"
                className="h-20 rounded border border-gray-700 bg-white p-1"
              />
            ) : (
              <span className="text-xs text-gray-500">Nao assinado</span>
            )}
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-medium text-gray-400">Solicitante</p>
            {withdrawal.requester_signature ? (
              <img
                src={withdrawal.requester_signature}
                alt="Assinatura do solicitante"
                className="h-20 rounded border border-gray-700 bg-white p-1"
              />
            ) : (
              <span className="text-xs text-gray-500">Nao assinado</span>
            )}
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-medium text-gray-400">Testemunha</p>
            {withdrawal.witness_signature ? (
              <img
                src={withdrawal.witness_signature}
                alt="Assinatura da testemunha"
                className="h-20 rounded border border-gray-700 bg-white p-1"
              />
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
