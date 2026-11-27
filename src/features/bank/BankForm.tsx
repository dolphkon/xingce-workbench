import { useState, type ChangeEvent } from 'react'
import { Icon } from '../../components/ui'
import QuestionImages from '../../components/QuestionImages'
import RichTextEditor from '../../components/RichTextEditor'
import { compressImage } from '../../lib/image'
import { plainToRichText, richTextToPlain, sanitizeRichHtml } from '../../lib/richText'
import { formatQuestionText, uid } from '../../lib/utils'
import { BANK_CATEGORIES, BANK_MODULES, type BankCategory, type BankQuestion } from '../../types'

interface Props {
  initial?: BankQuestion
  onSaved: (question: BankQuestion) => void
  onCancel: () => void
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D']

/** 题库题目手动新增 / 编辑表单 */
export default function BankForm({ initial, onSaved, onCancel }: Props) {
  const [category, setCategory] = useState<BankCategory>(initial?.category ?? '单选题')
  const [module, setModule] = useState(initial?.module ?? BANK_MODULES[0])
  const [materialHtml, setMaterialHtml] = useState(() =>
    initial?.materialHtml || plainToRichText(formatQuestionText(initial?.material ?? '')),
  )
  const [stem, setStem] = useState(formatQuestionText(initial?.stem ?? ''))
  const [options, setOptions] = useState<string[]>(() => {
    const base = [...(initial?.options ?? [])]
    while (base.length < 4) base.push('')
    return base.slice(0, 4)
  })
  const [answer, setAnswer] = useState(initial?.answer ?? '')
  const [analysis, setAnalysis] = useState(formatQuestionText(initial?.analysis ?? ''))
  const [source, setSource] = useState(initial?.source ?? '')
  const [images, setImages] = useState<string[]>(initial?.images ?? [])
  const [error, setError] = useState('')

  const handleImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    try {
      const stored = await Promise.all(files.map((f) => compressImage(f)))
      setImages((prev) => [...prev, ...stored].slice(0, 8))
    } catch {
      setError('图片处理失败')
    }
    event.target.value = ''
  }

  const submit = () => {
    if (!stem.trim() && !options.some(Boolean)) {
      setError('请填写题干或选项')
      return
    }
    const cleanAnswer = answer.trim().toUpperCase().replace(/[^A-D]/g, '')
    const now = Date.now()
    const safeHtml = sanitizeRichHtml(materialHtml)
    const materialText = formatQuestionText(richTextToPlain(safeHtml))
    onSaved({
      id: initial?.id ?? uid(),
      category: cleanAnswer.length > 1 ? '多选题' : category,
      module,
      material: materialText,
      materialHtml: safeHtml || undefined,
      stem: formatQuestionText(stem),
      options: options.map((o) => formatQuestionText(o)),
      answer: cleanAnswer,
      analysis: formatQuestionText(analysis),
      source: source.trim() || undefined,
      images,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    })
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">类别</label>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as BankCategory)} data-field="bank-category">
            {BANK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label className="form-label">模块</label>
          <select className="select" value={module} onChange={(e) => setModule(e.target.value)} data-field="bank-module">
            {BANK_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">材料（资料分析图表/言语文段等，可选）</label>
        <RichTextEditor value={materialHtml} onChange={setMaterialHtml} placeholder="可粘贴文字、插入图表并拖拽调整大小" />
      </div>

      <div className="form-field">
        <label className="form-label">题干 <span className="req">*</span></label>
        <textarea className="textarea" value={stem} onChange={(e) => setStem(e.target.value)} placeholder="题干文本" style={{ minHeight: 90 }} />
      </div>

      <div className="form-field">
        <label className="form-label">选项</label>
        <div className="form-row" style={{ gap: 8 }}>
          {OPTION_LETTERS.map((letter, index) => (
            <div className="row" key={letter} style={{ gap: 6 }}>
              <span className="chip" style={{ minWidth: 26, justifyContent: 'center' }}>{letter}</span>
              <input
                className="input"
                value={options[index] ?? ''}
                onChange={(e) => { const next = [...options]; next[index] = e.target.value; setOptions(next) }}
                placeholder={`选项 ${letter}`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">正确答案</label>
          <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="如 A / AB（多选）" />
        </div>
        <div className="form-field">
          <label className="form-label">来源（可选）</label>
          <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="如 2024 国考真题" />
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">解析（可选）</label>
        <textarea className="textarea" value={analysis} onChange={(e) => setAnalysis(e.target.value)} placeholder="解析文本" />
      </div>

      <div className="form-field">
        <label className="form-label">题目图片（最多 8 张）</label>
        <label className="upload-zone">
          <Icon name="image" size={22} />
          <div style={{ marginTop: 6 }}>点击上传题目截图</div>
          <input type="file" accept="image/*" multiple onChange={(e) => void handleImages(e)} />
        </label>
        <QuestionImages
          images={images}
          altPrefix="题目图片"
          variant="thumb"
          renderActions={(index) => (
            <button type="button" className="icon-btn danger" style={{ background: 'rgba(255,255,255,.92)' }} onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))} aria-label="删除图片">
              <Icon name="trash" size={13} />
            </button>
          )}
        />
      </div>

      <div className="form-actions">
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" onClick={submit}><Icon name="save" size={16} /> {initial ? '保存修改' : '加入题库'}</button>
      </div>
    </>
  )
}
