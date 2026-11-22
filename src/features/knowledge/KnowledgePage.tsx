import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon } from '../../components/ui'
import { remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { formatDate } from '../../lib/utils'
import type { KnowledgeDoc } from '../../types'

function excerpt(content: string): string {
  return content
    .replace(/[#*`>\[\]()!_~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110)
}

export default function KnowledgePage() {
  const { items, loading, error, refresh } = useCollection('docs')
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('全部')
  const [deleting, setDeleting] = useState<KnowledgeDoc | null>(null)

  const categories = Array.from(new Set(items.map((doc) => doc.category).filter(Boolean)))
  const filtered = items
    .filter((doc) => {
      if (category !== '全部' && doc.category !== category) return false
      if (keyword.trim()) {
        const text = `${doc.title} ${doc.content} ${doc.tags.join(' ')}`.toLowerCase()
        if (!text.includes(keyword.trim().toLowerCase())) return false
      }
      return true
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const handleDelete = async () => {
    if (!deleting) return
    await remove('docs', deleting.id)
    setDeleting(null)
    refresh()
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">知识库</h1>
          <p className="page-subtitle">用 Markdown 沉淀方法与考点，随时检索回顾</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => navigate('/knowledge/new')}>
            <Icon name="plus" size={16} /> 新建文档
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="全文搜索标题、内容、标签…" />
        </div>
        <select className="select" style={{ width: 150 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="全部">全部分类</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <span className="spacer" />
        <span className="small muted">共 {filtered.length} 篇</span>
      </div>

      <div className="card">
        <div className="card-body tight">
          {loading ? (
            <div className="loading">加载中…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="book"
              title={items.length === 0 ? '知识库还是空的' : '没有找到相关文档'}
              description={items.length === 0 ? '新建一篇文档，开始整理你的行测知识体系' : '试试更换关键词或分类'}
              action={items.length === 0 ? (
                <button className="btn btn-primary" onClick={() => navigate('/knowledge/new')}>
                  <Icon name="plus" size={15} /> 新建第一篇文档
                </button>
              ) : undefined}
            />
          ) : (
            <div className="list">
              {filtered.map((doc) => (
                <div className="list-item" key={doc.id} style={{ alignItems: 'flex-start' }}>
                  <span style={{ marginTop: 3, color: 'var(--primary)' }}><Icon name="file" size={19} /></span>
                  <div className="list-item-main" onClick={() => navigate(`/knowledge/${doc.id}`)} style={{ cursor: 'pointer' }}>
                    <div className="item-title">{doc.title || '未命名文档'}</div>
                    <div className="item-excerpt">{excerpt(doc.content) || '暂无内容'}</div>
                    <div className="item-meta">
                      {doc.category && <span className="chip chip-primary"><Icon name="folder" size={11} /> {doc.category}</span>}
                      {doc.tags.slice(0, 3).map((tag) => <span className="chip" key={tag}>#{tag}</span>)}
                      <span className="small light">更新于 {formatDate(doc.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="item-actions">
                    <button className="icon-btn" title="编辑" onClick={() => navigate(`/knowledge/${doc.id}`)}><Icon name="edit" size={16} /></button>
                    <button className="icon-btn danger" title="删除" onClick={() => setDeleting(doc)}><Icon name="trash" size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          message={`确定删除文档「${deleting.title || '未命名文档'}」吗？此操作不可撤销。`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  )
}
