import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from '../ui'
import { ProfileModal } from './ProfileModal'
import type { NotificationItem } from '../../hooks/useNotifications'
import { ItemVisual } from '../items/ItemVisual'
import { AlertIcon, ClipboardIcon, WarehouseIcon } from '../icons'

interface RouteTitle {
  path: string
  title: string
}

interface SearchAction {
  label: string
  description: string
  path: string
}

const routeTitles: RouteTitle[] = [
  { path: '/', title: 'Painel de Controle' },
  { path: '/stock', title: 'Gestao de Estoque' },
  { path: '/people', title: 'Gestao de Colaboradores' },
  { path: '/withdrawals', title: 'Retiradas' },
  { path: '/reports', title: 'Relatorios' },
  { path: '/audit', title: 'Auditoria' },
  { path: '/supervisors', title: 'Supervisores' },
  { path: '/profile', title: 'Perfil' },
]

const searchActions: SearchAction[] = [
  { label: 'Painel de Controle', description: 'Visao geral do sistema', path: '/' },
  { label: 'Estoque', description: 'Itens do almoxarifado', path: '/stock' },
  { label: 'Kits', description: 'Kits dentro do estoque', path: '/stock?tab=kits' },
  { label: 'Nova Retirada', description: 'Criar uma retirada', path: '/withdrawals/new' },
  { label: 'Retiradas', description: 'Listagem de retiradas', path: '/withdrawals' },
  { label: 'Colaboradores', description: 'Gestao de colaboradores', path: '/people' },
  { label: 'Relatorios', description: 'Analises e indicadores', path: '/reports' },
  { label: 'Supervisores', description: 'Contas supervisoras', path: '/supervisors' },
  { label: 'Perfil', description: 'Dados do supervisor', path: '/profile' },
]

interface NotificationDropdownProps {
  notifications: NotificationItem[]
  unreadCount: number
  onClose: () => void
}

