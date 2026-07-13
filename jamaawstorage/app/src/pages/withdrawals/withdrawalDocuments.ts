import { supabase } from '../../lib/supabase'
import {
  createWithdrawalDocumentSignedUrl,
  removeWithdrawalSignedPdf,
  uploadWithdrawalSignedPdf,
  validateWithdrawalPdf,
} from '../../lib/storage'
import type { Tables } from '../../types/database'

export type WithdrawalDocumentRequirement = Tables<'withdrawal_document_requirements'> & {
  documents?: Tables<'withdrawal_person_documents'>[]
}

export async function registerWithdrawalPdf({
  requirement,
  file,
}: {
  requirement: Pick<WithdrawalDocumentRequirement, 'id' | 'withdrawal_id'>
  file: File
}): Promise<string> {
  await validateWithdrawalPdf(file)
  const uploaded = await uploadWithdrawalSignedPdf({
    file,
    withdrawalId: requirement.withdrawal_id,
    requirementId: requirement.id,
  })

  const { data, error } = await supabase.rpc('register_withdrawal_person_document', {
    p_requirement_id: requirement.id,
    p_storage_path: uploaded.storagePath,
    p_file_name: file.name,
    p_mime_type: 'application/pdf',
    p_file_size: file.size,
    p_sha256: uploaded.sha256,
    p_notes: null,
  })

  if (error || !data) {
    await removeWithdrawalSignedPdf(uploaded.storagePath).catch(() => undefined)
    throw new Error(error?.message ?? 'Nao foi possivel registrar o PDF na retirada.')
  }

  return data
}

export async function openWithdrawalPdf(storagePath: string): Promise<void> {
  const signedUrl = await createWithdrawalDocumentSignedUrl(storagePath)
  window.open(signedUrl, '_blank', 'noopener,noreferrer')
}

export function activeRequirementDocument(requirement: WithdrawalDocumentRequirement) {
  return requirement.documents
    ?.filter((document) => document.status === 'active')
    .sort((a, b) => b.version - a.version)[0] ?? null
}

export const requirementStatusLabels = {
  pending: 'Pendente',
  attached: 'Anexado',
  rejected: 'Rejeitado',
  replaced: 'Substituido',
  not_required: 'Nao exigido',
} as const
