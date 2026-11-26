import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { remove } from '../../lib/db'
import { readCategories } from '../../lib/categories'
import { useCollection } from '../../lib/hooks'
import { ACCURACY_RANGES, matchesAccuracy, matchesDate, type AccuracyRange, type DateRange } from '../../lib/filters'
import { dateKey, formatQuestionText, pluralDays } from '../../lib/utils'
import { reviewStatusChip, reviewStatusLabel, reviewStatusOf, type Mistake, type QuestionType } from '../../types'
import MistakeForm from './MistakeForm'

export default function MistakesPage() {
  const { items, loading, error, refresh } = useCollection('mistakes')
  const mothers = useCollection('mothers')
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState<QuestionType | '全部'>('全部')
  const [categories] = useState(readCategories)
  const [subType, setSubType] = useState('全部')
  const [days, setDays] = useState<DateRange>('all')
  const [accuracy, setAccuracy] = useState<AccuracyRange>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [editing, setEditing] = useState<Mistake | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Mistake | null>(null)

  // 错题库只显示未掌握的题（已掌握移入掌握库）
  const activeItems = useMemo(() => items.filter((i) => reviewStatusOf(i) !== 'mastered'), [items])
  const masteredCount = useMemo(() => items.filter((i) => reviewStatusOf(i) === 'mastered').length, [items])

  // 仅展示错题库中实际有题的模块（按配置顺序），作为导航 tab
  const moduleTabs = useMemo(() => {
    const present = new Set(activeItems.map((i) => i.type))
    const order: string[] = []
    categories.forEach((c) => { if (present.has(c.name) && !order.includes(c.name)) order.push(c.name) })
    present.forEach((name) => { if (!order.includes(name)) order.push(name) })
    return order
  }, [activeItems, categories])

  // 默认选中「全部」；仅当所选模块被删空时才回退到「全部」
  const activeType: QuestionType | '全部' = type === '全部' || moduleTabs.includes(type)
    ? type
    : '全部'

  const switchModule = (name: QuestionType | '全部') => {
    setType(name)
    setSubType('全部')
  }

  const filtered = activeItems
    .filter((item) => {
      if (reviewStatusOf(item) === 'mastered') return false
      if (activeType !== '全部' && item.type !== activeType) return false
      if (subType !== '全部' && item.subType !== subType) return false
      if (!matchesDate(item.createdAt, days, startDate, endDate)) return false
      if (!matchesAccuracy(item.accuracy, accuracy)) return false
      if (keyword.trim()) {
        const text = `${item.title} ${item.analysis} ${item.answer} ${item.tags.join(' ')} ${item.source ?? ''}`.toLowerCase()
        if (!text.includes(keyword.trim().toLowerCase())) return false
      }
      return true
    })
    .sort((a, b) => b.createdAt - a.createdAt)

  const clearFilters = () => {
    setKeyword('')
    setSubType('全部')
    setDays('all')
    setAccuracy('all')
    setStartDate('')
    setEndDate('')
  }
  const hasFilters = Boolean(keyword.trim()) || subType !== '全部' || days !== 'all' || accuracy !== 'all' || Boolean(startDate) || Boolean(endDate)

  const handleDelete = async () => {
    if (!deleting) return
    await remove('mistakes', deleting.id)
    setDeleting(null)
    refresh()
  }

  const practiceParams = new URLSearchParams({
    days,
    type: activeType,
    subType,
    accuracy,
    start: days === 'custom' ? startDate : '',
    end: days === 'custom' ? endDate : '',
  })
  const practiceHref = `/mistakes/practice?${practiceParams.toString()}`

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">错题库</h1>
          <p className="page-subtitle">沉淀每一道错题，按时间、题型与正确率进行专项突破</p>
        </div>
        <div className="header-actions">
          <Link className="btn" to="/mastered"><Icon name="check" size={16} /> 掌握库{masteredCount > 0 ? ` ${masteredCount}` : ''}</Link>
          <Link className="btn" to={practiceHref}><Icon name="play" size={16} /> 专项刷题</Link>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> 录入错题
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {moduleTabs.length > 0 && (
        <div className="module-tabs" role="tablist" aria-label="按考试模块筛选">
          <button className={`module-tab${activeType === '全部' ? ' active' : ''}`} role="tab" aria-selected={activeType === '全部'} onClick={() => switchModule('全部')}>
            全部
          </button>
          {moduleTabs.map((name) => (
            <button key={name} className={`module-tab${activeType === name ? ' active' : ''}`} role="tab" aria-selected={activeType === name} onClick={() => switchModule(name as QuestionType)}>
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="filter-bar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索题干、解析、标签…" />
        </div>
        <select className="select" style={{ width: 140 }} value={subType} onChange={(e) => setSubType(e.target.value)} title="按题型筛选">
          <option value="全部">全部题型</option>
          {Array.from(new Set([
            ...(activeType === '全部' ? categories.flatMap((c) => c.types) : (categories.find((c) => c.name === activeType)?.types ?? [])),
            ...items.filter((i) => activeType === '全部' || i.type === activeType).map((i) => i.subType ?? '').filter(Boolean),
          ])).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="select" style={{ width: 132 }} value={accuracy} onChange={(e) => setAccuracy(e.target.value as AccuracyRange)} title="按正确率范围筛选（左闭右开，如 30%-50% 含 30% 不含 50%）">
          <option value="all">全部正确率</option>
          {ACCURACY_RANGES.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
        </select>
        <div className="segmented">
          {([['all', '全部时间'], ['7', '近 7 天'], ['30', '近 30 天'], ['custom', '自定义']] as [DateRange, string][]).map(([value, label]) => (
            <button key={value} className={days === value ? 'active' : ''} onClick={() => setDays(value)}>{label}</button>
          ))}
        </div>
        {days === 'custom' && (
          <div className="date-range">
            <input type="date" className="input" value={startDate} max={endDate || dateKey(new Date())} onChange={(e) => setStartDate(e.target.value)} aria-label="开始日期" />
            <span className="small muted">至</span>
            <input type="date" className="input" value={endDate} min={startDate} max={dateKey(new Date())} onChange={(e) => setEndDate(e.target.value)} aria-label="结束日期" />
          </div>
        )}
        <span className="spacer" />
        {hasFilters && <button className="btn btn-sm btn-ghost" onClick={clearFilters}>清除筛选</button>}
        <span className="small muted">共 {filtered.length} 道</span>
      </div>

      <div className="card">
        <div className="card-body tight">
          {loading ? (
            <div className="loading">加载中…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="target"
              title={activeItems.length === 0 ? '错题库还是空的' : '没有符合条件的错题'}
              description={activeItems.length === 0
                ? '上传题目截图用 OCR 识别录入，或直接手动填写'
                : '试试调整搜索词或筛选条件，也可以直接录入一道新错题'}
              action={
                <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {hasFilters && (
                    <button className="btn" onClick={clearFilters}>清除筛选</button>
                  )}
                  <button className="btn btn-primary" onClick={() => setEditing('new')}>
                    <Icon name="plus" size={15} /> {activeItems.length === 0 ? '录入第一道错题' : '录入错题'}
                  </button>
                </div>
              }
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
                      <span className={`chip ${reviewStatusChip(reviewStatusOf(item))}`}>{reviewStatusLabel(reviewStatusOf(item))}</span>
                      <span className="chip chip-primary">{item.type}</span>
                      {item.subType && <span className="chip">{item.subType}</span>}
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
