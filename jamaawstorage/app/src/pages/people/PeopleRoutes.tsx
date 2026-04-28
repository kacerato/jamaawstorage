import { Routes, Route } from 'react-router-dom'
import { PeoplePage } from './PeoplePage'
import { PersonDetailPage } from './PersonDetailPage'

export function PeopleRoutes() {
  return (
    <Routes>
      <Route index element={<PeoplePage />} />
      <Route path=":id" element={<PersonDetailPage />} />
    </Routes>
  )
}
