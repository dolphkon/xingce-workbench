import { useState } from 'react'
import { Icon, Modal } from '../../components/ui'
import type { QuizQuestion } from '../../types'

/** 题干规整：去每行题号前缀、合并被拆碎的短行 */
function formatStem(stem: string): string {
  const lines = stem
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\d{1,3}\s*[.．、,，)）]\s*/, '').replace(/^[.．、,，)）]\s+(?=\S)/, ''))
    .filter(Boolean)
  const merged: string[] = []
  for (const line of lines) {
    const prev = merged[merged.length - 1]
    if (prev && !/[。！？；：.!?;:]$/.test(prev) && line.length < 26 && !/^[（(]/.test(line)) {
      merged[merged.length - 1] = prev + line
    } else {
      merged.push(line)
    }
  }
  return merged.join('\n').trim()
}

/** 字段可疑度提示：缺答案/选项不全/题干疑似粘连或含版式噪音 */
function inspectQuestion(question: QuizQuestion) {
  const missingAnswer = !question.answer.trim()
  const filled = question.options.filter((option) => option.trim()).length
  const incompleteOptions = filled > 0 && filled < 4
  const tooLongStem = question.title.length > 280 && (incompleteOptions || missingAnswer)
  const boilerplateSuspected = /(?:复制必备|复制必究|版权所有|密封线|条形码|监考老师|注意事项|重要提示|请按照要求在答题卡|biguo\d{3,})/i.test(question.title)
  return {
    missingAnswer,
    incompleteOptions,
    tooLongStem,
    boilerplateSuspected,
    needsReview: missingAnswer || incompleteOptions || tooLongStem || boilerplateSuspected,
  }
}

/** 单题人工审核弹窗：题干、选项、答案、题型、解析均可编辑并即时校验 */
export default function QuestionReviewModal({
  question, index, onSave, onDelete, onClose,
}: {
  question: QuizQuestion
  index: number
  onSave: (next: QuizQuestion) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(question.title)
  const [options, setOptions] = useState<string[]>(() => [0, 1, 2, 3].map((i) => question.options[i] ?? ''))
  const [answer, setAnswer] = useState(question.answer)
  const [analysis, setAnalysis] = useState(question.analysis)
  const [type, setType] = useState(question.type)
  const confidence = inspectQuestion(question)

  const answerValid = answer.trim() === '' || /^[A-Da-d]{1,4}$/.test(answer.replace(/[\s、,，]/g, '').toUpperCase())
  const canSave = title.trim().length > 0 && answerValid

  const save = () => {
    if (!canSave) return
    onSave({
      ...question,
      title: formatStem(title),
      options: options.map((option) => option.trim()),
      answer: answer.replace(/[\s、,，]/g, '').toUpperCase(),
      analysis: analysis.trim(),
      type: type.trim() || '其他',
    })
  }

  return (
    <Modal
      title={`校对第 ${index + 1} 题`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn op-delete" onClick={onDelete} style={{ marginRight: 'auto' }}><Icon name="trash" size={14} /> 删除此题</button>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={save} disabled={!canSave}><Icon name="check" size={15} /> 确认无误并保存</button>
        </>
      }
    >
      <div className="op-review-form">
        {confidence.needsReview && (
          <div className="op-flag">
            <Icon name="info" size={14} />
            {confidence.boilerplateSuspected ? '题干含试卷说明/水印残留，请删除非题目内容' : confidence.tooLongStem ? '题干过长，疑似多题粘连，请拆分确认' : confidence.missingAnswer ? '答案未识别，请人工填写' : '选项识别不完整，请核对'}
          </div>
        )}
        <label className="form-label">题干 / 材料（换行会保留）</label>
        <textarea className="input op-textarea" rows={6} value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="form-label">选项</label>
        {options.map((option, i) => (
          <div className="op-option-edit" key={i}>
            <span className="op-option-key">{String.fromCharCode(65 + i)}</span>
            <input className="input" value={option} onChange={(e) => setOptions((prev) => prev.map((v, j) => j === i ? e.target.value : v))} placeholder={`选项 ${String.fromCharCode(65 + i)}`} />
          </div>
        ))}
        <div className="op-form-row">
          <div>
            <label className="form-label">正确答案（A-D，多选如 AB）</label>
            <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="如 A / AB" />
            {!answerValid && <p className="op-field-error">答案只能是 A-D 字母</p>}
          </div>
          <div>
            <label className="form-label">题型 / 模块</label>
            <input className="input" value={type} onChange={(e) => setType(e.target.value)} placeholder="如 言语理解" />
          </div>
        </div>
        <label className="form-label">解析（可选）</label>
        <textarea className="input op-textarea" rows={3} value={analysis} onChange={(e) => setAnalysis(e.target.value)} />
      </div>
    </Modal>
  )
}
