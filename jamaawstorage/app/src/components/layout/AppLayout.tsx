import { useCallback, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useNotifications } from '../../hooks/useNotifications'
import { cn } from '../../lib/utils'

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const {
    notifications,
    lowStockItems,
    unreadCount,
    markAllAsRead,
  } = useNotifications()

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev)
  }, [])

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false)
  }, [])

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => !prev)
  }, [])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.10),_transparent_32%),linear-gradient(180deg,_#0a0a0a_0%,_#111827_100%)] text-white">
      <Sidebar
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onClose={closeSidebar}
        onToggleCollapse={toggleSidebarCollapsed}
      />

      <div
        className={cn(
          'transition-[padding] duration-300 ease-out',
          sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64'
        )}
      >
        <Header
          onToggleSidebar={toggleSidebar}
          unreadCount={unreadCount}
          lowStockCount={lowStockItems.length}
          notifications={notifications}
          onNotificationsOpen={markAllAsRead}
        />

        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