function NotificationDropdown({ notifications, unreadCount, onClose }: NotificationDropdownProps) {
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const iconForType = (notification: NotificationItem) => {
    if (notification.type === 'item_added') {
      return <ItemVisual iconKey={notification.itemIconKey} size={18} />
    }

    switch (notification.type) {
      case 'stock_critical':
        return <AlertIcon size={14} className="text-red-200" />
      case 'stock_low':
        return <AlertIcon size={14} className="text-orange-100" />
      case 'stock_return_pending':
        return <WarehouseIcon size={14} className="text-sky-100" />
      case 'stock_return_held':
        return <ClipboardIcon size={14} className="text-amber-100" />
      case 'withdrawal_pending':
        return <ClipboardIcon size={14} className="text-amber-100" />
      case 'withdrawal_completed':
        return <ClipboardIcon size={14} className="text-emerald-100" />
      default:
        return null
    }
  }

  const labelForType = (type: NotificationItem['type']) => {
    switch (type) {
      case 'stock_critical':
        return 'Critico'
      case 'stock_low':
        return 'Alerta'
      case 'stock_return_pending':
        return 'Devolucao'
      case 'stock_return_held':
        return 'Triagem'
      case 'withdrawal_pending':
        return 'Pendente'
      case 'withdrawal_completed':
        return 'Retirada'
      case 'item_added':
        return 'Novo'
    }
  }

  const accentForType = (type: NotificationItem['type']) => {
    switch (type) {
      case 'stock_critical':
        return 'from-red-500/30 to-red-500/5 border-red-400/20 text-red-200'
      case 'stock_low':
        return 'from-orange-500/30 to-orange-500/5 border-orange-400/20 text-orange-100'
      case 'stock_return_pending':
        return 'from-sky-500/30 to-sky-500/5 border-sky-400/20 text-sky-100'
      case 'stock_return_held':
        return 'from-amber-500/30 to-amber-500/5 border-amber-400/20 text-amber-100'
      case 'withdrawal_pending':
        return 'from-amber-500/30 to-amber-500/5 border-amber-400/20 text-amber-100'
      case 'withdrawal_completed':
        return 'from-emerald-500/30 to-emerald-500/5 border-emerald-400/20 text-emerald-100'
      case 'item_added':
        return 'from-emerald-500/30 to-emerald-500/5 border-emerald-400/20 text-emerald-100'
    }
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-[calc(100%+10px)] z-[100] w-[292px] overflow-hidden rounded-[20px] border border-white/10 bg-[#101113]/95 shadow-[0_28px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl"
      role="region"
      aria-label="Notificacoes"
    >
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.16),_transparent_45%)] px-4 py-3.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-200/75">
              Central
            </p>
            <h3 className="mt-1 text-[15px] font-semibold text-white">Notificacoes</h3>
          </div>
          <div className="rounded-full border border-orange-400/20 bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-200">
            {unreadCount} novas
          </div>
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/8 bg-white/5 text-gray-500">
            <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
              <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" />
              <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <p className="text-sm text-gray-400">Tudo limpo por aqui.</p>
        </div>
      ) : (
        <ul className="max-h-[300px] space-y-1.5 overflow-y-auto px-2.5 py-2.5">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <button
                className={cn(
                  'w-full rounded-[18px] border bg-gradient-to-r px-3 py-2.5 text-left transition-all hover:translate-y-[-1px]',
                  accentForType(notification.type)
                )}
                onClick={() => {
                  navigate(notification.linkPath)
                  onClose()
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-white/10 bg-black/15">
                        {iconForType(notification)}
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/75">
                        {labelForType(notification.type)}
                      </span>
                      <span className="text-xs text-white/50">
                        {new Date(notification.createdAt).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] font-semibold text-white">{notification.title}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-white/72">{notification.description}</p>
                  </div>
                  {notification.isUnread ? (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-white/75" />
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface HeaderProps {
  onToggleSidebar: () => void
  unreadCount?: number
  notifications?: NotificationItem[]
  onNotificationsOpen?: () => void
}

export function Header({
  onToggleSidebar,
  unreadCount = 0,
  notifications = [],
  onNotificationsOpen,
}: HeaderProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [showProfile, setShowProfile] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const currentRoute = routeTitles.find((route) => route.path === location.pathname)
  const pageTitle = currentRoute?.title ?? 'JamaaW Storage'

  const initials = profile?.full_name
    ? profile.full_name
        .split(' ')
        .map((word: string) => word[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '??'

  const filteredSearchActions = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase()
    const baseActions = !normalized
      ? searchActions.slice(0, 6)
      : searchActions.filter((item) =>
          item.label.toLowerCase().includes(normalized) ||
          item.description.toLowerCase().includes(normalized)
        )

    if (!normalized) return baseActions

    const query = searchQuery.trim()
    const queryActions: SearchAction[] = [
      {
        label: `Buscar "${query}" no estoque`,
        description: 'Abrir itens do estoque com filtro aplicado',
        path: `/stock?q=${encodeURIComponent(query)}`,
      },
      {
        label: `Buscar "${query}" nos kits`,
        description: 'Abrir kits do estoque com filtro aplicado',
        path: `/stock?tab=kits&q=${encodeURIComponent(query)}`,
      },
      {
        label: `Buscar "${query}" em colaboradores`,
        description: 'Abrir colaboradores com filtro aplicado',
        path: `/people?q=${encodeURIComponent(query)}`,
      },
      {
        label: `Buscar "${query}" em retiradas`,
        description: 'Abrir retiradas com filtro aplicado',
        path: `/withdrawals?q=${encodeURIComponent(query)}`,
      },
    ]

    return [...queryActions, ...baseActions].filter((item, index, arr) =>
      arr.findIndex((candidate) => candidate.path === item.path) === index
    )
  }, [searchQuery])

  const toggleProfile = useCallback(() => {
    setShowProfile((prev) => !prev)
    setShowNotifications(false)
    setShowSearch(false)
  }, [])

  const toggleNotifications = useCallback(() => {
    setShowNotifications((prev) => {
      const next = !prev
      if (next) onNotificationsOpen?.()
      return next
    })
    setShowProfile(false)
    setShowSearch(false)
  }, [onNotificationsOpen])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearch(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <header className="sticky top-0 z-30 flex h-20 items-center gap-4 border-b border-white/8 bg-[#09090b]/72 px-4 backdrop-blur-xl lg:px-6">
      <button
        onClick={onToggleSidebar}
        className="flex items-center justify-center rounded-2xl p-2 text-gray-400 transition-colors hover:bg-white/5 hover:text-white lg:hidden"
        aria-label="Abrir menu"
      >
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
          <path d="M3 12H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M3 6H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M3 18H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold text-white">{pageTitle}</h1>
      </div>

      <div className="flex-1" />

      <div ref={searchRef} className="hidden w-72 sm:block">
        <div className="relative">
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          >
            <path d="M21 21L15 15M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <input
            type="text"
            placeholder="Buscar paginas e acoes..."
            value={searchQuery}
            onFocus={() => setShowSearch(true)}
            onChange={(event) => {
              setSearchQuery(event.target.value)
              setShowSearch(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && filteredSearchActions[0]) {
                navigate(filteredSearchActions[0].path)
                setShowSearch(false)
                setSearchQuery('')
              }
            }}
            className="w-full rounded-2xl border border-white/8 bg-white/4 py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-500 transition-colors focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
          />
          {showSearch && (
            <div className="absolute left-0 right-0 top-[calc(100%+10px)] z-[90] overflow-hidden rounded-2xl border border-white/10 bg-[#101113]/96 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
              <div className="border-b border-white/8 px-4 py-3 text-xs uppercase tracking-[0.2em] text-orange-200/75">
                Busca rapida
              </div>
              <ul className="max-h-[280px] overflow-y-auto p-2">
                {filteredSearchActions.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-gray-400">Nenhum atalho encontrado.</li>
                ) : (
                  filteredSearchActions.map((item) => (
                    <li key={item.path}>
                      <button
                        type="button"
                        onClick={() => {
                          navigate(item.path)
                          setShowSearch(false)
                          setSearchQuery('')
                        }}
                        className="flex w-full items-start justify-between rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">{item.label}</p>
                          <p className="mt-0.5 text-xs text-gray-400">{item.description}</p>
                        </div>
                        <span className="text-xs text-gray-500">Abrir</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="relative">
        <button
          onClick={toggleNotifications}
          className={cn(
            'relative flex items-center justify-center rounded-2xl p-2.5 transition-colors',
            showNotifications
              ? 'bg-orange-500/15 text-orange-300'
              : 'text-gray-400 hover:bg-white/5 hover:text-white'
          )}
          aria-label={`Notificacoes${unreadCount > 0 ? ` - ${unreadCount} novas` : ''}`}
          aria-expanded={showNotifications}
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {unreadCount > 0 && (
            <Badge variant="danger" size="sm" className="absolute -right-1 -top-1 min-w-[18px] justify-center px-1">
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </button>

        {showNotifications && (
          <NotificationDropdown
            notifications={notifications}
            unreadCount={unreadCount}
            onClose={() => setShowNotifications(false)}
          />
        )}
      </div>

      <div className="relative">
        <button
          onClick={toggleProfile}
          className={cn(
            'flex items-center gap-3 rounded-2xl px-2 py-1.5 transition-colors',
            showProfile ? 'bg-orange-500/10' : 'hover:bg-white/5'
          )}
          aria-label="Abrir perfil"
          aria-expanded={showProfile}
        >
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-xs font-bold',
              showProfile ? 'bg-orange-500/30 text-orange-200' : 'bg-orange-500/18 text-orange-300'
            )}
          >
            {profile?.photo_url ? (
              <img src={profile.photo_url} alt={profile.full_name ?? 'Supervisor'} className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <span className="hidden text-sm font-medium text-white lg:block">
            {profile?.full_name ?? 'Supervisor'}
          </span>
        </button>

        {showProfile && profile && (
          <ProfileModal profile={profile} onClose={() => setShowProfile(false)} />
        )}
      </div>
    </header>
  )
}
