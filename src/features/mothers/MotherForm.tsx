import { useState } from 'react'
import { Icon } from '../../components/ui'
import { put } from '../../lib/db'
import { parseTags, uid } from '../../lib/utils'
import { QUESTION_TYPES, type MotherQuestion, type QuestionType } from '../../types'

interface Props {
  initial?: MotherQuestion
  onSaved: () => void
  onCancel: () => void
}

export default function MotherForm({ initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [type, setType] = useState<QuestionType>(initial?.type ?? '判断推理')
  const [point, setPoint] = useState(initial?.point ?? '')
  const [modelAnswer, setModelAnswer] = useState(initial?.modelAnswer ?? '')
  const [keyPoints, setKeyPoints] = useState(initial?.keyPoints.join('\n') ?? '')
  const [tagsInput, setTagsInput] = useState(initial?.tags.join(', ') ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('请填写母题题干')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const now = Date.now()
      const record: MotherQuestion = {
        id: initial?.id ?? uid(),
        title: title.trim(),
        type,
        point: point.trim(),
        modelAnswer: modelAnswer.trim(),
        keyPoints: keyPoints.split('\n').map((line) => line.trim()).filter(Boolean),
        tags: parseTags(tagsInput),
        createdAt: initial?.createdAt ?? now,
        updatedAt: now,
      }
      await put('mothers', record)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
      setSaving(false)
    }
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="form-field">
        <label className="form-label">母题题干 <span className="req">*</span></label>
        <textarea
          className="textarea"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="描述这类题的通用题干模型，可用「某…」作为占位"
          style={{ minHeight: 100 }}
        />
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">题型</label>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
            {QUESTION_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label className="form-label">考点</label>
          <input className="input" value={point} onChange={(e) => setPoint(e.target.value)} placeholder="如：削弱论证 · 因果倒置" />
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">标准解法 / 解题思路</label>
        <textarea
          className="textarea"
          value={modelAnswer}
          onChange={(e) => setModelAnswer(e.target.value)}
          placeholder="这类题的通用解题步骤与判断依据"
          style={{ minHeight: 110 }}
        />
      </div>

      <div className="form-field">
        <label className="form-label">关键要点</label>
        <textarea
          className="textarea"
          value={keyPoints}
          onChange={(e) => setKeyPoints(e.target.value)}
          placeholder="每行一条，如：\n先找论点与论据\n关注因果倒置选项"
          style={{ minHeight: 90 }}
        />
        <span className="form-hint">每行一条，保存后会自动拆分为要点列表</span>
      </div>

      <div className="form-field">
        <label className="form-label">标签</label>
        <input className="input" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="逗号分隔，如：高频母题, 逻辑判断" />
      </div>

      <div className="form-actions">
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" onClick={() => void handleSubmit()} disabled={saving}>
          <Icon name="save" size={16} /> {saving ? '保存中…' : initial ? '保存修改' : '录入母题'}
        </button>
      </div>
    </>
  )
}
