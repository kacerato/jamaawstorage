import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Input, Modal, SectionLabel, Spinner } from '../../components/ui'
import { UsersIcon } from '../../components/icons'
import { useAuth } from '../../hooks/useAuth'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  createAccount,
  fetchAccountOverview,
  resetAccountPassword,
  setAccountActive,
  setAccountRole,
  type AccountOverview,
} from '../../services/accountService'

/*
 * Contas do almoxarifado.
 *
 * A hierarquia e de duas alturas: administrador acima de supervisor. O
 * administrador gerencia contas (criar, ativar, desativar, promover, redefinir
 * senha) e ve a atividade de cada uma; o supervisor opera o almoxarifado.
 *
 * Tudo aqui passa por RPC que exige administrador no banco. Esta tela nao tem
 * poder proprio: se um supervisor chegasse a ela, a RLS devolveria "Acesso
 * negado" em cada chamada.
 */

type PendingAction =
  | { kind: 'deactivate'; account: AccountOverview }
  | { kind: 'activate'; account: AccountOverview }
  | { kind: 'promote'; account: AccountOverview }
  | { kind: 'demote'; account: AccountOverview }

const accountsPageCache: { accounts: AccountOverview[] } = { accounts: [] }

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/* "ha 3 dias" diz mais que a data quando a pergunta e se a conta esta em uso. */
function formatRelative(value: string | null): string {
  if (!value) return 'nunca acessou'

  const diffMs = Date.now() - new Date(value).getTime()
  const days = Math.floor(diffMs / 86_400_000)

  if (days < 0) return formatDate(value)
  if (days === 0) return 'hoje'
  if (days === 1) return 'ontem'
  if (days < 30) return `há ${days} dias`
  if (days < 365) {
    const months = Math.floor(days / 30)
    return months === 1 ? 'há 1 mês' : `há ${months} meses`
  }

  const years = Math.floor(days / 365)
  return years === 1 ? 'há 1 ano' : `há ${years} anos`
}

