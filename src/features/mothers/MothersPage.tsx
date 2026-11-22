import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { QUESTION_TYPES, type MotherQuestion, type QuestionType } from '../../types'
import MotherForm from './MotherForm'

export default function MothersPage() {
  const { items, loading, error, refresh } = useCollection('mothers')
  const mistakes = useCollection('mistakes')
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState<QuestionType | '全部'>('全部')
  const [editing, setEditing] = useState<MotherQuestion | 'new' | null>(null)
  const [deleting, setDeleting] = useState<MotherQuestion | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = items
    .filter((item) => {
      if (type !== '全部' && item.type !== type) return false
      if (keyword.trim()) {
        const text = `${item.title} ${item.point} ${item.modelAnswer} ${item.keyPoints.join(' ')} ${item.tags.join(' ')}`.toLowerCase()
        if (!text.includes(keyword.trim().toLowerCase())) return false
      }
      return true
    })
    .sort((a, b) => b.createdAt - a.createdAt)

  const handleDelete = async () => {
    if (!deleting) return
    await remove('mothers', deleting.id)
    setDeleting(null)
    refresh()
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">母题库</h1>
          <p className="page-subtitle">一类题一个母题，沉淀可复用的解题模型</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> 录入母题
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索题干、考点、解法…" />
        </div>
        <select className="select" style={{ width: 140 }} value={type} onChange={(e) => setType(e.target.value as QuestionType | '全部')}>
          <option value="全部">全部题型</option>
          {QUESTION_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <span className="spacer" />
        <span className="small muted">共 {filtered.length} 个母题</span>
      </div>

      <div className="card">
        <div className="card-body tight">
          {loading ? (
            <div className="loading">加载中…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="layers"
              title={items.length === 0 ? '母题库还是空的' : '没有匹配的母题'}
              description={items.length === 0 ? '把高频题型提炼成母题，以后遇到同类题就能快速套用' : '试试更换关键词或题型'}
              action={items.length === 0 ? (
                <button className="btn btn-primary" onClick={() => setEditing('new')}>
                  <Icon name="plus" size={15} /> 录入第一个母题
                </button>
              ) : undefined}
            />
          ) : (
            <div className="list">
              {filtered.map((item) => {
                const related = mistakes.items.filter((m) => m.motherId === item.id)
                const isOpen = expanded === item.id
                return (
                  <div key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="list-item" style={{ borderBottom: 'none' }}>
                      <button className="icon-btn" onClick={() => setExpanded(isOpen ? null : item.id)} title={isOpen ? '收起' : '展开'}>
                        <Icon name="chevron" size={16} style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} />
                      </button>
                      <div className="list-item-main" onClick={() => setExpanded(isOpen ? null : item.id)} style={{ cursor: 'pointer' }}>
                        <div className="item-title">{item.title}</div>
                        <div className="item-meta">
                          <span className="chip chip-primary">{item.type}</span>
                          {item.point && <span className="chip chip-warning">{item.point}</span>}
                          {related.length > 0 && <span className="chip chip-success">关联 {related.length} 道错题</span>}
                          {item.tags.slice(0, 3).map((tag) => <span className="chip" key={tag}>#{tag}</span>)}
                        </div>
                      </div>
                      <div className="item-actions">
                        <button className="icon-btn" title="编辑" onClick={() => setEditing(item)}><Icon name="edit" size={16} /></button>
                        <button className="icon-btn danger" title="删除" onClick={() => setDeleting(item)}><Icon name="trash" size={16} /></button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="expand-panel">
                        <div className="form-label">解题思路</div>
                        <div className="analysis-block" style={{ color: 'var(--text)' }}>
                          {item.modelAnswer || '暂无解题思路'}
                        </div>
                        {item.keyPoints.length > 0 && (
                          <>
                            <div className="form-label" style={{ marginTop: 14 }}>关键要点</div>
                            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                              {item.keyPoints.map((point, index) => <li key={index} style={{ margin: '3px 0' }}>{point}</li>)}
                            </ul>
                          </>
                        )}
                        <div className="form-label" style={{ marginTop: 14 }}>关联错题</div>
                        {related.length > 0 ? (
                          <div className="tag-row">
                            {related.map((mistake) => (
                              <Link key={mistake.id} className="chip chip-primary" to={`/mistakes/${mistake.id}`}>
                                {mistake.title.slice(0, 28)}{mistake.title.length > 28 ? '…' : ''}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <p className="small light" style={{ margin: 0 }}>
                            暂无关联错题，可在错题编辑页选择此母题。
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <Modal title={editing === 'new' ? '录入母题' : '编辑母题'} onClose={() => setEditing(null)} wide>
          <MotherForm
            initial={editing === 'new' ? undefined : editing}
            onSaved={() => { setEditing(null); refresh() }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          message={`确定删除母题「${deleting.title.slice(0, 40)}${deleting.title.length > 40 ? '…' : ''}」吗？关联错题不会被删除。`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  )
}
