import { supabase } from '../lib/supabase'

/*
 * Gestao de contas de login do almoxarifado.
 *
 * Nenhuma destas operacoes escreve em profiles pela tabela: todas passam por
 * RPC SECURITY DEFINER que exige administrador ativo e registra auditoria. A
 * tela so esconde o botao; quem decide e o banco. Um supervisor que chame
 * estas funcoes direto recebe "Acesso negado" do Postgres.
 */

export type AccountRole = 'admin' | 'supervisor'

export interface AccountOverview {
  id: string
  full_name: string
  email: string | null
  employee_id: string | null
  role: AccountRole
  sector: string | null
  photo_url: string | null
  is_active: boolean
  created_at: string
  last_sign_in_at: string | null
  withdrawals_count: number
  returns_count: number
  audit_count: number
  last_action_at: string | null
}

/* As mensagens do banco ja vem em portugues e sao especificas; so traduzimos
 * o que chega cru do PostgREST. */
function formatError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : ''

  if (!raw) return 'Ocorreu um erro inesperado. Tente novamente.'

  const message = raw.toLowerCase()

  if (message.includes('acesso negado')) return raw
  if (message.includes('administrador ativo')) return raw
  if (message.includes('ja esta cadastrado')) return 'Este e-mail ja esta cadastrado.'
  if (message.includes('conta nao encontrada')) return 'Conta nao encontrada.'
  if (message.includes('propria conta')) return raw
  if (message.includes('senha deve ter')) return 'Senha deve ter pelo menos 6 caracteres.'
  if (message.includes('network') || message.includes('fetch')) {
    return 'Erro de conexao. Verifique sua internet e tente novamente.'
  }

  return raw
}

export async function fetchAccountOverview(): Promise<{
  accounts: AccountOverview[]
  error: string | null
}> {
  try {
    const { data, error } = await supabase.rpc('admin_account_overview')

    if (error) return { accounts: [], error: formatError(error) }

    const rows = data ?? []

    /* count(*) volta como bigint, que o PostgREST serializa em string. */
    const accounts: AccountOverview[] = rows.map((row) => ({
      ...row,
      role: row.role === 'admin' ? 'admin' : 'supervisor',
      withdrawals_count: Number(row.withdrawals_count ?? 0),
      returns_count: Number(row.returns_count ?? 0),
      audit_count: Number(row.audit_count ?? 0),
    }))

    return { accounts, error: null }
  } catch (error) {
    return { accounts: [], error: formatError(error) }
  }
}

export async function setAccountActive(
  profileId: string,
  isActive: boolean
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('set_supervisor_active', {
      p_profile_id: profileId,
      p_is_active: isActive,
    })

    return { error: error ? formatError(error) : null }
  } catch (error) {
    return { error: formatError(error) }
  }
}

export async function setAccountRole(
  profileId: string,
  role: AccountRole
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('set_supervisor_role', {
      p_profile_id: profileId,
      p_role: role,
    })

    return { error: error ? formatError(error) : null }
  } catch (error) {
    return { error: formatError(error) }
  }
}

export async function resetAccountPassword(
  profileId: string,
  password: string
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('reset_supervisor_password', {
      p_profile_id: profileId,
      p_password: password,
    })

    return { error: error ? formatError(error) : null }
  } catch (error) {
    return { error: formatError(error) }
  }
}

export async function createAccount(data: {
  email: string
  password: string
  full_name: string
  employee_id?: string
  sector?: string
}): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('create_supervisor_account', {
      p_email: data.email.trim(),
      p_password: data.password,
      p_full_name: data.full_name.trim(),
      p_employee_id: data.employee_id?.trim() || null,
      p_sector: data.sector?.trim() || null,
    })

    return { error: error ? formatError(error) : null }
  } catch (error) {
    return { error: formatError(error) }
  }
}
