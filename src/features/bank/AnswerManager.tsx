import { useMemo, useState } from 'react'
import { Icon, Modal } from '../../components/ui'
import { applyAnswerImport, exportAnswerText, type AnswerTarget } from '../../lib/answerBatch'

interface Props {
  title: string
  targets: AnswerTarget[]
  onClose: () => void
  /** 上层只负责把 id → 答案写回对应 store */
  onApply: (answers: Record<string, string>) => void | Promise<void>
}

/**
 * 批量答案管理：导入教师版答案表，或导出当前答案表供外部核对。
 * 导入前实时预览匹配情况，避免 `1A 2B` 因题号重置被错配到别的题。
 */
export default function AnswerManager({ title, targets, onClose, onApply }: Props) {
  const [tab, setTab] = useState<'import' | 'export'>('import')
  const [text, setText] = useState('')
  const [by, setBy] = useState<'no' | 'index'>('no')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  const result = useMemo(() => applyAnswerImport(targets, text, by), [targets, text, by])
  const exportText = useMemo(() => exportAnswerText(targets), [targets])
  const numbered = targets.filter((item) => typeof item.no === 'number').length
  const answered = targets.filter((item) => item.answer.trim()).length

  const save = async () => {
    if (!result.matched.length || saving) return
    setSaving(true)
    try {
      await onApply(result.answers)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportText)
      setNotice('答案表已复制到剪贴板')
    } catch {
      setNotice('复制失败，请手动选择文本复制')
    }
  }

  const download = () => {
    const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `行测题库-答案-${new Date().toISOString().slice(0, 10)}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {notice && <span className="am-notice">{notice}</span>}
          <span className="am-spacer" />
          <button className="btn" onClick={onClose}>关闭</button>
          {tab === 'import' && (
            <button className="btn btn-primary" onClick={() => void save()} disabled={!result.matched.length || saving}>
              <Icon name="check" size={15} /> {saving ? '正在保存…' : `导入 ${result.matched.length} 题答案`}
            </button>
          )}
        </>
      }
    >
      <div className="am-tabs">
        <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>批量导入答案</button>
        <button className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}>导出答案表</button>
      </div>

      {tab === 'import' ? (
        <div className="am-body">
          <p className="am-hint">
            当前 {targets.length} 题，其中 <b>{answered}</b> 题已有答案、<b>{numbered}</b> 题带原文题号。
            支持 <code>1A 2B 3C</code>、<code>1.A 2.B</code>、每行一题，或无编号的连续字母串 <code>ABCD</code>。
          </p>
          <textarea
            className="am-textarea"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={'粘贴答案表，例如：\n1A 2B 3C 4D 5A\n或：\n1. A\n2. B\n3. C'}
          />
          <div className="am-mode">
            <span>匹配方式：</span>
            <label><input type="radio" checked={by === 'no'} onChange={() => setBy('no')} /> 原文题号（推荐）</label>
            <label><input type="radio" checked={by === 'index'} onChange={() => setBy('index')} /> 列表序号</label>
          </div>

          <div className="am-stats">
            <span className="ok">匹配 {result.matched.length} 题</span>
            <span className="warn">未匹配 {result.unmatched.length}</span>
            <span className="warn">无法识别 {result.invalid.length}</span>
          </div>

          {Boolean(result.invalid.length) && (
            <div className="am-invalid">无法识别的内容：{result.invalid.slice(0, 8).join(' / ')}</div>
          )}
          {Boolean(result.unmatched.length) && (
            <div className="am-invalid">
              未匹配题号：{result.unmatched.slice(0, 20).map((item) => `${item.no}${item.answer}`).join(' ')}
              {result.unmatched.length > 20 ? ' …' : ''}
            </div>
          )}

          {Boolean(result.matched.length) && (
            <div className="am-preview">
              <div className="am-preview-head">导入预览（仅这些题会被更新）</div>
              {result.matched.slice(0, 12).map((item) => (
                <div className="am-preview-row" key={item.id}>
                  <span className="am-preview-no">{item.no}{item.answer}</span>
                  <span className="am-preview-title">{item.titlePreview || '（无题干）'}</span>
                </div>
              ))}
              {result.matched.length > 12 && <div className="am-preview-more">… 其余 {result.matched.length - 12} 题</div>}
            </div>
          )}
        </div>
      ) : (
        <div className="am-body">
          <p className="am-hint">导出当前答案表，可保存到本地或粘贴到教师版答案文档；格式为「题号+答案」，用空格分隔。</p>
          <pre className="am-export">{exportText || '暂无答案，可先在左侧导入或用逐题编辑录入。'}</pre>
          <div className="am-export-actions">
            <button className="btn" onClick={() => void copy()} disabled={!exportText}><Icon name="filetext" size={15} /> 复制</button>
            <button className="btn" onClick={download} disabled={!exportText}><Icon name="download" size={15} /> 下载 .txt</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
