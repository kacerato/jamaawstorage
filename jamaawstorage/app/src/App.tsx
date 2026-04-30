import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { AppLayout, ProtectedRoute } from './components/layout'
import { LoginPage } from './pages/auth'
import { DashboardPage } from './pages/dashboard'
import { StockPage } from './pages/stock'
import { PeoplePage } from './pages/people'
import { WithdrawalRoutes } from './pages/withdrawals'
import { KitsPage } from './pages/kits'
import { WorksitesPage } from './pages/worksites'
import { ReportsPage } from './pages/reports'
import { AuditPage } from './pages/audit'
import { SupervisorsPage } from './pages/supervisors'
import { ProfilePage } from './pages/profile'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/stock" element={<StockPage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/withdrawals/*" element={<WithdrawalRoutes />} />
            <Route path="/kits" element={<KitsPage />} />
            <Route path="/worksites" element={<WorksitesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
<Route path="/audit" element={<AuditPage />} />
          <Route path="/supervisors" element={<SupervisorsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
      </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
