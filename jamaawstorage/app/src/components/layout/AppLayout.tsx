import { useState, useCallback } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useNotifications } from '../../hooks/useNotifications'

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { notifications, lowStockItems } = useNotifications()

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev)
  }, [])

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false)
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />

      <div className="lg:pl-64">
        <Header
          onToggleSidebar={toggleSidebar}
          lowStockCount={lowStockItems.length}
          notifications={notifications}
        />

        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
