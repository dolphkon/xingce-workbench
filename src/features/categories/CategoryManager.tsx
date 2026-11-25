import { useEffect, useState } from 'react'
import { ConfirmDialog, Icon, Modal } from '../../components/ui'
import { deleteCategory, readCategories, saveCategory } from '../../lib/categories'
import { SYNC_EVENT } from '../../lib/sync'
import { uid } from '../../lib/utils'
import type { QuestionCategory } from '../../types'

interface Props {
  onClose: () => void
}

interface Draft extends QuestionCategory {
  newType: string
  newPoint: string
  selectedType: string
  open: boolean
}

function toDraft(c: QuestionCategory, open = false): Draft {
  return {
    ...c,
    types: [...c.types],
    points: [...c.points],
    typePoints: c.typePoints ? { ...c.typePoints } : undefined,
    newType: '',
    newPoint: '',
    selectedType: '',
    open,
  }
}

/** 管理模块 / 题型 / 考点的增删。改动即时保存并随同步链路跨设备生效。 */
export default function CategoryManager({ onClose }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>(() => readCategories().map((c) => toDraft(c)))
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onSync = () => setDrafts(readCategories().map((c) => toDraft(c)))
    window.addEventListener(SYNC_EVENT, onSync)
    return () => window.removeEventListener(SYNC_EVENT, onSync)
  }, [])

  const patch = (id: string, fn: (d: Draft) => Draft) => setDrafts((prev) => prev.map((d) => (d.id === id ? fn(d) : d)))

  const persist = (d: Draft) => {
    const { newType: _t, newPoint: _p, selectedType: _s, open: _o, ...category } = d
    void saveCategory({ ...category, name: category.name.trim() || '未命名模块' })
  }

  const handleName = (id: string, name: string) => {
    patch(id, (d) => ({ ...d, name }))
    const d = drafts.find((x) => x.id === id)
    if (d) persist({ ...d, name })
  }

  const addType = (id: string) => {
    const d = drafts.find((x) => x.id === id)
    if (!d || !d.newType.trim()) return
    const value = d.newType.trim()
    if (d.types.includes(value)) return patch(id, (x) => ({ ...x, newType: '' }))
    const next = { ...d, types: [...d.types, value], newType: '' }
    patch(id, () => next)
    persist(next)
  }

  const removeType = (id: string, type: string) => {
    const d = drafts.find((x) => x.id === id)
    if (!d) return
    const typePoints = { ...(d.typePoints ?? {}) }
    delete typePoints[type]
    const next = { ...d, types: d.types.filter((t) => t !== type), typePoints, selectedType: d.selectedType === type ? '' : d.selectedType }
    patch(id, () => next)
    persist(next)
  }

  const addPoint = (id: string) => {
    const d = drafts.find((x) => x.id === id)
    if (!d || !d.newPoint.trim()) return
    const value = d.newPoint.trim()
    if (d.points.includes(value)) return patch(id, (x) => ({ ...x, newPoint: '' }))
    const next = { ...d, points: [...d.points, value], newPoint: '' }
    patch(id, () => next)
    persist(next)
  }

  const removePoint = (id: string, point: string) => {
    const d = drafts.find((x) => x.id === id)
    if (!d) return
    const typePoints: Record<string, string[]> = {}
    Object.entries(d.typePoints ?? {}).forEach(([type, points]) => {
      typePoints[type] = points.filter((p) => p !== point)
    })
    const next = { ...d, points: d.points.filter((p) => p !== point), typePoints }
    patch(id, () => next)
    persist(next)
  }

  /** 设置某题型的专属考点；传 undefined 表示恢复为「全部模块考点」 */
  const setTypePoints = (id: string, type: string, points?: string[]) => {
    const d = drafts.find((x) => x.id === id)
    if (!d) return
    const typePoints = { ...(d.typePoints ?? {}) }
    if (points === undefined) delete typePoints[type]
    else typePoints[type] = points
    const next = { ...d, typePoints }
    patch(id, () => next)
    persist(next)
  }

  /** 在「全部模块考点」与「部分考点」间切换某个考点 */
  const toggleTypePoint = (id: string, type: string, point: string) => {
    const d = drafts.find((x) => x.id === id)
    if (!d) return
    const mapped = d.typePoints?.[type]
    const base = mapped ?? d.points
    const points = base.includes(point) ? base.filter((p) => p !== point) : [...base, point]
    setTypePoints(id, type, points)
  }

  const addCategory = () => {
    const now = Date.now()
    const c: QuestionCategory = { id: uid(), name: '新模块', types: [], points: [], createdAt: now, updatedAt: now }
    const next = toDraft(c, true)
    setDrafts((prev) => [...prev, next])
    void saveCategory(c)
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setBusy(true)
    try {
      await deleteCategory(confirmDelete)
      setDrafts((prev) => prev.filter((d) => d.id !== confirmDelete))
    } finally {
      setBusy(false)
      setConfirmDelete(null)
    }
  }

  return (
    <>
      <Modal
        title="管理考试模块 · 题型 · 考点"
        onClose={onClose}
        wide
        footer={<button className="btn btn-primary" onClick={onClose}>完成</button>}
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          按公考模块组织题库：模块下维护题型与考点，并可指定每个题型可用的考点。错题开启「关联母题」后选择考点，<strong>同考点的错题与母题会自动关联</strong>。改动实时保存并同步到其他设备。
        </p>

        <div className="category-manager">
          {drafts.length === 0 && <p className="small muted">暂无模块，点击下方按钮添加。</p>}
          {drafts.map((d) => (
            <div className="category-block" key={d.id}>
              <div className="category-head">
                <button className="icon-btn" onClick={() => patch(d.id, (x) => ({ ...x, open: !x.open }))} title={d.open ? '收起' : '展开'}>
                  <Icon name="chevron" size={16} style={{ transform: d.open ? 'rotate(90deg)' : undefined }} />
                </button>
                <input className="input" value={d.name} onChange={(e) => handleName(d.id, e.target.value)} style={{ flex: 1, fontWeight: 600 }} aria-label="模块名称" />
                <span className="small light">{d.types.length} 题型 · {d.points.length} 考点</span>
                <button className="icon-btn danger" onClick={() => setConfirmDelete(d.id)} title="删除模块"><Icon name="trash" size={15} /></button>
              </div>

              {d.open && (
                <div className="category-body">
                  <div className="category-col">
                    <div className="form-label" style={{ marginBottom: 6 }}>题型</div>
                    <div className="tag-row" style={{ marginBottom: 8 }}>
                      {d.types.map((t) => (
                        <span className="chip chip-closable" key={t} onClick={() => removeType(d.id, t)} title="点击删除">{t} <Icon name="x" size={11} /></span>
                      ))}
                      {d.types.length === 0 && <span className="small light">暂无题型</span>}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <input className="input" value={d.newType} onChange={(e) => patch(d.id, (x) => ({ ...x, newType: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') addType(d.id) }} placeholder="新增题型，如：片段阅读" />
                      <button className="btn btn-sm" onClick={() => addType(d.id)}><Icon name="plus" size={13} /></button>
                    </div>
                  </div>
                  <div className="category-col">
                    <div className="form-label" style={{ marginBottom: 6 }}>考点</div>
                    <div className="tag-row" style={{ marginBottom: 8 }}>
                      {d.points.map((p) => (
                        <span className="chip chip-warning chip-closable" key={p} onClick={() => removePoint(d.id, p)} title="点击删除">{p} <Icon name="x" size={11} /></span>
                      ))}
                      {d.points.length === 0 && <span className="small light">暂无考点</span>}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <input className="input" value={d.newPoint} onChange={(e) => patch(d.id, (x) => ({ ...x, newPoint: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') addPoint(d.id) }} placeholder="新增考点，如：主旨概括" />
                      <button className="btn btn-sm" onClick={() => addPoint(d.id)}><Icon name="plus" size={13} /></button>
                    </div>
                  </div>
                  <div className="category-type-points">
                    <div className="form-label" style={{ marginBottom: 6 }}>题型对应考点</div>
                    <select
                      className="select"
                      value={d.selectedType}
                      onChange={(e) => patch(d.id, (x) => ({ ...x, selectedType: e.target.value }))}
                    >
                      <option value="">选择题型后配置可用考点…</option>
                      {d.types.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {d.selectedType && (
                      <div className="tag-row" style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          className={`chip${d.typePoints?.[d.selectedType] ? '' : ' chip-primary'}`}
                          onClick={() => setTypePoints(d.id, d.selectedType, undefined)}
                          title="该题型可选题目模块下的全部考点"
                        >全部模块考点</button>
                        {d.points.map((p) => {
                          const mapped = d.typePoints?.[d.selectedType]
                          const active = !mapped || mapped.includes(p)
                          return (
                            <button
                              type="button"
                              key={p}
                              className={`chip${active ? ' chip-warning' : ''}`}
                              onClick={() => toggleTypePoint(d.id, d.selectedType, p)}
                              title={active ? '点击取消该题型下的此考点' : '点击为此题型添加此考点'}
                            >{p}</button>
                          )
                        })}
                        {d.points.length === 0 && <span className="small light">暂无考点</span>}
                      </div>
                    )}
                    <span className="form-hint" style={{ marginTop: 6 }}>
                      错题开启「关联母题」后，仅能选择对应题型下已勾选的考点；默认“全部模块考点”。
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <button className="btn" onClick={addCategory} style={{ marginTop: 12 }}><Icon name="plus" size={15} /> 添加模块</button>
      </Modal>

      {confirmDelete && (
        <ConfirmDialog
          message="确定删除该模块吗？已录入题目不会删除，但其模块/题型/考点标记会保留为自由文本。"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void doDelete()}
        />
      )}
      {busy && <div className="loading" style={{ padding: 8 }}>处理中…</div>}
    </>
  )
}
