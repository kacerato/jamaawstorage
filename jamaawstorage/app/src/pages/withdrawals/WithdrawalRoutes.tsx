import { Routes, Route } from 'react-router-dom'
import { WithdrawalsPage } from './WithdrawalsPage'
import { NewWithdrawalPage } from './NewWithdrawalPage'
import { WithdrawalDetailPage } from './WithdrawalDetailPage'
import { EditWithdrawalPage } from './EditWithdrawalPage'

export function WithdrawalRoutes() {
  return (
    <Routes>
      <Route index element={<WithdrawalsPage />} />
      <Route path="new" element={<NewWithdrawalPage />} />
      <Route path=":id" element={<WithdrawalDetailPage />} />
      <Route path=":id/edit" element={<EditWithdrawalPage />} />
    </Routes>
  )
}
