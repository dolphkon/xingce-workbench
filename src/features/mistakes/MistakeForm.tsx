import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import SymbolPicker from '../../components/SymbolPicker'
import { Icon } from '../../components/ui'
import QuestionImages from '../../components/QuestionImages'
import { put } from '../../lib/db'
import { readCategories } from '../../lib/categories'
import { syncMistakeToBank } from '../../lib/bankSync'
import { compressImage, fileToDataUrl } from '../../lib/image'
import { parseQuestionText, recognizeImage, warmupOcr } from '../../lib/ocr'
import { plainToRichText, richTextToPlain, sanitizeRichHtml } from '../../lib/richText'
import { formatQuestionText, parseTags, uid } from '../../lib/utils'
import {
  BANK_CATEGORIES, BANK_MODULES, MASTERY_LEVELS, masteryOf,
  type BankCategory, type Mistake, type MotherQuestion, type QuestionType, type Mastery,
} from '../../types'
import RichTextEditor from '../../components/RichTextEditor'
import CategoryFields from '../categories/CategoryFields'
import CategoryManager from '../categories/CategoryManager'

interface Props {
  initial?: Mistake
  mothers: MotherQuestion[]
  onSaved: () => void
  onCancel: () => void
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D']

export default function MistakeForm({ initial, mothers, onSaved, onCancel }: Props) {
  // 与题库后台共有的字段：类别 / 模块 / 材料 / 题干
  const [category, setCategory] = useState<BankCategory>(initial?.category ?? '单选题')
  const [module, setModule] = useState(() => {
    if (initial?.module && BANK_MODULES.includes(initial.module as (typeof BANK_MODULES)[number])) return initial.module
    return (initial?.type && BANK_MODULES.includes(initial.type as (typeof BANK_MODULES)[number])) ? initial.type : BANK_MODULES[0]
  })
  const [materialHtml, setMaterialHtml] = useState(() => {
    const base = initial?.materialHtml || plainToRichText(formatQuestionText(initial?.material ?? ''))
    return sanitizeRichHtml(base)
  })
  const [title, setTitle] = useState(() => formatQuestionText(initial?.title ?? ''))
  const [categories, setCategories] = useState(readCategories)
  const [managing, setManaging] = useState(false)
  const [type, setType] = useState<QuestionType>(initial?.type ?? '言语理解')
  const [categoryId, setCategoryId] = useState<string | undefined>(initial?.categoryId)
  const [subType, setSubType] = useState(initial?.subType ?? '')
  const [point, setPoint] = useState(initial?.point ?? '')
  // 旧数据若已有考点/手动母题，视为已开启关联；新建错题默认不关联
  const [linkMother, setLinkMother] = useState(() => initial?.linkMother ?? Boolean(initial?.point || initial?.motherId))
  const [options, setOptions] = useState<string[]>(() => {
    const base = [...(initial?.options ?? [])]
    while (base.length < 4) base.push('')
    return base.slice(0, 4)
  })
  const optionRefs = useRef<(HTMLInputElement | null)[]>([])
  const lastFocusedOption = useRef(0)
  const insertOptionSymbol = (symbol: string) => {
    const index = lastFocusedOption.current
    const el = optionRefs.current[index]
    const current = options[index] ?? ''
    const start = el?.selectionStart ?? current.length
    const end = el?.selectionEnd ?? current.length
    const next = [...options]
    next[index] = current.slice(0, start) + symbol + current.slice(end)
    setOptions(next)
    requestAnimationFrame(() => {
      el?.focus()
      const caret = start + symbol.length
      el?.setSelectionRange(caret, caret)
    })
  }
  const [answer, setAnswer] = useState(initial?.answer ?? '')
  const [userAnswer, setUserAnswer] = useState(initial?.userAnswer ?? '')
  const [analysis, setAnalysis] = useState(initial?.analysis ?? '')
  const [tagsInput, setTagsInput] = useState(initial?.tags.join(', ') ?? '')
  const [source, setSource] = useState(initial?.source ?? '')
  const [accuracyInput, setAccuracyInput] = useState(() =>
    initial?.accuracy != null ? String(initial.accuracy) : '',
  )
  // 掌握度：新建默认「未掌握」，编辑时沿用已有状态
  const [reviewStatus, setReviewStatus] = useState<Mastery>(() => masteryOf(initial ?? {}))
  const [images, setImages] = useState<string[]>(initial?.images ?? [])
  const imagesRef = useRef(images)
  // 原始清晰图缓存：OCR 用原图（压缩会破坏圆圈标记），存储用压缩图
  const ocrSourcesRef = useRef<Record<number, string>>({})
  const [motherId, setMotherId] = useState(initial?.motherId ?? '')
  // 下拉框默认选中第一个真实母题，提示词不再作为可选项
  const effectiveMotherId = motherId && mothers.some((m) => m.id === motherId)
    ? motherId
    : (mothers[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrStage, setOcrStage] = useState('')
  const [ocrError, setOcrError] = useState<string | null>(null)

  // 进入录入页即预热 OCR 引擎与语言包：用户粘贴图片时通常已就绪，消除首次长等待
  useEffect(() => {
    void warmupOcr().catch(() => undefined)
  }, [])

  // 压缩图片并入列（最多 8 张），返回实际加入的项：{ stored: 压缩存储图, ocr: 原始清晰图 }
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
      // 记录每张新增图片对应的原始清晰图索引
      added.forEach((_, i) => {
        const idx = start + i
        if (idx < 8) ocrSourcesRef.current[idx] = added[i].ocr
      })
      return next
    })
    setOcrError(null)
    return added
  }, [])

  // 对单张图片执行 OCR，自动拆分题干、选项与答案并填入表单
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
            await runOcr(image.ocr)
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
    void runOcr(ocrSourcesRef.current[index] || images[index])
  }

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('请填写题干（可用 OCR 识别后校对）')
      return
    }
    const accuracyRaw = accuracyInput.trim()
    const accuracy = accuracyRaw === '' ? undefined : Number(accuracyRaw)
    if (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100)) {
      setError('正确率需为 0–100 的数字')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const now = Date.now()
      const cleanAnswer = answer.trim().toUpperCase().replace(/[^A-D]/g, '')
      const safeHtml = sanitizeRichHtml(materialHtml)
      const id = initial?.id ?? uid()
      const bankId = await syncMistakeToBank({
        id,
        title: formatQuestionText(title),
        type,
        options,
        answer: cleanAnswer,
        userAnswer: userAnswer.trim().toUpperCase(),
        analysis: analysis.trim(),
        tags: parseTags(tagsInput),
        source: source.trim() || undefined,
        accuracy,
        images,
        reviewStatus,
        createdAt: initial?.createdAt ?? now,
        updatedAt: now,
        lastReviewedAt: initial?.lastReviewedAt,
        reviewCount: initial?.reviewCount ?? 0,
        correctCount: initial?.correctCount ?? 0,
        motherId: linkMother ? effectiveMotherId || undefined : undefined,
        categoryId,
        subType: subType.trim() || undefined,
        point: linkMother ? point.trim() || undefined : undefined,
        linkMother,
        bankId: initial?.bankId,
        category,
        module,
        material: richTextToPlain(safeHtml),
        materialHtml: safeHtml || undefined,
      })
      const record: Mistake = {
        id,
        title: formatQuestionText(title),
        type,
        options,
        answer: answer.trim().toUpperCase(),
        userAnswer: userAnswer.trim().toUpperCase(),
        analysis: analysis.trim(),
        tags: parseTags(tagsInput),
        source: source.trim() || undefined,
        accuracy,
        images,
        reviewStatus,
        createdAt: initial?.createdAt ?? now,
        updatedAt: now,
        lastReviewedAt: initial?.lastReviewedAt,
        reviewCount: initial?.reviewCount ?? 0,
        correctCount: initial?.correctCount ?? 0,
        motherId: linkMother ? effectiveMotherId || undefined : undefined,
        categoryId,
        subType: subType.trim() || undefined,
        point: linkMother ? point.trim() || undefined : undefined,
        linkMother,
        bankId,
        category: cleanAnswer.length > 1 ? '多选题' : category,
        module,
        material: richTextToPlain(safeHtml),
        materialHtml: safeHtml || undefined,
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

      {/* 与题库后台一致的前置字段 */}
      <div className="form-row">
        <div className="form-field">
          <label className="form-label">类别</label>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as BankCategory)} data-field="mistake-category">
            {BANK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label className="form-label">模块</label>
          <select className="select" value={module} onChange={(e) => setModule(e.target.value)} data-field="mistake-module">
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

      <div className="form-field">
        <label className="form-label">选项 <span className="small light">（先点输入框，再点「符号」即可在光标处插入 1、2、3 或 ①②③ 等序号）</span></label>
        <div className="form-row" style={{ gap: 8 }}>
          {OPTION_LETTERS.map((letter, index) => (
            <div className="row" key={letter} style={{ gap: 6 }}>
              <span className="chip" style={{ minWidth: 26, justifyContent: 'center' }}>{letter}</span>
              <input
                ref={(el) => { optionRefs.current[index] = el }}
                className="input"
                value={options[index] ?? ''}
                onFocus={() => { lastFocusedOption.current = index }}
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
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
          <SymbolPicker onPick={insertOptionSymbol} />
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
        <textarea
          className="textarea"
          value={analysis}
          onChange={(e) => setAnalysis(e.target.value)}
          placeholder="错因、正确思路、易错点…"
        />
      </div>

      <div className="form-field">
        <label className="form-label">题目图片（最多 8 张）</label>
        <label className="upload-zone">
          <Icon name="image" size={22} />
          <div style={{ marginTop: 6 }}>点击上传，或直接 <strong>Ctrl/⌘ + V</strong> 粘贴截图（自动识别）</div>
          <span className="form-hint">支持图形推理等题干长图，按原比例完整显示；PNG 无损保存在本机</span>
          <input type="file" accept="image/*" multiple onChange={handleImages} />
        </label>
        <QuestionImages
          images={images}
          altPrefix="题目图片"
          variant="thumb"
          className="question-images-form"
          renderActions={(index) => (
            <>
              <button
                type="button"
                className="btn btn-sm"
                style={{ padding: '3px 7px', fontSize: 'calc(11px * var(--font-scale))', background: 'rgba(255,255,255,.92)' }}
                disabled={ocrBusy}
                onClick={() => handleOcr(index)}
              >
                <Icon name="sparkle" size={12} /> OCR 识别
              </button>
              <button
                type="button"
                className="icon-btn danger"
                style={{ background: 'rgba(255,255,255,.92)' }}
                onClick={() => {
                  setImages((prev) => prev.filter((_, i) => i !== index))
                  // 重建原始图缓存索引，避免删除后错位
                  const nextSources: Record<number, string> = {}
                  let to = 0
                  for (let i = 0; i < 8; i++) {
                    if (i === index) continue
                    if (ocrSourcesRef.current[i] != null) nextSources[to] = ocrSourcesRef.current[i]
                    to++
                  }
                  ocrSourcesRef.current = nextSources
                }}
                aria-label="删除图片"
              >
                <Icon name="trash" size={13} />
              </button>
            </>
          )}
        />
        {ocrBusy && (
          <div className="ocr-status" style={{ marginTop: 10, marginBottom: 0 }}>
            <Icon name="sparkle" size={15} />
            <span>{ocrStage || '本地识别中'} {ocrProgress}%</span>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${ocrProgress}%` }} /></div>
          </div>
        )}
        <span className="form-hint" style={{ marginTop: 6 }}>
          支持直接 Ctrl/⌘ + V 粘贴截图，粘贴后自动上传并识别题干、选项与答案；首次 OCR 需下载中文语言包（约 15MB），结果请务必人工校对。
        </span>
      </div>

      <div className="form-section-divider"><span>错题库补充信息</span></div>
      <p className="form-hint" style={{ marginTop: -4, marginBottom: 10 }}>
        以下内容仅错题库存档使用；上方题目信息保存后会自动同步到题库后台。
      </p>

      <div className="form-field">
        <label className="form-label">掌握度</label>
        <select className="select" value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as Mastery)} data-field="mastery">
          {MASTERY_LEVELS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <span className="form-hint">新题目默认为「未掌握」；设为「已掌握」后保存将自动移入归档库，不再显示在错题库</span>
      </div>

      <CategoryFields
        categories={categories}
        type={type}
        categoryId={categoryId}
        subType={subType}
        point={point}
        linkMother={linkMother}
        onLinkMotherChange={(value) => {
          setLinkMother(value)
          if (!value) setMotherId('')
        }}
        onManage={() => setManaging(true)}
        onChange={(patch) => {
          setType(patch.type)
          setCategoryId(patch.categoryId)
          setSubType(patch.subType)
          setPoint(patch.point)
        }}
      />

      {linkMother && mothers.length > 0 && (
        <div className="form-field">
          <label className="form-label">指定母题</label>
          <select className="select" value={effectiveMotherId} onChange={(e) => setMotherId(e.target.value)}>
            {mothers.map((item) => (
              <option key={item.id} value={item.id}>{item.title.slice(0, 30)}{item.title.length > 30 ? '…' : ''}</option>
            ))}
          </select>
          <span className="form-hint">默认选中第一个母题，可手动切换；保存后与该母题关联</span>
        </div>
      )}

      <div className="form-field" style={{ maxWidth: 260 }}>
        <label className="form-label">我的答案（可选）</label>
        <input className="input" value={userAnswer} onChange={(e) => setUserAnswer(e.target.value)} placeholder="当时选了什么" />
      </div>

      <div className="form-field" style={{ maxWidth: 260 }}>
        <label className="form-label">自评正确率（可选）</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            type="number"
            min={0}
            max={100}
            step={1}
            value={accuracyInput}
            onChange={(e) => {
              const value = e.target.value
              if (value === '') { setAccuracyInput(''); return }
              const num = Number(value)
              if (Number.isFinite(num) && num >= 0 && num <= 100) setAccuracyInput(value)
            }}
            placeholder="0–100"
          />
          <span className="small muted" style={{ flex: '0 0 auto' }}>%</span>
        </div>
        <span className="form-hint">手动记录自评正确率，与刷题统计相互独立</span>
      </div>

      <div className="form-field">
        <label className="form-label">标签</label>
        <input className="input" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="用逗号分隔，如：削弱论证, 高频考点" />
        <span className="form-hint">多个标签用逗号、空格或换行分隔</span>
      </div>

      <div className="form-actions">
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" onClick={() => void handleSubmit()} disabled={saving}>
          <Icon name="save" size={16} /> {saving ? '保存中…' : initial ? '保存修改' : '录入错题'}
        </button>
      </div>

      {managing && <CategoryManager onClose={() => { setManaging(false); setCategories(readCategories()) }} />}
    </>
  )
}
