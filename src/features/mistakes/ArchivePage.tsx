import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { put, remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { formatQuestionText, pluralDays } from '../../lib/utils'
import { masteryOf, type Mistake } from '../../types'
import MistakeForm from './MistakeForm'

/** 归档库（原掌握库）：掌握度为「已掌握」的题目，功能与原掌握库一致。 */
export default function ArchivePage() {
  const { items, loading, error, refresh } = useCollection('mistakes')
  const { items: mothers } = useCollection('mothers')
  const [editing, setEditing] = useState<Mistake | null>(null)
  const [deleting, setDeleting] = useState<Mistake | null>(null)

  const archived = useMemo(() => items.filter((i) => masteryOf(i) === 'mastered'), [items])

  const moveBack = async (item: Mistake) => {
    await put('mistakes', { ...item, reviewStatus: 'learning', updatedAt: Date.now() })
    refresh()
  }
  const handleDelete = async () => {
    if (!deleting) return
    await remove('mistakes', deleting.id)
    setDeleting(null)
    refresh()
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">归档库</h1>
          <p className="page-subtitle">沉淀已经吃透的题目；答错后可移回错题库继续复盘</p>
        </div>
        <div className="header-actions">
          <Link className="btn" to="/mistakes"><Icon name="back" size={16} /> 返回错题库</Link>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="card-body tight">
          {loading ? (
            <div className="loading">加载中…</div>
          ) : archived.length === 0 ? (
            <EmptyState
              icon="check"
              title="归档库还是空的"
              description="在错题详情「对答案」模式点击「移入归档库」，或在编辑页把掌握度设为「已掌握」"
              action={<Link className="btn btn-primary" to="/mistakes">返回错题库</Link>}
            />
          ) : (
            <div className="list">
              {archived.map((item) => (
                <div className="list-item" key={item.id}>
                  <div className="list-item-main">
                    <Link to={`/mistakes/${item.id}`} className="item-title" style={{ display: 'block' }}>
                      {formatQuestionText(item.title).replace(/\n/g, ' ')}
                    </Link>
                    <div className="item-meta">
                      <span className="chip chip-success">已掌握</span>
                      <span className="chip chip-primary">{item.type}</span>
                      {item.subType && <span className="chip">{item.subType}</span>}
                      {item.point && <span className="chip chip-warning">考点：{item.point}</span>}
                      {item.images.length > 0 && <span className="chip"><Icon name="image" size={11} /> {item.images.length}</span>}
                      <span className="small light">{pluralDays(item.createdAt)}</span>
                    </div>
                  </div>
                  <div className="item-actions">
                    <button className="btn btn-sm" title="移回错题库" onClick={() => void moveBack(item)}><Icon name="back" size={14} /> 移回</button>
                    <button className="icon-btn" title="编辑" onClick={() => setEditing(item)}><Icon name="edit" size={16} /></button>
                    <button className="icon-btn danger" title="删除" onClick={() => setDeleting(item)}><Icon name="trash" size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <Modal title="编辑归档题目" onClose={() => setEditing(null)} wide>
          <MistakeForm
            initial={editing}
            mothers={mothers}
            onSaved={() => { setEditing(null); refresh() }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          message={`确定彻底删除这道题吗？「${deleting.title.slice(0, 40)}${deleting.title.length > 40 ? '…' : ''}」`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  )
}
