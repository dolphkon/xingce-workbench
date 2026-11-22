import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { formatQuestionText, pluralDays } from '../../lib/utils'
import { QUESTION_TYPES, type Mistake, type QuestionType } from '../../types'
import MistakeForm from './MistakeForm'

type DaysFilter = '全部' | '7' | '30'

export default function MistakesPage() {
  const { items, loading, error, refresh } = useCollection('mistakes')
  const mothers = useCollection('mothers')
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState<QuestionType | '全部'>('全部')
  const [days, setDays] = useState<DaysFilter>('全部')
  const [editing, setEditing] = useState<Mistake | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Mistake | null>(null)

  const cutoff = days === '全部' ? 0 : Date.now() - Number(days) * 86_400_000
  const filtered = items
    .filter((item) => {
      if (type !== '全部' && item.type !== type) return false
      if (days !== '全部' && item.createdAt < cutoff) return false
      if (keyword.trim()) {
        const text = `${item.title} ${item.analysis} ${item.answer} ${item.tags.join(' ')} ${item.source ?? ''}`.toLowerCase()
        if (!text.includes(keyword.trim().toLowerCase())) return false
      }
      return true
    })
    .sort((a, b) => b.createdAt - a.createdAt)

  const handleDelete = async () => {
    if (!deleting) return
    await remove('mistakes', deleting.id)
    setDeleting(null)
    refresh()
  }

  const practiceHref = `/mistakes/practice?days=${days === '全部' ? 'all' : days}&type=${encodeURIComponent(type)}`

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">错题库</h1>
          <p className="page-subtitle">沉淀每一道错题，按时间与题型进行专项突破</p>
        </div>
        <div className="header-actions">
          <Link className="btn" to={practiceHref}><Icon name="play" size={16} /> 专项刷题</Link>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> 录入错题
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索题干、解析、标签…" />
        </div>
        <select className="select" style={{ width: 140 }} value={type} onChange={(e) => setType(e.target.value as QuestionType | '全部')}>
          <option value="全部">全部题型</option>
          {QUESTION_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <div className="segmented">
          {(['全部', '7', '30'] as DaysFilter[]).map((value) => (
            <button key={value} className={days === value ? 'active' : ''} onClick={() => setDays(value)}>
              {value === '全部' ? '全部时间' : `近 ${value} 天`}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="small muted">共 {filtered.length} 道</span>
      </div>

      <div className="card">
        <div className="card-body tight">
          {loading ? (
            <div className="loading">加载中…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="target"
              title={items.length === 0 ? '错题库还是空的' : '没有符合条件的错题'}
              description={items.length === 0 ? '上传题目截图用 OCR 识别录入，或直接手动填写' : '试试调整搜索词或筛选条件'}
              action={items.length === 0 ? (
                <button className="btn btn-primary" onClick={() => setEditing('new')}>
                  <Icon name="plus" size={15} /> 录入第一道错题
                </button>
              ) : undefined}
            />
          ) : (
            <div className="list">
              {filtered.map((item) => (
                <div className="list-item" key={item.id}>
                  <div className="list-item-main">
                    <Link to={`/mistakes/${item.id}`} className="item-title" style={{ display: 'block' }}>
                      {formatQuestionText(item.title).replace(/\n/g, ' ')}
                    </Link>
                    <div className="item-meta">
                      <span className="chip chip-primary">{item.type}</span>
                      {item.accuracy != null && <span className="chip chip-success">正确率 {item.accuracy}%</span>}
                      {item.source && <span className="chip chip-warning">来源：{item.source}</span>}
                      {item.answer && <span className="chip chip-success">答案 {item.answer}</span>}
                      {item.userAnswer && item.userAnswer !== item.answer && (
                        <span className="chip chip-danger">当时选 {item.userAnswer}</span>
                      )}
                      {item.images.length > 0 && <span className="chip"><Icon name="image" size={11} /> {item.images.length}</span>}
                      {item.reviewCount > 0 && <span className="chip">已练 {item.reviewCount} 次</span>}
                      <span className="small light">{pluralDays(item.createdAt)}</span>
                      {item.tags.slice(0, 3).map((tag) => <span className="chip" key={tag}>#{tag}</span>)}
                    </div>
                  </div>
                  <div className="item-actions">
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
        <Modal title={editing === 'new' ? '录入错题' : '编辑错题'} onClose={() => setEditing(null)} wide>
          <MistakeForm
            initial={editing === 'new' ? undefined : editing}
            mothers={mothers.items}
            onSaved={() => { setEditing(null); refresh() }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          message={`确定删除这道错题吗？「${deleting.title.slice(0, 40)}${deleting.title.length > 40 ? '…' : ''}」`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  )
}
