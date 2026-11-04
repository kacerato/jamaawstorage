import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { AppLayout, ProtectedRoute } from './components/layout'
import { LoginPage } from './pages/auth'
import { DashboardPage } from './pages/dashboard'
import { StockPage } from './pages/stock'
import { PeopleRoutes } from './pages/people'
import { WithdrawalRoutes } from './pages/withdrawals'
import { ReturnRoutes } from './pages/returns'
import { ReportsPage } from './pages/reports'
import { AuditPage } from './pages/audit'
import { SupervisorsPage } from './pages/supervisors'
import { ProfilePage } from './pages/profile'
import { VehiclesPage } from './pages/vehicles'

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
            <Route path="/people/*" element={<PeopleRoutes />} />
            <Route path="/withdrawals/*" element={<WithdrawalRoutes />} />
            <Route path="/returns/*" element={<ReturnRoutes />} />
            <Route path="/kits" element={<Navigate to="/stock?tab=kits" replace />} />
            <Route path="/worksites" element={<Navigate to="/withdrawals/new" replace />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/vehicles" element={<VehiclesPage />} />
            {/* Auditoria e contas sao do administrador. A RLS corta os dados
                de qualquer forma; o guard evita montar a pagina vazia. */}
            <Route
              path="/audit"
              element={
                <ProtectedRoute requireAdmin>
                  <AuditPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/supervisors"
              element={
                <ProtectedRoute requireAdmin>
                  <SupervisorsPage />
                </ProtectedRoute>
              }
            />
            <Route path="/profile" element={<ProfilePage />} />
      </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
