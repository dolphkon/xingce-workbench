import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './features/dashboard/Dashboard'
import MistakesPage from './features/mistakes/MistakesPage'
import MistakeDetail from './features/mistakes/MistakeDetail'
import PracticePage from './features/mistakes/PracticePage'
import KnowledgePage from './features/knowledge/KnowledgePage'
import DocEditor from './features/knowledge/DocEditor'
import MothersPage from './features/mothers/MothersPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/mistakes" element={<MistakesPage />} />
        <Route path="/mistakes/practice" element={<PracticePage />} />
        <Route path="/mistakes/:id" element={<MistakeDetail />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/knowledge/:id" element={<DocEditor />} />
        <Route path="/mothers" element={<MothersPage />} />
        <Route path="*" element={<Dashboard />} />
      </Route>
    </Routes>
  )
}
