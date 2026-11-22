import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { QuestionNavigator } from '../../components/QuestionNavigator'
import { getById, remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { formatDate, formatQuestionText } from '../../lib/utils'
import type { MotherQuestion } from '../../types'
import MotherForm from './MotherForm'

export default function MotherDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [item, setItem] = useState<MotherQuestion | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { items: allMothers } = useCollection('mothers')
  const { items: mistakes } = useCollection('mistakes')

  // 仅在当前题型内翻页，顺序与题库列表一致（录入时间倒序）
  const navItems = allMothers
    .filter((m) => m.type === item?.type)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => ({
      id: m.id,
      label: (formatQuestionText(m.title).replace(/\n/g, ' ').slice(0, 24) || '未命名母题'),
    }))

  const load = useCallback(async () => {
    if (!id) return
    try {
      const data = await getById('mothers', id)
      setItem(data ?? null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const handleDelete = async () => {
    if (!id) return
    await remove('mothers', id)
    navigate('/mothers')
  }

  if (loading) return <div className="loading">加载中…</div>

  if (!item) {
    return (
      <EmptyState
        icon="alert"
        title="母题不存在或已被删除"
        description="返回母题库继续浏览"
        action={<Link className="btn btn-primary" to="/mothers">返回母题库</Link>}
      />
    )
  }

  const related = mistakes.filter((m) => m.motherId === item.id)

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/mothers" className="small" style={{ color: 'var(--primary)', fontWeight: 600 }}>
            ← 返回母题库
          </Link>
          <h1 className="page-title" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            母题详情
            <span className="chip chip-primary">{item.type}</span>
          </h1>
          <p className="page-subtitle">录入于 {formatDate(item.createdAt)} · 更新于 {formatDate(item.updatedAt)}</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} /> 编辑</button>
          <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setDeleting(true)}>
            <Icon name="trash" size={16} /> 删除
          </button>
        </div>
      </div>

      <QuestionNavigator
        items={navItems}
        currentId={item.id}
        basePath="/mothers"
        compact
        enabled={!editing && !deleting}
        scopeLabel={item.type}
      />

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">母题题干</h2>
          <div className="tag-row">
            <span className="chip chip-primary">{item.type}</span>
            {item.point && <span className="chip chip-warning">考点：{item.point}</span>}
            {item.source && <span className="chip">来源：{item.source}</span>}
          </div>
        </div>
        <div className="card-body">
          <div className="question-text">{formatQuestionText(item.title)}</div>
          {item.tags.length > 0 && (
            <div className="tag-row" style={{ marginTop: 14 }}>
              {item.tags.map((tag) => <span className="chip" key={tag}>#{tag}</span>)}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h2 className="card-title">解题思路</h2></div>
        <div className="card-body">
          <div className="analysis-block" style={{ color: 'var(--text)' }}>
            {item.modelAnswer || '暂无解题思路，可在编辑中补充'}
          </div>
          {item.keyPoints.length > 0 && (
            <>
              <div className="divider" />
              <div className="form-label">关键要点</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13, lineHeight: 1.9 }}>
                {item.keyPoints.map((point, index) => <li key={index}>{point}</li>)}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">关联错题</h2>
          <span className="small muted">共 {related.length} 道</span>
        </div>
        <div className="card-body">
          {related.length > 0 ? (
            <div className="tag-row">
              {related.map((mistake) => (
                <Link key={mistake.id} className="chip chip-primary" to={`/mistakes/${mistake.id}`}>
                  {mistake.title.slice(0, 30)}{mistake.title.length > 30 ? '…' : ''}
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>暂无关联错题，可在错题编辑页选择此母题。</p>
          )}
        </div>
      </div>

      <QuestionNavigator
        items={navItems}
        currentId={item.id}
        basePath="/mothers"
        enabled={!editing && !deleting}
        footer
        scopeLabel={item.type}
      />

      {editing && (
        <Modal title="编辑母题" onClose={() => setEditing(false)} wide>
          <MotherForm
            initial={item}
            onSaved={() => { setEditing(false); void load() }}
            onCancel={() => setEditing(false)}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          message={`确定删除母题「${item.title.slice(0, 40)}${item.title.length > 40 ? '…' : ''}」吗？关联错题不会被删除。`}
          onCancel={() => setDeleting(false)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  )
}
