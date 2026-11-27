import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { QuestionNavigator } from '../../components/QuestionNavigator'
import QuestionImages from '../../components/QuestionImages'
import QuestionStem from '../../components/QuestionStem'
import { getById, put, readCachedById, remove } from '../../lib/db'
import { relatedMothers } from '../../lib/categories'
import { useCollection } from '../../lib/hooks'
import { formatDate, formatQuestionText } from '../../lib/utils'
import { reviewStatusOf, type Mistake } from '../../types'
import MistakeForm from './MistakeForm'

export default function MistakeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loadedItem, setLoadedItem] = useState<Mistake | null>(() => (id ? readCachedById('mistakes', id) ?? null : null))
  // 路由切换时先用缓存中的当前题目渲染，避免短暂显示上一题
  const item = loadedItem?.id === id
    ? loadedItem
    : id ? readCachedById('mistakes', id) ?? null : null
  const [loading, setLoading] = useState(() => (id ? !readCachedById('mistakes', id) : false))
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // 做题模式：默认隐藏答案与解析，作答或点击后才揭示。
  // 状态与题目 id 绑定，切换题目时同步回到做题模式，避免闪现上一题答案。
  const [attempt, setAttempt] = useState<{
    id: string
    revealed: boolean
    selected: string | null
    typedAnswer: string
  }>(() => ({ id: id ?? '', revealed: false, selected: null, typedAnswer: '' }))
  const active = attempt.id === (id ?? '')
    ? attempt
    : { id: id ?? '', revealed: false, selected: null, typedAnswer: '' }
  const setActive = (patch: Partial<typeof active>) => setAttempt({ ...active, ...patch })
  const revealed = active.revealed
  const selected = active.selected
  const typedAnswer = active.typedAnswer
  const mothers = useCollection('mothers')
  const { items: allMistakes } = useCollection('mistakes')
  // 仅在当前题型内翻页，顺序与题库列表一致（录入时间倒序）
  const navItems = allMistakes
    .filter((m) => m.type === item?.type && reviewStatusOf(m) !== 'mastered')
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => ({
      id: m.id,
      label: (formatQuestionText(m.title).replace(/\n/g, ' ').slice(0, 24) || '未命名错题'),
    }))

  const load = useCallback(async () => {
    if (!id) return
    const cached = readCachedById('mistakes', id)
    if (cached) {
      setLoadedItem(cached)
      setLoading(false)
    }
    try {
      const data = await getById('mistakes', id)
      setLoadedItem(data ?? null)
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

  // 移入掌握库：写入状态后刷新缓存并回到错题库（该题不再显示）
  const handleMaster = async () => {
    if (!item) return
    await put('mistakes', { ...item, reviewStatus: 'mastered', updatedAt: Date.now() })
    navigate('/mistakes')
  }
  const isMastered = reviewStatusOf(item ?? {}) === 'mastered'

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

  const relatedMothersList = relatedMothers(item, mothers.items)
  const visibleOptions = item.options
    .map((text, index) => ({ text, letter: String.fromCharCode(65 + index) }))
    .filter((option) => option.text.trim())
  const normalizeAnswer = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '')
  const correctAnswer = normalizeAnswer(item.answer)
  const userAnswer = selected ? normalizeAnswer(selected) : ''
  const isCorrect = revealed && Boolean(correctAnswer) && userAnswer === correctAnswer
  const submitAnswer = async (answer: string) => {
    const value = answer.trim()
    if (!value || revealed) return
    const chosen = value.toUpperCase()
    const correct = normalizeAnswer(chosen) === correctAnswer
    setActive({ selected: chosen, revealed: true })
    // 与专项刷题一致：每次真实作答累计一次练习记录
    const next = { ...item, reviewCount: item.reviewCount + 1, correctCount: item.correctCount + (correct ? 1 : 0), lastReviewedAt: Date.now(), updatedAt: Date.now() }
    // 掌握库里答错：自动移回错题库继续复盘
    if (isMastered && !correct) next.reviewStatus = 'reviewed'
    await put('mistakes', next)
    setLoadedItem(next)
  }
  const resetAttempt = () => {
    setActive({ revealed: false, selected: null, typedAnswer: '' })
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
          <p className="page-subtitle">
            录入于 {formatDate(item.createdAt)}
            {revealed && ` · 已练习 ${item.reviewCount} 次 · 答对 ${item.correctCount} 次`}
          </p>
        </div>
        <div className="header-actions">
          {revealed && !isMastered && (
            <button className="btn" onClick={() => void handleMaster()} title="移入掌握库后不再显示在错题库">
              <Icon name="check" size={16} /> 移入已掌握库
            </button>
          )}
          {isMastered && (
            <span className="chip chip-success">已掌握 · 在掌握库中</span>
          )}
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
            {item.subType && <span className="chip">{item.subType}</span>}
            {item.point && <span className="chip chip-warning">考点：{item.point}</span>}
            {revealed && item.accuracy != null && <span className="chip chip-success">正确率 {item.accuracy}%</span>}
            {item.source && <span className="chip chip-warning">来源：{item.source}</span>}
            {item.tags.map((tag) => <span className="chip" key={tag}>#{tag}</span>)}
          </div>
        </div>
        <div className="card-body">
          <QuestionStem text={item.title} answer={item.answer} />

          <QuestionImages images={item.images} altPrefix="题目图片" className="question-images-section" />

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
                  onChange={(event) => setActive({ typedAnswer: event.target.value })}
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
                <button className="btn btn-primary" onClick={() => setActive({ revealed: true })}>
                  <Icon name="book" size={15} /> 查看答案
                </button>
                <span className="small muted">先作答再核对，效果更好；查看答案会同时展开答案、解析与正确率</span>
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
          {!revealed && <span className="small muted">作答或查看答案后显示</span>}
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
            <div className="form-row">
              <div>
                <div className="form-label">正确率</div>
                <div className="chip chip-success">{item.accuracy != null ? `${item.accuracy}%` : '未设置'}</div>
              </div>
              <div>
                <div className="form-label">练习记录</div>
                <div className="small">已练习 {item.reviewCount} 次 · 答对 {item.correctCount} 次{item.lastReviewedAt ? ` · 最近 ${formatDate(item.lastReviewedAt)}` : ''}</div>
              </div>
            </div>
            <div className="divider" />
            <div className="form-label">解析 / 复盘笔记</div>
            <div className="analysis-block">{item.analysis || '暂无解析，可在编辑中补充'}</div>
          </div>
        ) : (
          <div className="card-body">
            <div className="small muted" style={{ padding: '10px 0' }}>
              为保持做题体验，答案、解析与正确率已隐藏。完成作答或点击上方「查看答案」即可展开。
            </div>
          </div>
        )}
      </div>

      {relatedMothersList.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">关联母题</h2>
            {item.point && <span className="chip chip-warning">考点：{item.point}</span>}
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {relatedMothersList.map((m) => (
                <Link key={m.id} to={`/mothers/${m.id}`} className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{formatQuestionText(m.title).split('\n')[0].slice(0, 40)}</div>
                    <div className="small muted" style={{ marginTop: 4 }}>考点：{m.point || '未填写'} · {m.type}{m.subType ? ` · ${m.subType}` : ''}</div>
                  </div>
                  <Icon name="chevron" size={16} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

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
