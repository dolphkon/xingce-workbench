import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { QuestionNavigator } from '../../components/QuestionNavigator'
import { getById, readCachedById, remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { formatDate, formatQuestionText } from '../../lib/utils'
import type { Mistake } from '../../types'
import MistakeForm from './MistakeForm'

export default function MistakeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [item, setItem] = useState<Mistake | null>(() => (id ? readCachedById('mistakes', id) ?? null : null))
  const [loading, setLoading] = useState(() => (id ? !readCachedById('mistakes', id) : false))
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // 做题模式：默认隐藏答案与解析，作答或点击后才揭示
  const [revealed, setRevealed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [typedAnswer, setTypedAnswer] = useState('')
  const mothers = useCollection('mothers')
  const { items: allMistakes } = useCollection('mistakes')
  // 仅在当前题型内翻页，顺序与题库列表一致（录入时间倒序）
  const navItems = allMistakes
    .filter((m) => m.type === item?.type)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => ({
      id: m.id,
      label: (formatQuestionText(m.title).replace(/\n/g, ' ').slice(0, 24) || '未命名错题'),
    }))

  const load = useCallback(async () => {
    if (!id) return
    const cached = readCachedById('mistakes', id)
    if (cached) {
      setItem(cached)
      setLoading(false)
    }
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

  // 切换题目时回到做题模式
  useEffect(() => {
    setRevealed(false)
    setSelected(null)
    setTypedAnswer('')
  }, [id])

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
  const normalizeAnswer = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '')
  const correctAnswer = normalizeAnswer(item.answer)
  const userAnswer = selected ? normalizeAnswer(selected) : ''
  const isCorrect = revealed && Boolean(correctAnswer) && userAnswer === correctAnswer
  const submitAnswer = (answer: string) => {
    const value = answer.trim()
    if (!value) return
    setSelected(value.toUpperCase())
    setRevealed(true)
  }
  const resetAttempt = () => {
    setRevealed(false)
    setSelected(null)
    setTypedAnswer('')
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/mistakes" className="small" style={{ color: 'var(--primary)', fontWeight: 600 }}>
            ← 返回错题库
          </Link>
          <h1 className="page-title" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            错题详情
            <span className="chip chip-primary">{item.type}</span>
          </h1>
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
        scopeLabel={item.type}
      />

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">题目</h2>
          <div className="tag-row">
            <span className={`chip ${revealed ? 'chip-success' : 'chip-primary'}`}>{revealed ? '对答案' : '做题模式'}</span>
            <span className="chip chip-primary">{item.type}</span>
            {item.accuracy != null && <span className="chip chip-success">正确率 {item.accuracy}%</span>}
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

          {visibleOptions.length > 0 ? (
            <div className="option-list">
              {visibleOptions.map((option) => {
                const correct = revealed && option.letter === correctAnswer
                const wrong = revealed && selected === option.letter && !correct
                return (
                  <button
                    type="button"
                    key={option.letter}
                    className={`option-item${correct ? ' correct' : ''}${wrong ? ' wrong' : ''}${selected === option.letter && !revealed ? ' selected' : ''}`}
                    disabled={revealed}
                    onClick={() => submitAnswer(option.letter)}
                  >
                    <span className={`option-key${correct ? ' correct' : ''}`}>{option.letter}</span>
                    <span>{option.text}</span>
                    {correct && <span className="chip chip-success" style={{ marginLeft: 'auto' }}>正确答案</span>}
                    {wrong && <span className="chip chip-danger" style={{ marginLeft: 'auto' }}>你的答案</span>}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="form-field" style={{ marginTop: 14, maxWidth: 420 }}>
              <label className="form-label">输入你的答案</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="input"
                  value={typedAnswer}
                  disabled={revealed}
                  placeholder="作答后显示正确答案与解析"
                  onChange={(event) => setTypedAnswer(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') submitAnswer(typedAnswer) }}
                />
                <button className="btn btn-primary" disabled={!typedAnswer.trim() || revealed} onClick={() => submitAnswer(typedAnswer)}>
                  提交答案
                </button>
              </div>
            </div>
          )}

          <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
            {!revealed ? (
              <>
                <button className="btn" onClick={() => setRevealed(true)}><Icon name="book" size={15} /> 查看解析</button>
                <span className="small muted">先作答再核对，效果更好；查看解析会直接显示答案</span>
              </>
            ) : (
              <>
                {selected && (
                  <span className={`chip ${isCorrect ? 'chip-success' : 'chip-danger'}`}>
                    {isCorrect ? '回答正确' : '回答错误'}
                  </span>
                )}
                <span className="small muted">正确答案：{item.answer || '未填写'}</span>
                <button className="btn" onClick={resetAttempt}><Icon name="refresh" size={15} /> 隐藏答案再练</button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">复盘信息</h2>
          {!revealed && <span className="small muted">作答或查看解析后显示</span>}
        </div>
        {revealed ? (
          <div className="card-body">
            <div className="form-row">
              <div>
                <div className="form-label">正确答案</div>
                <div className="answer-block">{item.answer || '未填写'}</div>
              </div>
              <div>
                <div className="form-label">{selected ? '本次作答' : '当时选'}</div>
                <div className={(selected ?? item.userAnswer) && (selected ?? item.userAnswer) !== item.answer ? 'chip chip-danger' : 'chip chip-success'}>
                  {selected ?? item.userAnswer ?? '未填写'}
                </div>
                {selected && item.userAnswer && item.userAnswer !== selected && (
                  <div className="small light" style={{ marginTop: 6 }}>当时选：{item.userAnswer}</div>
                )}
              </div>
            </div>
            <div className="divider" />
            <div className="form-label">解析 / 复盘笔记</div>
            <div className="analysis-block">{item.analysis || '暂无解析，可在编辑中补充'}</div>
          </div>
        ) : (
          <div className="card-body">
            <div className="small muted" style={{ padding: '10px 0' }}>
              为保持做题体验，正确答案与解析已隐藏。完成作答或点击上方「查看解析」即可展开。
            </div>
          </div>
        )}
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
        scopeLabel={item.type}
      />

      {editing && (
        <Modal title="编辑错题" onClose={() => setEditing(false)} wide>
          <MistakeForm
            initial={item}
            mothers={mothers.items}
            onSaved={() => { setEditing(false); resetAttempt(); void load() }}
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
