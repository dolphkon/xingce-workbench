import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { QuestionNavigator } from '../../components/QuestionNavigator'
import { getById, remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { formatDate, formatQuestionText } from '../../lib/utils'
import type { Mistake } from '../../types'
import MistakeForm from './MistakeForm'

export default function MistakeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [item, setItem] = useState<Mistake | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const mothers = useCollection('mothers')
  const { items: allMistakes } = useCollection('mistakes')
  // 与错题库列表保持一致：按录入时间倒序
  const navItems = [...allMistakes]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => ({
      id: m.id,
      label: (formatQuestionText(m.title).replace(/\n/g, ' ').slice(0, 24) || '未命名错题'),
    }))

  const load = useCallback(async () => {
    if (!id) return
    try {
      const data = await getById('mistakes', id)
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
    await remove('mistakes', id)
    navigate('/mistakes')
  }

  if (loading) return <div className="loading">加载中…</div>

  if (!item) {
    return (
      <EmptyState
        icon="alert"
        title="错题不存在或已被删除"
        description="返回错题库继续浏览"
        action={<Link className="btn btn-primary" to="/mistakes">返回错题库</Link>}
      />
    )
  }

  const mother = item.motherId ? mothers.items.find((m) => m.id === item.motherId) : undefined
  const visibleOptions = item.options
    .map((text, index) => ({ text, letter: String.fromCharCode(65 + index) }))
    .filter((option) => option.text.trim())

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/mistakes" className="small" style={{ color: 'var(--primary)', fontWeight: 600 }}>
            ← 返回错题库
          </Link>
          <h1 className="page-title" style={{ marginTop: 6 }}>错题详情</h1>
          <p className="page-subtitle">录入于 {formatDate(item.createdAt)} · 已练习 {item.reviewCount} 次 · 答对 {item.correctCount} 次</p>
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
        basePath="/mistakes"
        compact
        enabled={!editing && !deleting}
      />

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">题目</h2>
          <div className="tag-row">
            <span className="chip chip-primary">{item.type}</span>
            {item.source && <span className="chip chip-warning">来源：{item.source}</span>}
            {item.tags.map((tag) => <span className="chip" key={tag}>#{tag}</span>)}
          </div>
        </div>
        <div className="card-body">
          <div className="question-text">{formatQuestionText(item.title)}</div>

          {item.images.length > 0 && (
            <div className="image-grid" style={{ marginTop: 16 }}>
              {item.images.map((image, index) => (
                <a href={image} target="_blank" rel="noreferrer" key={`${image.slice(0, 40)}-${index}`}>
                  <img src={image} alt={`题目图片 ${index + 1}`} style={{ width: '100%', height: 160, objectFit: 'cover', border: '1px solid var(--border)', borderRadius: 8 }} />
                </a>
              ))}
            </div>
          )}

          {visibleOptions.length > 0 && (
            <div className="option-list">
              {visibleOptions.map((option) => (
                <div className="option-item" key={option.letter} style={{ cursor: 'default' }}>
                  <span className={`option-key${option.letter === item.answer ? ' correct' : ''}`}>{option.letter}</span>
                  <span>{option.text}</span>
                  {option.letter === item.answer && <span className="chip chip-success" style={{ marginLeft: 'auto' }}>正确答案</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h2 className="card-title">复盘信息</h2></div>
        <div className="card-body">
          <div className="form-row">
            <div>
              <div className="form-label">正确答案</div>
              <div className="answer-block">{item.answer || '未填写'}</div>
            </div>
            <div>
              <div className="form-label">我的答案</div>
              <div className={item.userAnswer && item.userAnswer !== item.answer ? 'chip chip-danger' : 'chip chip-success'}>
                {item.userAnswer || '未填写'}
              </div>
            </div>
          </div>
          <div className="divider" />
          <div className="form-label">解析 / 复盘笔记</div>
          <div className="analysis-block">{item.analysis || '暂无解析，可在编辑中补充'}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h2 className="card-title">关联母题</h2></div>
        <div className="card-body">
          {mother ? (
            <Link to="/mothers" className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{mother.title}</div>
                <div className="small muted" style={{ marginTop: 4 }}>考点：{mother.point || '未填写'} · {mother.type}</div>
              </div>
              <Icon name="chevron" size={16} />
            </Link>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>尚未关联母题，可在编辑中选择。</p>
          )}
        </div>
      </div>

      <QuestionNavigator
        items={navItems}
        currentId={item.id}
        basePath="/mistakes"
        enabled={!editing && !deleting}
        footer
      />

      {editing && (
        <Modal title="编辑错题" onClose={() => setEditing(false)} wide>
          <MistakeForm
            initial={item}
            mothers={mothers.items}
            onSaved={() => { setEditing(false); void load() }}
            onCancel={() => setEditing(false)}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          message="确定删除这道错题吗？此操作不可撤销。"
          onCancel={() => setDeleting(false)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  )
}
