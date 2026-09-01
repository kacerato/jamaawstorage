import { Routes, Route } from 'react-router-dom'
import { ReturnsPage } from './ReturnsPage'
import { NewReturnPage } from './NewReturnPage'
import { ReturnDetailPage } from './ReturnDetailPage'

export function ReturnRoutes() {
  return (
    <Routes>
      <Route index element={<ReturnsPage />} />
      <Route path="new" element={<NewReturnPage />} />
      <Route path=":id" element={<ReturnDetailPage />} />
    </Routes>
  )
}