export function SupervisorsPage() {
  const { profile } = useAuth()
  const [accounts, setAccounts] = useState<AccountOverview[]>(accountsPageCache.accounts)
  const [loading, setLoading] = useState(accountsPageCache.accounts.length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 200)

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [passwordTarget, setPasswordTarget] = useState<AccountOverview | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordDone, setPasswordDone] = useState(false)

  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    employee_id: '',
    sector: '',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [formBusy, setFormBusy] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else if (accountsPageCache.accounts.length === 0) setLoading(true)

    setError(null)

    const { accounts: next, error: loadError } = await fetchAccountOverview()

    if (loadError) {
      setError(loadError)
    } else {
      accountsPageCache.accounts = next
      setAccounts(next)
    }

    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase()
    if (!term) return accounts

    return accounts.filter(
      (account) =>
        account.full_name.toLowerCase().includes(term) ||
        (account.email ?? '').toLowerCase().includes(term) ||
        (account.employee_id ?? '').toLowerCase().includes(term) ||
        (account.sector ?? '').toLowerCase().includes(term)
    )
  }, [accounts, debouncedSearch])

  const summary = useMemo(() => {
    const admins = accounts.filter((a) => a.role === 'admin' && a.is_active).length
    const activeSupervisors = accounts.filter(
      (a) => a.role === 'supervisor' && a.is_active
    ).length
    const inactive = accounts.filter((a) => !a.is_active).length
    const idle = accounts.filter((a) => a.is_active && !a.last_sign_in_at).length

    return { admins, activeSupervisors, inactive, idle }
  }, [accounts])

  const runAction = async (action: PendingAction) => {
    const { kind, account } = action
    setBusyId(account.id)
    setError(null)

    const result =
      kind === 'activate'
        ? await setAccountActive(account.id, true)
        : kind === 'deactivate'
        ? await setAccountActive(account.id, false)
        : kind === 'promote'
        ? await setAccountRole(account.id, 'admin')
        : await setAccountRole(account.id, 'supervisor')

    if (result.error) {
      setError(result.error)
    } else {
      await load(true)
    }

    setBusyId(null)
    setPending(null)
  }

  const submitPassword = async () => {
    if (!passwordTarget) return

    if (newPassword.length < 6) {
      setPasswordError('A senha precisa de pelo menos 6 caracteres.')
      return
    }

    setPasswordError(null)
    setBusyId(passwordTarget.id)

    const { error: resetError } = await resetAccountPassword(passwordTarget.id, newPassword)

    if (resetError) {
      setPasswordError(resetError)
    } else {
      setPasswordDone(true)
      setNewPassword('')
    }

    setBusyId(null)
  }

  const submitCreate = async () => {
    if (!form.full_name.trim()) {
      setFormError('Informe o nome completo.')
      return
    }
    if (!form.email.trim()) {
      setFormError('Informe o e-mail.')
      return
    }
    if (form.password.length < 6) {
      setFormError('A senha precisa de pelo menos 6 caracteres.')
      return
    }

    setFormError(null)
    setFormBusy(true)

    const { error: createError } = await createAccount({
      full_name: form.full_name,
      email: form.email,
      password: form.password,
      employee_id: form.employee_id || undefined,
      sector: form.sector || undefined,
    })

    setFormBusy(false)

    if (createError) {
      setFormError(createError)
      return
    }

    setForm({ full_name: '', email: '', password: '', employee_id: '', sector: '' })
    setCreating(false)
    await load(true)
  }

  const closePasswordModal = () => {
    setPasswordTarget(null)
    setNewPassword('')
    setPasswordError(null)
    setPasswordDone(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold text-ink">Contas</h2>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Nova conta
        </Button>
      </div>

      {/* Uma superficie so: as quatro medidas vivem num bloco, divididas por
          borda, nunca por um segundo fundo. */}
      <div className="grid grid-cols-2 border border-line bg-surface lg:grid-cols-4">
        <div className="border-b border-r border-line px-4 py-4 lg:border-b-0">
          <SectionLabel label="Administradores" />
          <p className="num mt-1 text-2xl text-ink">{summary.admins}</p>
        </div>
        <div className="border-b border-line px-4 py-4 lg:border-b-0 lg:border-r">
          <SectionLabel label="Supervisores ativos" />
          <p className="num mt-1 text-2xl text-ink">{summary.activeSupervisors}</p>
        </div>
        <div className="border-r border-line px-4 py-4">
          <SectionLabel label="Contas inativas" />
          <p className={`num mt-1 text-2xl ${summary.inactive > 0 ? 'text-warn' : 'text-ink'}`}>
            {summary.inactive}
          </p>
        </div>
        <div className="px-4 py-4">
          <SectionLabel label="Nunca acessaram" />
          <p className={`num mt-1 text-2xl ${summary.idle > 0 ? 'text-warn' : 'text-ink'}`}>
            {summary.idle}
          </p>
        </div>
      </div>

      <div className="max-w-md">
        <Input
          placeholder="Buscar por nome, e-mail, matrícula ou setor..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          leftIcon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-ink-dim">
              <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="2" />
              <path d="M11 11L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
        />
      </div>

      {refreshing && (
        <div className="inline-flex items-center gap-2 text-xs text-ink-dim">
          <span className="h-2 w-2 rounded-full bg-blaze" />
          Atualizando contas...
        </div>
      )}

      {error && (
        <div className="border-l-2 border-l-crit bg-void px-4 py-3 text-sm text-crit">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-line bg-surface py-12 text-center">
          <UsersIcon size={48} className="mx-auto mb-4 text-ink-mute" />
          <p className="text-ink-dim">
            {search ? 'Nenhuma conta encontrada para a busca.' : 'Nenhuma conta cadastrada.'}
          </p>
        </div>
      ) : (
        <div className="border border-line bg-surface">
          {filtered.map((account, index) => {
            const isSelf = account.id === profile?.id
            const isAdminAccount = account.role === 'admin'
            const busy = busyId === account.id

            return (
              <div
                key={account.id}
                className={[
                  'px-4 py-4',
                  index > 0 ? 'border-t border-line' : '',
                  /* Faixa lateral carrega a severidade: laranja no topo da
                     hierarquia, aviso em conta desligada. */
                  isAdminAccount
                    ? 'border-l-2 border-l-blaze'
                    : !account.is_active
                    ? 'border-l-2 border-l-warn'
                    : 'border-l-2 border-l-transparent',
                ].join(' ')}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-void text-sm font-medium text-ink-dim">
                      {account.photo_url ? (
                        <img
                          src={account.photo_url}
                          alt={account.full_name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        initials(account.full_name)
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium text-ink">{account.full_name}</p>
                        {isAdminAccount ? (
                          <Badge variant="primary">Administrador</Badge>
                        ) : (
                          <Badge variant="info">Supervisor</Badge>
                        )}
                        {isSelf && <Badge variant="default">Você</Badge>}
                        {!account.is_active && <Badge variant="warning" dot>Inativa</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-dim">
                        {account.email ?? 'sem e-mail'}
                        {account.employee_id ? ` · ${account.employee_id}` : ''}
                        {account.sector ? ` · ${account.sector}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Atividade: o que a conta fez e quando apareceu por aqui. */}
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 lg:flex-shrink-0">
                    <div>
                      <SectionLabel label="Retiradas" />
                      <p className="num text-sm text-ink">{account.withdrawals_count}</p>
                    </div>
                    <div>
                      <SectionLabel label="Devoluções" />
                      <p className="num text-sm text-ink">{account.returns_count}</p>
                    </div>
                    <div>
                      <SectionLabel label="Ações no log" />
                      <p className="num text-sm text-ink">{account.audit_count}</p>
                    </div>
                    <div>
                      <SectionLabel label="Último acesso" />
                      <p
                        className={`text-sm ${
                          account.last_sign_in_at ? 'text-ink' : 'text-ink-mute'
                        }`}
                      >
                        {formatRelative(account.last_sign_in_at)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <Link
                    to={`/audit?user=${account.id}`}
                    className="min-h-touch inline-flex items-center px-3 text-sm text-ink-dim transition-colors hover:text-ink"
                  >
                    Ver auditoria
                  </Link>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setPasswordTarget(account)}
                  >
                    Redefinir senha
                  </Button>

                  {/* A propria conta nao se desliga nem se rebaixa pela tela;
                      o banco tambem recusa, aqui so nao oferecemos. */}
                  {!isSelf && (
                    <>
                      {isAdminAccount ? (
                        <Button
                          variant="outline"
                          size="sm"
                          isLoading={busy}
                          onClick={() => setPending({ kind: 'demote', account })}
                        >
                          Rebaixar a supervisor
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          isLoading={busy}
                          onClick={() => setPending({ kind: 'promote', account })}
                        >
                          Promover a administrador
                        </Button>
                      )}

                      {account.is_active ? (
                        <Button
                          variant="danger"
                          size="sm"
                          isLoading={busy}
                          onClick={() => setPending({ kind: 'deactivate', account })}
                        >
                          Desativar
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          isLoading={busy}
                          onClick={() => setPending({ kind: 'activate', account })}
                        >
                          Reativar
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {pending && (
        <Modal
          isOpen
          onClose={() => setPending(null)}
          title={
            pending.kind === 'promote'
              ? 'Promover a administrador'
              : pending.kind === 'demote'
              ? 'Rebaixar a supervisor'
              : pending.kind === 'deactivate'
              ? 'Desativar conta'
              : 'Reativar conta'
          }
          size="sm"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-dim">
              {pending.kind === 'promote' && (
                <>
                  <span className="font-medium text-ink">{pending.account.full_name}</span>{' '}
                  passa a gerenciar contas e a ver a auditoria de todo o almoxarifado.
                </>
              )}
              {pending.kind === 'demote' && (
                <>
                  <span className="font-medium text-ink">{pending.account.full_name}</span>{' '}
                  deixa de gerenciar contas e de ver a auditoria das outras, mas segue
                  operando o almoxarifado.
                </>
              )}
              {pending.kind === 'deactivate' && (
                <>
                  <span className="font-medium text-ink">{pending.account.full_name}</span>{' '}
                  perde o acesso ao sistema. O histórico de ações é preservado.
                </>
              )}
              {pending.kind === 'activate' && (
                <>
                  <span className="font-medium text-ink">{pending.account.full_name}</span>{' '}
                  volta a acessar o sistema como supervisor.
                </>
              )}
            </p>

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setPending(null)}>
                Cancelar
              </Button>
              <Button
                variant={pending.kind === 'deactivate' ? 'danger' : 'primary'}
                isLoading={busyId === pending.account.id}
                onClick={() => void runAction(pending)}
              >
                Confirmar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {passwordTarget && (
        <Modal isOpen onClose={closePasswordModal} title="Redefinir senha" size="sm">
          <div className="flex flex-col gap-4">
            {passwordDone ? (
              <>
                <p className="text-sm text-ink-dim">
                  Senha de{' '}
                  <span className="font-medium text-ink">{passwordTarget.full_name}</span>{' '}
                  redefinida. Entregue a nova senha pessoalmente e peça a troca no
                  primeiro acesso.
                </p>
                <div className="flex justify-end">
                  <Button variant="primary" onClick={closePasswordModal}>
                    Fechar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-dim">
                  Nova senha para{' '}
                  <span className="font-medium text-ink">{passwordTarget.full_name}</span>.
                </p>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Pelo menos 6 caracteres"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                {passwordError && (
                  <div className="border-l-2 border-l-crit bg-void px-3 py-2 text-sm text-crit">
                    {passwordError}
                  </div>
                )}
                <div className="flex justify-end gap-3">
                  <Button variant="secondary" onClick={closePasswordModal}>
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    isLoading={busyId === passwordTarget.id}
                    onClick={() => void submitPassword()}
                  >
                    Redefinir
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {creating && (
        <Modal isOpen onClose={() => setCreating(false)} title="Nova conta" size="md">
          <div className="flex flex-col gap-4">
            <Input
              label="Nome completo"
              value={form.full_name}
              onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
            />
            <Input
              label="E-mail"
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
            <Input
              label="Senha provisória"
              type="password"
              autoComplete="new-password"
              placeholder="Pelo menos 6 caracteres"
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Matrícula"
                value={form.employee_id}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, employee_id: event.target.value }))
                }
              />
              <Input
                label="Setor"
                value={form.sector}
                onChange={(event) => setForm((prev) => ({ ...prev, sector: event.target.value }))}
              />
            </div>

            <p className="text-xs text-ink-mute">
              A conta nasce como supervisor, já ativa. Promova a administrador depois,
              se for o caso.
            </p>

            {formError && (
              <div className="border-l-2 border-l-crit bg-void px-3 py-2 text-sm text-crit">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button variant="primary" isLoading={formBusy} onClick={() => void submitCreate()}>
                Criar conta
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
