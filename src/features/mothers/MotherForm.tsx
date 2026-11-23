import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Icon } from '../../components/ui'
import { put } from '../../lib/db'
import { readCategories } from '../../lib/categories'
import { compressImage, fileToDataUrl } from '../../lib/image'
import { parseQuestionText, recognizeImage, warmupOcr } from '../../lib/ocr'
import { formatQuestionText, parseTags, uid } from '../../lib/utils'
import type { MotherQuestion, QuestionType } from '../../types'
import CategoryFields from '../categories/CategoryFields'
import CategoryManager from '../categories/CategoryManager'

interface Props {
  initial?: MotherQuestion
  /** 已有错题的考点集合，用于提示将自动关联多少道错题 */
  mistakePoints?: string[]
  onSaved: () => void
  onCancel: () => void
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D']

export default function MotherForm({ initial, mistakePoints = [], onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(() => formatQuestionText(initial?.title ?? ''))
  const [categories, setCategories] = useState(readCategories)
  const [managing, setManaging] = useState(false)
  const [type, setType] = useState<QuestionType>(initial?.type ?? '判断推理')
  const [categoryId, setCategoryId] = useState<string | undefined>(initial?.categoryId)
  const [subType, setSubType] = useState(initial?.subType ?? '')
  const [point, setPoint] = useState(initial?.point ?? '')
  const [options, setOptions] = useState<string[]>(() => {
    const base = [...(initial?.options ?? [])]
    while (base.length < 4) base.push('')
    return base.slice(0, 4)
  })
  const [modelAnswer, setModelAnswer] = useState(initial?.modelAnswer ?? '')
  const [keyPoints, setKeyPoints] = useState(initial?.keyPoints.join('\n') ?? '')
  const [tagsInput, setTagsInput] = useState(initial?.tags.join(', ') ?? '')
  const [source, setSource] = useState(initial?.source ?? '')
  const [accuracyInput, setAccuracyInput] = useState(() =>
    initial?.accuracy != null ? String(initial.accuracy) : '',
  )
  const [images, setImages] = useState<string[]>(initial?.images ?? [])
  const imagesRef = useRef(images)
  const ocrSourcesRef = useRef<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrStage, setOcrStage] = useState('')
  const [ocrError, setOcrError] = useState<string | null>(null)

  useEffect(() => { void warmupOcr().catch(() => undefined) }, [])

  // 按考点自动关联错题数
  const relatedCount = point.trim() ? mistakePoints.filter((p) => p === point.trim()).length : 0

  const appendImages = useCallback(async (files: File[]): Promise<Array<{ stored: string; ocr: string }>> => {
    const room = 8 - imagesRef.current.length
    const picked = files.slice(0, Math.max(0, room))
    const [compressed, originals] = await Promise.all([
      Promise.all(picked.map((file) => compressImage(file))),
      Promise.all(picked.map((file) => fileToDataUrl(file).catch(() => ''))),
    ])
    const added = compressed.map((stored, i) => ({ stored, ocr: originals[i] || stored }))
    setImages((prev) => {
      const start = prev.length
      const next = [...prev, ...compressed].slice(0, 8)
      imagesRef.current = next
      added.forEach((_, i) => {
        const idx = start + i
        if (idx < 8) ocrSourcesRef.current[idx] = added[i].ocr
      })
      return next
    })
    setOcrError(null)
    return added
  }, [])

  const runOcr = useCallback(async (dataUrl: string) => {
    setOcrBusy(true)
    setOcrProgress(0)
    setOcrStage('正在优化图片…')
    setOcrError(null)
    try {
      const text = await recognizeImage(dataUrl, (progress, stage) => {
        setOcrProgress(progress)
        if (stage) setOcrStage(stage)
      })
      if (!text) throw new Error('未识别出文字，请换用更清晰的图片')
      const parsed = parseQuestionText(text)
      const hasOptions = parsed.options.some((o) => o.trim())
      if (hasOptions) {
        setOptions((prev) => parsed.options.map((o, i) => formatQuestionText(o) || prev[i] || ''))
      }
      const stem = hasOptions ? parsed.stem : text
      if (stem) setTitle((prev) => formatQuestionText(prev.trim() ? `${prev.trim()}\n${stem}` : stem))
      if (parsed.answer) setModelAnswer((prev) => (prev.trim() ? prev : `正确答案：${parsed.answer}`))
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : '识别失败')
    } finally {
      setOcrBusy(false)
    }
  }, [])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      if (files.length === 0) return
      event.preventDefault()
      void (async () => {
        try {
          const added = await appendImages(files)
          if (added.length === 0) { setOcrError('最多上传 8 张图片'); return }
          for (const image of added) await runOcr(image.ocr)
        } catch (err) {
          setOcrError(err instanceof Error ? err.message : '图片处理失败')
        }
      })()
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [appendImages, runOcr])

  const handleImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    try { await appendImages(files) } catch (err) {
      setOcrError(err instanceof Error ? err.message : '图片处理失败')
    }
    event.target.value = ''
  }

  const handleSubmit = async () => {
    if (!title.trim()) { setError('请填写母题题干（可用 OCR 识别后校对）'); return }
    const accuracyRaw = accuracyInput.trim()
    const accuracy = accuracyRaw === '' ? undefined : Number(accuracyRaw)
    if (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100)) {
      setError('正确率需为 0–100 的数字'); return
    }
    setSaving(true); setError(null)
    try {
      const now = Date.now()
      const record: MotherQuestion = {
        id: initial?.id ?? uid(),
        title: formatQuestionText(title),
        type,
        point: point.trim(),
        modelAnswer: modelAnswer.trim(),
        keyPoints: keyPoints.split('\n').map((line) => line.trim()).filter(Boolean),
        tags: parseTags(tagsInput),
        source: source.trim() || undefined,
        accuracy,
        createdAt: initial?.createdAt ?? now,
        updatedAt: now,
        categoryId,
        subType: subType.trim() || undefined,
        images,
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
      {ocrError && <div className="error-banner">{ocrError}</div>}

      <div className="form-field">
        <label className="form-label">母题题干 <span className="req">*</span></label>
        <textarea
          className="textarea"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setTitle((prev) => formatQuestionText(prev))}
          placeholder="描述这类题的通用题干模型，可用「某…」作为占位；也可粘贴题目截图自动 OCR 识别"
          style={{ minHeight: 100 }}
        />
        <span className="form-hint">离开输入框时自动清理多余空格并规整换行</span>
      </div>

      <CategoryFields
        categories={categories}
        type={type}
        categoryId={categoryId}
        subType={subType}
        point={point}
        onManage={() => setManaging(true)}
        onChange={(patch) => { setType(patch.type); setCategoryId(patch.categoryId); setSubType(patch.subType); setPoint(patch.point) }}
      />

      {relatedCount > 0 && (
        <div className="notice" style={{ fontSize: 12 }}>
          考点「{point.trim()}」当前关联 <strong>{relatedCount}</strong> 道错题，保存后可在母题详情查看。
        </div>
      )}

      <div className="form-field">
        <label className="form-label">选项（OCR 识别时自动填充，可选）</label>
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

      <div className="form-field">
        <label className="form-label">标准解法 / 解题思路</label>
        <textarea className="textarea" value={modelAnswer} onChange={(e) => setModelAnswer(e.target.value)}
          placeholder="这类题的通用解题步骤与判断依据" style={{ minHeight: 100 }} />
      </div>

      <div className="form-field">
        <label className="form-label">关键要点</label>
        <textarea className="textarea" value={keyPoints} onChange={(e) => setKeyPoints(e.target.value)}
          placeholder={'每行一条，如：\n先找论点与论据\n关注因果倒置选项'} style={{ minHeight: 90 }} />
        <span className="form-hint">每行一条，保存后会自动拆分为要点列表</span>
      </div>

      <div className="form-field" style={{ maxWidth: 260 }}>
        <label className="form-label">自评正确率（可选）</label>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" type="number" min={0} max={100} step={1} value={accuracyInput}
            onChange={(e) => {
              const value = e.target.value
              if (value === '') { setAccuracyInput(''); return }
              const num = Number(value)
              if (Number.isFinite(num) && num >= 0 && num <= 100) setAccuracyInput(value)
            }} placeholder="0–100" />
          <span className="small muted" style={{ flex: '0 0 auto' }}>%</span>
        </div>
        <span className="form-hint">手动记录这类母题的掌握程度</span>
      </div>

      <div className="form-field">
        <label className="form-label">题目来源</label>
        <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="如：2024 国考行测真题、某教材第 3 章" />
      </div>

      <div className="form-field">
        <label className="form-label">标签</label>
        <input className="input" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="逗号分隔，如：高频母题, 逻辑判断" />
      </div>

      <div className="form-field">
        <label className="form-label">题目图片（最多 8 张，可粘贴截图自动识别）</label>
        <label className="upload-zone">
          <Icon name="image" size={22} />
          <div style={{ marginTop: 6 }}>点击上传，或直接 <strong>Ctrl/⌘ + V</strong> 粘贴截图（自动识别）</div>
          <span className="form-hint">图片压缩后保存在本机，OCR 使用未压缩原图</span>
          <input type="file" accept="image/*" multiple onChange={(e) => void handleImages(e)} />
        </label>
        {images.length > 0 && (
          <div className="image-grid" style={{ marginTop: 10 }}>
            {images.map((image, index) => (
              <div className="image-thumb" key={`${image.slice(0, 40)}-${index}`}>
                <img src={image} alt={`母题图片 ${index + 1}`} />
                <div className="row" style={{ position: 'absolute', bottom: 4, right: 4, gap: 2 }}>
                  <button type="button" className="btn btn-sm" style={{ padding: '3px 7px', fontSize: 11, background: 'rgba(255,255,255,.92)' }}
                    disabled={ocrBusy} onClick={() => void runOcr(ocrSourcesRef.current[index] || images[index])}>
                    <Icon name="sparkle" size={12} /> OCR 识别
                  </button>
                  <button type="button" className="icon-btn danger" style={{ background: 'rgba(255,255,255,.92)' }}
                    onClick={() => {
                      setImages((prev) => prev.filter((_, i) => i !== index))
                      const nextSources: Record<number, string> = {}
                      let to = 0
                      for (let i = 0; i < 8; i++) {
                        if (i === index) continue
                        if (ocrSourcesRef.current[i] != null) nextSources[to] = ocrSourcesRef.current[i]
                        to++
                      }
                      ocrSourcesRef.current = nextSources
                    }} aria-label="删除图片">
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {ocrBusy && (
          <div className="ocr-status" style={{ marginTop: 10, marginBottom: 0 }}>
            <Icon name="sparkle" size={15} />
            <span>{ocrStage || '本地识别中'} {ocrProgress}%</span>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${ocrProgress}%` }} /></div>
          </div>
        )}
      </div>

      <div className="form-actions">
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" onClick={() => void handleSubmit()} disabled={saving}>
          <Icon name="save" size={16} /> {saving ? '保存中…' : initial ? '保存修改' : '录入母题'}
        </button>
      </div>

      {managing && <CategoryManager onClose={() => { setManaging(false); setCategories(readCategories()) }} />}
    </>
  )
}
