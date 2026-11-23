import { useMemo } from 'react'
import { Icon } from '../../components/ui'
import type { QuestionCategory } from '../../types'

interface Props {
  categories: QuestionCategory[]
  /** 模块名（存入 type 字段，兼容旧数据） */
  type: string
  /** 模块 id */
  categoryId?: string
  subType: string
  point: string
  onChange: (patch: { type: string; categoryId?: string; subType: string; point: string }) => void
  onManage?: () => void
}

/**
 * 模块 → 题型 → 考点 三级级联选择。
 * 考点可自由输入（兼容旧数据与自定义考点），题型/考点下拉随模块联动。
 */
export default function CategoryFields({ categories, type, categoryId, subType, point, onChange, onManage }: Props) {
  const current = useMemo(() => {
    const byId = categoryId ? categories.find((c) => c.id === categoryId) : undefined
    const byName = categories.find((c) => c.name === type)
    return byId ?? byName
  }, [categories, categoryId, type])

  const moduleName = current?.name ?? type

  const handleModule = (name: string) => {
    const cat = categories.find((c) => c.name === name)
    onChange({ type: name, categoryId: cat?.id, subType: '', point: '' })
  }

  return (
    <>
      <div className="form-field">
        <label className="form-label">考试模块</label>
        <div className="row" style={{ gap: 6 }}>
          <select className="select" value={moduleName} onChange={(e) => handleModule(e.target.value)} style={{ flex: 1 }}>
            {!categories.some((c) => c.name === moduleName) && moduleName && <option value={moduleName}>{moduleName}</option>}
            {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          {onManage && (
            <button type="button" className="btn btn-sm" onClick={onManage} title="添加/删除模块、题型、考点" style={{ flex: '0 0 auto' }}>
              <Icon name="settings" size={14} /> 管理
            </button>
          )}
        </div>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">题型</label>
          <input
            className="input"
            data-field="subtype"
            list="cat-types-list"
            value={subType ?? ''}
            onChange={(e) => onChange({ type: moduleName, categoryId: current?.id, subType: e.target.value, point })}
            placeholder="选择或输入题型"
          />
          <datalist id="cat-types-list">
            {(current?.types ?? []).map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="form-field">
          <label className="form-label">考点 <span className="small light">（母题据此关联）</span></label>
          <input
            className="input"
            data-field="point"
            list="cat-points-list"
            value={point ?? ''}
            onChange={(e) => onChange({ type: moduleName, categoryId: current?.id, subType, point: e.target.value })}
            placeholder="选择或输入考点（用于关联母题）"
          />
          <datalist id="cat-points-list">
            {(current?.points ?? []).map((p) => <option key={p} value={p} />)}
          </datalist>
        </div>
      </div>
    </>
  )
}
