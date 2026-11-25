import { useMemo } from 'react'
import { Icon } from '../../components/ui'
import { pointsForType } from '../../lib/categories'
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
  /** 错题专用：是否显示「关联母题」开关；不传则保持原有考点输入框（母题表单） */
  linkMother?: boolean
  onLinkMotherChange?: (value: boolean) => void
}

/**
 * 模块 → 题型 → 考点 三级级联选择。
 * 错题表单中由「关联母题」开关控制：关闭时不关联母题，开启后按当前题型选择对应考点。
 */
export default function CategoryFields({
  categories, type, categoryId, subType, point, onChange, onManage, linkMother, onLinkMotherChange,
}: Props) {
  const current = useMemo(() => {
    const byId = categoryId ? categories.find((c) => c.id === categoryId) : undefined
    const byName = categories.find((c) => c.name === type)
    return byId ?? byName
  }, [categories, categoryId, type])

  const moduleName = current?.name ?? type
  const isMistake = linkMother !== undefined
  const pointOptions = useMemo(
    () => (isMistake ? pointsForType(current, subType) : current?.points ?? []),
    [isMistake, current, subType],
  )

  const patchPoint = (value: string) => onChange({ type: moduleName, categoryId: current?.id, subType, point: value })

  const handleModule = (name: string) => {
    const cat = categories.find((c) => c.name === name)
    onChange({ type: name, categoryId: cat?.id, subType: '', point: '' })
  }

  const handleSubType = (value: string) => {
    // 切换题型后，若原考点不属于新题型则清空，避免错配到别的母题
    const options = isMistake ? pointsForType(current, value) : []
    const keepPoint = !isMistake || !point || options.includes(point)
    onChange({ type: moduleName, categoryId: current?.id, subType: value, point: keepPoint ? point : '' })
  }

  const handleLinkMother = (next: boolean) => {
    onLinkMotherChange?.(next)
    if (!next) {
      if (point) patchPoint('')
      return
    }
    if (point && pointOptions.length > 0 && !pointOptions.includes(point)) patchPoint('')
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
            onChange={(e) => handleSubType(e.target.value)}
            placeholder="选择或输入题型"
          />
          <datalist id="cat-types-list">
            {(current?.types ?? []).map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>

        {!isMistake ? (
          <div className="form-field">
            <label className="form-label">考点 <span className="small light">（母题据此关联）</span></label>
            <input
              className="input"
              data-field="point"
              list="cat-points-list"
              value={point ?? ''}
              onChange={(e) => patchPoint(e.target.value)}
              placeholder="选择或输入考点（用于关联母题）"
            />
            <datalist id="cat-points-list">
              {(current?.points ?? []).map((p) => <option key={p} value={p} />)}
            </datalist>
          </div>
        ) : (
          <div className="form-field">
            <div className="form-switch-row">
              <span className="form-label" style={{ margin: 0 }}>关联母题</span>
              <button
                type="button"
                role="switch"
                aria-label="关联母题"
                aria-checked={Boolean(linkMother)}
                className={`form-switch${linkMother ? ' on' : ''}`}
                onClick={() => handleLinkMother(!linkMother)}
              ><span className="form-switch-thumb" /></button>
              <span className={`small ${linkMother ? 'muted' : 'light'}`}>{linkMother ? '已开启' : '已关闭'}</span>
            </div>
            {linkMother ? (
              <>
                <select
                  className="select"
                  data-field="point"
                  value={point ?? ''}
                  onChange={(e) => patchPoint(e.target.value)}
                >
                  <option value="">{subType ? `选择「${subType}」考点` : '请先选择题型'}</option>
                  {pointOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                  {point && !pointOptions.includes(point) && <option value={point}>{point}（原考点）</option>}
                </select>
                <span className="form-hint">
                  {pointOptions.length
                    ? `仅显示「${subType || '当前题型'}」下的考点，选择后自动关联同考点母题`
                    : '该题型暂无考点，可在「管理」中为其配置考点'}
                </span>
              </>
            ) : (
              <span className="form-hint" style={{ minHeight: 32, display: 'flex', alignItems: 'center' }}>
                关闭后不与母题自动关联
              </span>
            )}
          </div>
        )}
      </div>
    </>
  )
}
