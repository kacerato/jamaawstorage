import { useLocation } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from '../ui'

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

interface HeaderProps {
  onToggleSidebar: () => void
  lowStockCount?: number
}

export function Header({ onToggleSidebar, lowStockCount = 0 }: HeaderProps) {
  const location = useLocation()
  const { profile } = useAuth()

  const currentRoute = routeTitles.find((r) => r.path === location.pathname)
  const pageTitle = currentRoute?.title ?? 'JamaaW Storage'

  const initials = profile?.full_name
    ? profile.full_name
        .split(' ')
        .map((word: string) => word[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '??'

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-gray-800 bg-gray-950/80 px-4 backdrop-blur-sm lg:px-6">
      <button
        onClick={onToggleSidebar}
        className="flex items-center justify-center rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white lg:hidden"
        aria-label="Abrir menu"
      >
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 12H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 6H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 18H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <h1 className="text-lg font-semibold text-white">{pageTitle}</h1>

      <div className="flex-1" />

      <div className="hidden w-64 sm:block">
        <div className="relative">
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
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

      <button
        className="relative flex items-center justify-center rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        aria-label="Alertas de estoque baixo"
      >
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {lowStockCount > 0 && (
          <Badge variant="danger" size="sm" className="absolute -right-1 -top-1 min-w-[18px] justify-center px-1">
            {lowStockCount > 99 ? '99+' : lowStockCount}
          </Badge>
        )}
      </button>

      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/20 text-xs font-bold text-orange-400',
          )}
        >
          {initials}
        </div>
        <span className="hidden text-sm font-medium text-white lg:block">
          {profile?.full_name ?? 'Supervisor'}
        </span>
      </div>
    </header>
  )
}
