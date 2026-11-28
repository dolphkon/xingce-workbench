import { useMemo, useState } from 'react'
import { Icon, Modal } from '../../components/ui'
import { put } from '../../lib/db'
import { COMPOSE_LABEL, composePaper, type ComposeMode } from '../../lib/paperComposer'
import { BANK_MODULES, type BankQuestion, type Mistake, type Paper } from '../../types'

interface Props {
  bank: BankQuestion[]
  mistakes: Mistake[]
  onComposed: (paper: Paper) => void
  onClose: () => void
}

const MODE_HINT: Record<ComposeMode, string> = {
  full: '整库按原题号组成一套完整模拟卷，适合限时全真练习。',
  chapter: '只从选中模块抽题，集中攻克某一章节。',
  random: '从选中模块随机抽题，可设置每个模块的最少题数，均衡覆盖。',
  mistake: '从错题库抽取未掌握与掌握中的题目，反复练到掌握。',
}

/** 智能组卷配置面板：四种出题模式，生成后直接保存为在线套卷 */
export default function SmartComposePanel({ bank, mistakes, onComposed, onClose }: Props) {
  const [mode, setMode] = useState<ComposeMode>('full')
  const [modules, setModules] = useState<string[]>([])
  const [limit, setLimit] = useState(20)
  const [perModuleMin, setPerModuleMin] = useState(3)
  const [saving, setSaving] = useState(false)

  const result = useMemo(
    () => composePaper(bank, mistakes, { mode, modules, limit, perModuleMin }),
    [bank, mistakes, mode, modules, limit, perModuleMin],
  )

  const toggleModule = (name: string) => {
    setModules((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name])
  }

  const generate = async () => {
    if (!result.paper || saving) return
    setSaving(true)
    try {
      await put('papers', result.paper)
      onComposed(result.paper)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const showLimit = mode !== 'full'
  const max = result.questions.length

  return (
    <Modal
      title="智能组卷 · 系统自动出题"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="sc-summary">{result.paper?.title ?? '暂无可生成的试卷'}</span>
          <span className="am-spacer" />
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={() => void generate()} disabled={!result.paper || saving}>
            <Icon name="play" size={15} /> {saving ? '正在生成…' : `生成并推送 ${max} 题`}
          </button>
        </>
      }
    >
      <div className="sc-modes">
        {(Object.keys(COMPOSE_LABEL) as ComposeMode[]).map((key) => (
          <button key={key} className={`sc-mode${mode === key ? ' active' : ''}`} onClick={() => setMode(key)}>
            <b>{COMPOSE_LABEL[key]}</b>
            <span>{MODE_HINT[key]}</span>
          </button>
        ))}
      </div>

      <div className="sc-config">
        <div className="sc-config-row">
          <span className="sc-label">模块范围</span>
          <div className="sc-modules">
            <button className={`sc-chip${modules.length === 0 ? ' active' : ''}`} onClick={() => setModules([])}>全部模块</button>
            {BANK_MODULES.map((name) => (
              <button key={name} className={`sc-chip${modules.includes(name) ? ' active' : ''}`} onClick={() => toggleModule(name)}>{name}</button>
            ))}
          </div>
        </div>
        {showLimit && (
          <div className="sc-config-row">
            <label className="sc-label" htmlFor="sc-limit">抽题数量</label>
            <input id="sc-limit" className="input sc-number" type="number" min={1} max={500} value={limit} onChange={(event) => setLimit(Math.max(1, Number(event.target.value) || 1))} />
            {mode === 'random' && (
              <>
                <label className="sc-label" htmlFor="sc-min">每模块至少</label>
                <input id="sc-min" className="input sc-number" type="number" min={0} max={20} value={perModuleMin} onChange={(event) => setPerModuleMin(Math.max(0, Number(event.target.value) || 0))} />
              </>
            )}
          </div>
        )}
      </div>

      <div className="sc-preview">
        <div className="sc-preview-head">
          <b>组卷预览</b>
          <span>{result.error ? '—' : `${max} 题 · ${result.distribution.length} 个模块`}</span>
        </div>
        {result.error ? (
          <div className="sc-error"><Icon name="info" size={15} /> {result.error}</div>
        ) : (
          <>
            <div className="sc-bars">
              {result.distribution.map((item) => (
                <div className="sc-bar-row" key={item.name}>
                  <span className="sc-bar-name">{item.name}</span>
                  <span className="sc-bar-track"><i style={{ width: `${Math.max(4, Math.round((item.count / max) * 100))}%` }} /></span>
                  <b>{item.count}</b>
                </div>
              ))}
            </div>
            <p className="sc-hint">题目顺序已随机打乱；生成后可在「在线刷题 → 我的试卷」里逐题校对、批量导入答案后开始答题。</p>
          </>
        )}
      </div>
    </Modal>
  )
}
