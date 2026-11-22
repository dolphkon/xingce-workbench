import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Icon } from '../../components/ui'
import { put } from '../../lib/db'
import { compressImage } from '../../lib/image'
import { parseQuestionText, recognizeImage } from '../../lib/ocr'
import { formatQuestionText, parseTags, uid } from '../../lib/utils'
import {
  QUESTION_TYPES,
  type Mistake,
  type MotherQuestion,
  type QuestionType,
} from '../../types'

interface Props {
  initial?: Mistake
  mothers: MotherQuestion[]
  onSaved: () => void
  onCancel: () => void
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D']

export default function MistakeForm({ initial, mothers, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [type, setType] = useState<QuestionType>(initial?.type ?? '言语理解')
  const [options, setOptions] = useState<string[]>(() => {
    const base = [...(initial?.options ?? [])]
    while (base.length < 4) base.push('')
    return base.slice(0, 4)
  })
  const [answer, setAnswer] = useState(initial?.answer ?? '')
  const [userAnswer, setUserAnswer] = useState(initial?.userAnswer ?? '')
  const [analysis, setAnalysis] = useState(initial?.analysis ?? '')
  const [tagsInput, setTagsInput] = useState(initial?.tags.join(', ') ?? '')
  const [source, setSource] = useState(initial?.source ?? '')
  const [images, setImages] = useState<string[]>(initial?.images ?? [])
  const imagesRef = useRef(images)
  const [motherId, setMotherId] = useState(initial?.motherId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrError, setOcrError] = useState<string | null>(null)

  // 压缩图片并入列（最多 8 张），返回实际加入的项
  const appendImages = useCallback(async (files: File[]): Promise<string[]> => {
    const compressed = await Promise.all(files.map((file) => compressImage(file)))
    const added: string[] = []
    setImages((prev) => {
      const room = 8 - prev.length
      const next = [...prev, ...compressed].slice(0, 8)
      added.push(...compressed.slice(0, Math.max(0, room)))
      imagesRef.current = next
      return next
    })
    setOcrError(null)
    return added
  }, [])

  // 对单张图片执行 OCR，自动拆分题干、选项与答案并填入表单
  const runOcr = useCallback(async (dataUrl: string) => {
    setOcrBusy(true)
    setOcrProgress(0)
    setOcrError(null)
    try {
      const text = await recognizeImage(dataUrl, setOcrProgress)
      if (!text) throw new Error('未识别出文字，请换用更清晰的图片')
      const parsed = parseQuestionText(text)
      const hasOptions = parsed.options.some((option) => option.trim())

      if (hasOptions) {
        // 只覆盖识别出的选项，保留用户已填的其他内容
        setOptions((prev) => parsed.options.map((option, i) => formatQuestionText(option) || prev[i] || ''))
      }
      // 有选项时题干只保留题目文字，避免把选项重复塞进题干
      const stem = hasOptions ? parsed.stem : text
      if (stem) setTitle((prev) => formatQuestionText(prev.trim() ? `${prev.trim()}\n${stem}` : stem))
      if (parsed.answer) setAnswer((prev) => (prev.trim() ? prev : parsed.answer))
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : '识别失败')
    } finally {
      setOcrBusy(false)
    }
  }, [])

  // 粘贴图片：自动上传（入列）并 OCR 识别；仅在表单挂载期间监听
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
          if (added.length === 0) {
            setOcrError('最多上传 8 张图片')
            return
          }
          for (const image of added) {
            await runOcr(image)
          }
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
    try {
      await appendImages(files)
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : '图片处理失败')
    }
    event.target.value = ''
  }

  const handleOcr = (index: number) => {
    void runOcr(images[index])
  }

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('请填写题干（可用 OCR 识别后校对）')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const now = Date.now()
      const record: Mistake = {
        id: initial?.id ?? uid(),
        title: formatQuestionText(title),
        type,
        options,
        answer: answer.trim().toUpperCase(),
        userAnswer: userAnswer.trim().toUpperCase(),
        analysis: analysis.trim(),
        tags: parseTags(tagsInput),
        source: source.trim() || undefined,
        images,
        createdAt: initial?.createdAt ?? now,
        updatedAt: now,
        lastReviewedAt: initial?.lastReviewedAt,
        reviewCount: initial?.reviewCount ?? 0,
        correctCount: initial?.correctCount ?? 0,
        motherId: motherId || undefined,
      }
      await put('mistakes', record)
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
        <label className="form-label">题干 <span className="req">*</span></label>
        <textarea
          className="textarea"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setTitle((prev) => formatQuestionText(prev))}
          placeholder="粘贴题目文字，或通过下方图片使用 OCR 识别后校对；离开输入框时自动排版对齐"
          style={{ minHeight: 110 }}
        />
        <span className="form-hint">粘贴或识别后离开输入框，会自动清理多余空格并规整换行</span>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">题型</label>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
            {QUESTION_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label className="form-label">关联母题（可选）</label>
          <select className="select" value={motherId} onChange={(e) => setMotherId(e.target.value)}>
            <option value="">不关联</option>
            {mothers.map((item) => (
              <option key={item.id} value={item.id}>{item.title.slice(0, 30)}{item.title.length > 30 ? '…' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">选项（留空即视为非选择题）</label>
        <div className="form-row" style={{ gap: 8 }}>
          {OPTION_LETTERS.map((letter, index) => (
            <div className="row" key={letter} style={{ gap: 6 }}>
              <span className="chip" style={{ minWidth: 26, justifyContent: 'center' }}>{letter}</span>
              <input
                className="input"
                value={options[index] ?? ''}
                onChange={(e) => {
                  const next = [...options]
                  next[index] = e.target.value
                  setOptions(next)
                }}
                placeholder={`选项 ${letter}`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">正确答案</label>
          <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="如 A / ABC / 文本内容" />
        </div>
        <div className="form-field">
          <label className="form-label">我的答案（可选）</label>
          <input className="input" value={userAnswer} onChange={(e) => setUserAnswer(e.target.value)} placeholder="当时选了什么" />
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">解析 / 复盘笔记</label>
        <textarea
          className="textarea"
          value={analysis}
          onChange={(e) => setAnalysis(e.target.value)}
          placeholder="错因、正确思路、易错点…"
        />
      </div>

      <div className="form-field">
        <label className="form-label">题目来源</label>
        <input
          className="input"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="如：2024 国考行测真题、某教材第 3 章、某 APP 模考"
        />
        <span className="form-hint">记录这道题的出处，方便日后追溯</span>
      </div>

      <div className="form-field">
        <label className="form-label">标签</label>
        <input className="input" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="用逗号分隔，如：削弱论证, 高频考点" />
        <span className="form-hint">多个标签用逗号、空格或换行分隔</span>
      </div>

      <div className="form-field">
        <label className="form-label">题目图片（最多 8 张）</label>
        <label className="upload-zone">
          <Icon name="image" size={22} />
          <div style={{ marginTop: 6 }}>点击上传，或直接 <strong>Ctrl/⌘ + V</strong> 粘贴截图（自动识别）</div>
          <span className="form-hint">图片会压缩后保存在本机</span>
          <input type="file" accept="image/*" multiple onChange={handleImages} />
        </label>
        {images.length > 0 && (
          <div className="image-grid" style={{ marginTop: 10 }}>
            {images.map((image, index) => (
              <div className="image-thumb" key={`${image.slice(0, 40)}-${index}`}>
                <img src={image} alt={`题目图片 ${index + 1}`} />
                <div className="row" style={{ position: 'absolute', bottom: 4, right: 4, gap: 2 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ padding: '3px 7px', fontSize: 11, background: 'rgba(255,255,255,.92)' }}
                    disabled={ocrBusy}
                    onClick={() => handleOcr(index)}
                  >
                    <Icon name="sparkle" size={12} /> OCR 识别
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    style={{ background: 'rgba(255,255,255,.92)' }}
                    onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="删除图片"
                  >
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
            <span>本地识别中 {ocrProgress}%</span>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${ocrProgress}%` }} /></div>
          </div>
        )}
        <span className="form-hint" style={{ marginTop: 6 }}>
          支持直接 Ctrl/⌘ + V 粘贴截图，粘贴后自动上传并识别题干、选项与答案；首次 OCR 需下载中文语言包（约 15MB），结果请务必人工校对。
        </span>
      </div>

      <div className="form-actions">
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" onClick={() => void handleSubmit()} disabled={saving}>
          <Icon name="save" size={16} /> {saving ? '保存中…' : initial ? '保存修改' : '录入错题'}
        </button>
      </div>
    </>
  )
}
