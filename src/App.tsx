import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ensureCategories } from './lib/categories'
import Layout from './components/Layout'
import Dashboard from './features/dashboard/Dashboard'
import MistakesPage from './features/mistakes/MistakesPage'
import MistakeDetail from './features/mistakes/MistakeDetail'
import MasteredPage from './features/mistakes/MasteredPage'
import PracticePage from './features/mistakes/PracticePage'
import OnlinePracticePage from './features/paper/OnlinePracticePage'
import KnowledgePage from './features/knowledge/KnowledgePage'
import DocEditor from './features/knowledge/DocEditor'
import MothersPage from './features/mothers/MothersPage'
import MotherDetail from './features/mothers/MotherDetail'
import PlansPage from './features/plans/PlansPage'

export default function App() {
  useEffect(() => {
    void ensureCategories()
  }, [])
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/mistakes" element={<MistakesPage />} />
        <Route path="/mastered" element={<MasteredPage />} />
        <Route path="/mistakes/practice" element={<PracticePage />} />
        <Route path="/online-practice" element={<OnlinePracticePage />} />
        <Route path="/mistakes/:id" element={<MistakeDetail />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/knowledge/:id" element={<DocEditor />} />
        <Route path="/mothers" element={<MothersPage />} />
        <Route path="/mothers/:id" element={<MotherDetail />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="*" element={<Dashboard />} />
      </Route>
    </Routes>
  )
}
