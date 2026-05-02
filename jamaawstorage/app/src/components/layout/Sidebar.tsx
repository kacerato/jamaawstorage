import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/utils'
import {
  WarehouseIcon,
  PackageIcon,
  UsersIcon,
  ClipboardIcon,
  BuildingIcon,
  ChartIcon,
  SignatureIcon,
  UserIcon,
} from '../icons'
import { useAuth } from '../../hooks/useAuth'
import { BrandMark } from './BrandMark'

interface NavItem {
  label: string
  path: string
  icon: React.ReactNode
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: <WarehouseIcon size={20} /> },
  { label: 'Estoque', path: '/stock', icon: <PackageIcon size={20} /> },
  { label: 'Colaboradores', path: '/people', icon: <UsersIcon size={20} /> },
  { label: 'Supervisores', path: '/supervisors', icon: <UsersIcon size={20} /> },
  { label: 'Retiradas', path: '/withdrawals', icon: <ClipboardIcon size={20} /> },
  { label: 'Obras', path: '/worksites', icon: <BuildingIcon size={20} /> },
  { label: 'Relatórios', path: '/reports', icon: <ChartIcon size={20} /> },
  { label: 'Auditoria', path: '/audit', icon: <SignatureIcon size={20} /> },
  { label: 'Perfil', path: '/profile', icon: <UserIcon size={20} /> },
]

interface SidebarProps {
  isOpen: boolean
  isCollapsed: boolean
  onClose: () => void
  onToggleCollapse: () => void
}

export function Sidebar({ isOpen, isCollapsed, onClose, onToggleCollapse }: SidebarProps) {
  const { profile, signOut } = useAuth()

  const handleNavClick = () => {
    if (window.innerWidth < 1024) {
      onClose()
    }
  }

  const handleSignOut = async () => {
    await signOut()
    onClose()
  }

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
          'fixed left-0 top-0 z-50 flex h-full flex-col border-r border-white/10 bg-[#0b0b0c]/95 backdrop-blur-xl transition-all duration-300',
          isCollapsed ? 'w-16' : 'w-64',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className={cn('border-b border-white/8 px-3 py-4', isCollapsed && 'px-2')}>
          {isCollapsed ? (
            <div className="flex justify-center">
              <BrandMark compact />
            </div>
          ) : (
            <BrandMark />
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4">
          <ul className="flex flex-col gap-1.5">
            {navItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  onClick={handleNavClick}
                  className={({ isActive }: { isActive: boolean }) =>
                    cn(
                      'group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-gradient-to-r from-orange-500/18 to-orange-400/6 text-orange-300 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.24)]'
                        : 'text-gray-400 hover:bg-white/5 hover:text-white',
                      isCollapsed && 'justify-center px-2'
                    )
                  }
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  {!isCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className={cn('border-t border-white/8 px-3 py-3', isCollapsed && 'px-2')}>
          {!isCollapsed && profile && (
            <div className="mb-3 rounded-2xl border border-white/8 bg-white/4 px-3 py-3">
              <span className="block truncate text-sm font-medium text-white">
                {profile.full_name}
              </span>
              <span className="text-xs text-orange-200/80">Supervisor</span>
            </div>
          )}

          <button
            onClick={handleSignOut}
            className={cn(
              'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-red-300',
              isCollapsed && 'justify-center px-2'
            )}
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M16 17L21 12L16 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {!isCollapsed && <span>Sair</span>}
          </button>
        </div>

        <div className={cn('border-t border-white/8 px-3 py-2', isCollapsed && 'px-2')}>
          <button
            onClick={onToggleCollapse}
            className={cn(
              'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white',
              isCollapsed && 'justify-center px-2'
            )}
            aria-label={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              fill="none"
              className={cn('transition-transform', isCollapsed && 'rotate-180')}
            >
              <path d="M11 19L4 12L11 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 12H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {!isCollapsed && <span>Recolher</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
