import { useState, useCallback, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from '../ui'
import { ProfileModal } from './ProfileModal'
import type { NotificationItem } from '../../hooks/useNotifications'

// ─── Route Titles ─────────────────────────────────────────────────────────────

interface RouteTitle {
  path: string
  title: string
}

const routeTitles: RouteTitle[] = [
  { path: '/', title: 'Painel de Controle' },
  { path: '/stock', title: 'Gestão de Estoque' },
  { path: '/people', title: 'Gestão de Pessoas' },
  { path: '/withdrawals', title: 'Retiradas' },
  { path: '/kits', title: 'Kits' },
  { path: '/worksites', title: 'Obras' },
  { path: '/reports', title: 'Relatórios' },
  { path: '/audit', title: 'Auditoria' },
]

// ─── Notification Dropdown ────────────────────────────────────────────────────

interface NotificationDropdownProps {
  notifications: NotificationItem[]
  onClose: () => void
}

function NotificationDropdown({ notifications, onClose }: NotificationDropdownProps) {
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const totalCount = notifications.length

  const iconForType = (type: NotificationItem['type']) => {
    switch (type) {
      case 'stock_critical':
        return (
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <path d="M12 8v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'stock_low':
        return (
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <path d="M12 8v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'withdrawal_pending':
        return (
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <path d="M3 3h18v18H3zM12 8v8M8 12h8" stroke="#facc15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'item_added':
        return (
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
    }
  }

  const iconBgForType = (type: NotificationItem['type']) => {
    switch (type) {
      case 'stock_critical': return 'rgba(248,113,113,0.12)'
      case 'stock_low': return 'rgba(249,115,22,0.12)'
      case 'withdrawal_pending': return 'rgba(250,204,21,0.12)'
      case 'item_added': return 'rgba(74,222,128,0.12)'
    }
  }

  return (
    <div
      ref={ref}
      style={dropdownStyles.panel}
      role="region"
      aria-label="Notificações"
    >
      <div style={dropdownStyles.header}>
        <span style={dropdownStyles.headerTitle}>Notificações</span>
        {totalCount > 0 && (
          <span style={dropdownStyles.countBadge}>{totalCount}</span>
        )}
      </div>

      {totalCount === 0 ? (
        <div style={dropdownStyles.empty}>
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" style={{ color: 'rgba(255,255,255,0.2)' }}>
            <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" />
            <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" />
          </svg>
          <p style={dropdownStyles.emptyText}>Sem notificações pendentes</p>
        </div>
      ) : (
        <ul style={dropdownStyles.list} role="list">
          {notifications.slice(0, 8).map((notif) => (
            <li key={notif.id} style={dropdownStyles.listItem}>
              <button
                style={dropdownStyles.notifBtn}
                onClick={() => {
                  navigate(notif.linkPath)
                  onClose()
                }}
                title={`Ir para ${notif.linkPath}`}
              >
                <div style={{ ...dropdownStyles.notifIcon, background: iconBgForType(notif.type) }}>
                  {iconForType(notif.type)}
                </div>
                <div style={dropdownStyles.notifContent}>
                  <p style={dropdownStyles.notifName}>{notif.title}</p>
                  <p style={dropdownStyles.notifMeta}>{notif.description}</p>
                </div>
              </button>
            </li>
          ))}
          {totalCount > 8 && (
            <li style={{ padding: '8px 16px', textAlign: 'center' }}>
              <button
                style={{ background: 'none', border: 'none', color: '#f97316', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                onClick={() => { navigate('/'); onClose() }}
              >
                +{totalCount - 8} notificações — Ver todas
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

interface HeaderProps {
  onToggleSidebar: () => void
  lowStockCount?: number
  notifications?: NotificationItem[]
}

export function Header({
  onToggleSidebar,
  lowStockCount = 0,
  notifications = [],
}: HeaderProps) {
  const location = useLocation()
  const { profile } = useAuth()

  const [showProfile, setShowProfile] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)

  const currentRoute = routeTitles.find((r) => r.path === location.pathname)
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

  const toggleProfile = useCallback(() => {
    setShowProfile((prev) => !prev)
    setShowNotifications(false)
  }, [])

  const toggleNotifications = useCallback(() => {
    setShowNotifications((prev) => !prev)
    setShowProfile(false)
  }, [])

  const closeProfile = useCallback(() => setShowProfile(false), [])
  const closeNotifications = useCallback(() => setShowNotifications(false), [])

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-gray-800 bg-gray-950/80 px-4 backdrop-blur-sm lg:px-6">
        {/* Hamburger */}
        <button
          onClick={onToggleSidebar}
          className="flex items-center justify-center rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white lg:hidden"
          aria-label="Abrir menu"
        >
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
            <path d="M3 12H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 6H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 18H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Page Title */}
        <h1 className="text-lg font-semibold text-white">{pageTitle}</h1>

        <div className="flex-1" />

        {/* Search (decorative) */}
        <div className="hidden w-64 sm:block">
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
              placeholder="Buscar..."
              className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pl-10 pr-4 text-sm text-white placeholder-gray-500 transition-colors focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
              readOnly
            />
          </div>
        </div>

        {/* Notification Bell */}
        <div style={{ position: 'relative' }}>
          <button
            id="header-notifications-btn"
            onClick={toggleNotifications}
            className={cn(
              'relative flex items-center justify-center rounded-lg p-2 transition-colors',
              showNotifications
                ? 'bg-orange-500/15 text-orange-400'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            )}
            aria-label={`Notificações${lowStockCount > 0 ? ` — ${lowStockCount} alertas` : ''}`}
            aria-expanded={showNotifications}
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {lowStockCount > 0 && (
              <Badge
                variant="danger"
                size="sm"
                className="absolute -right-1 -top-1 min-w-[18px] justify-center px-1"
              >
                {lowStockCount > 99 ? '99+' : lowStockCount}
              </Badge>
            )}
          </button>

          {showNotifications && (
        <NotificationDropdown
          notifications={notifications}
          onClose={closeNotifications}
        />
          )}
        </div>

        {/* Profile Button */}
        <div style={{ position: 'relative' }}>
          <button
            id="header-profile-btn"
            onClick={toggleProfile}
            className={cn(
              'flex items-center gap-3 rounded-lg px-2 py-1 transition-colors',
              showProfile
                ? 'bg-orange-500/10'
                : 'hover:bg-gray-800'
            )}
            aria-label="Abrir perfil"
            aria-expanded={showProfile}
          >
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold',
                showProfile
                  ? 'bg-orange-500/30 text-orange-300'
                  : 'bg-orange-500/20 text-orange-400'
              )}
            >
              {initials}
            </div>
            <span className="hidden text-sm font-medium text-white lg:block">
              {profile?.full_name ?? 'Supervisor'}
            </span>
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              className={cn(
                'hidden text-gray-500 transition-transform lg:block',
                showProfile && 'rotate-180'
              )}
            >
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {showProfile && profile && (
            <ProfileModal profile={profile} onClose={closeProfile} />
          )}
        </div>
      </header>
    </>
  )
}

// ─── Dropdown Styles ──────────────────────────────────────────────────────────

const dropdownStyles = {
  panel: {
    position: 'absolute' as const,
    top: 'calc(100% + 8px)',
    right: 0,
    width: 300,
    background: '#111111',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14,
    boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
    zIndex: 100,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px 10px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    fontFamily: "'Outfit', sans-serif",
  },
  countBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#fff',
    background: '#dc2626',
    borderRadius: 20,
    padding: '2px 7px',
    fontFamily: "'Inter', sans-serif",
  },
  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 8,
    padding: '24px 16px',
  },
  emptyText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    margin: 0,
    fontFamily: "'Inter', sans-serif",
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: '6px 0',
    maxHeight: 320,
    overflowY: 'auto' as const,
  },
  listItem: {
    display: 'block',
  },
  notifBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '10px 16px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'background 0.15s',
  },
  notifIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: 'rgba(249,115,22,0.12)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  notifContent: {
    flex: 1,
    minWidth: 0,
  },
  notifName: {
    margin: 0,
    fontSize: 13,
    fontWeight: 500,
    color: '#fff',
    fontFamily: "'Inter', sans-serif",
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  notifMeta: {
    margin: '2px 0 0',
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: "'Inter', sans-serif",
  },
} as const
