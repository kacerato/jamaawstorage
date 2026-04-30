import { useState, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { LogoIcon } from '../icons'
import {
  WarehouseIcon,
  PackageIcon,
  UsersIcon,
  ClipboardIcon,
  KitIcon,
  BuildingIcon,
  ChartIcon,
  SignatureIcon,
  UserIcon,
} from '../icons'
import { useAuth } from '../../hooks/useAuth'

interface NavItem {
  label: string
  path: string
  icon: React.ReactNode
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: <WarehouseIcon size={20} /> },
  { label: 'Estoque', path: '/stock', icon: <PackageIcon size={20} /> },
  { label: 'Pessoas', path: '/people', icon: <UsersIcon size={20} /> },
  { label: 'Supervisores', path: '/supervisors', icon: <UsersIcon size={20} /> },
  { label: 'Retiradas', path: '/withdrawals', icon: <ClipboardIcon size={20} /> },
  { label: 'Kits', path: '/kits', icon: <KitIcon size={20} /> },
  { label: 'Obras', path: '/worksites', icon: <BuildingIcon size={20} /> },
  { label: 'Relatórios', path: '/reports', icon: <ChartIcon size={20} /> },
  { label: 'Auditoria', path: '/audit', icon: <SignatureIcon size={20} /> },
  { label: 'Perfil', path: '/profile', icon: <UserIcon size={20} /> },
]

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { profile, signOut } = useAuth()

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  const handleNavClick = useCallback(() => {
    if (window.innerWidth < 1024) {
      onClose()
    }
  }, [onClose])

  const handleSignOut = useCallback(async () => {
    await signOut()
    onClose()
  }, [signOut, onClose])

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed top-0 left-0 z-50 flex h-full flex-col border-r border-gray-800 bg-gray-950 transition-all duration-300',
          collapsed ? 'w-16' : 'w-64',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className={cn('flex items-center gap-3 border-b border-gray-800 px-4 py-4', collapsed && 'justify-center px-2')}>
          <LogoIcon size={32} />
          {!collapsed && (
            <span className="text-lg font-bold text-orange-500 whitespace-nowrap">
              JamaaW Storage
            </span>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4">
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  onClick={handleNavClick}
                  className={({ isActive }: { isActive: boolean }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-orange-500/10 text-orange-500 border-l-2 border-orange-500'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800',
                      collapsed && 'justify-center px-2',
                    )
                  }
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className={cn('border-t border-gray-800 px-3 py-3', collapsed && 'px-2')}>
          {!collapsed && profile && (
            <div className="mb-2 flex flex-col px-2">
              <span className="text-sm font-medium text-white truncate">
                {profile.full_name}
              </span>
              <span className="text-xs text-gray-400">Supervisor</span>
            </div>
          )}
          <button
            onClick={handleSignOut}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-red-400',
              collapsed && 'justify-center px-2',
            )}
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M16 17L21 12L16 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {!collapsed && <span>Sair</span>}
          </button>
        </div>

        <div className={cn('border-t border-gray-800 px-3 py-2', collapsed && 'px-2')}>
          <button
            onClick={handleToggleCollapse}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white',
              collapsed && 'justify-center px-2',
            )}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className={cn('transition-transform', collapsed && 'rotate-180')}
            >
              <path d="M11 19L4 12L11 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 12H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {!collapsed && <span>Recolher</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
