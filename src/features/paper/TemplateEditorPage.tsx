import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Icon } from '../../components/ui'
import {
  draftToMarkdown, markdownToDraft, moduleToSection, splitTemplateQuestion,
  templateGroups, templateStats, type TemplateDraft, type TemplateQuestion,
} from '../../lib/templateDraft'

const MODULE_OPTIONS = ['政治理论', '常识', '言语理解', '数量关系', '判断推理', '资料分析', '其他']
const ANSWER_LETTERS = ['A', 'B', 'C', 'D']

function imageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}

/**
 * 结构化套卷模版编辑器。
 * 目录、字段编辑、卷面预览全部由同一份 TemplateDraft 驱动，
 * 不再展示 Markdown 原文，也不再对同一文本做二次解析。
 */
export default function TemplateEditorPage({
  draft,
  onChange,
  onBack,
  onGenerate,
  generating,
  onRefill,
  refilling,
  onUploadMd,
}: {
  draft: TemplateDraft
  onChange: (draft: TemplateDraft) => void
  onBack: () => void
  onGenerate: () => void
  generating: boolean
  onRefill: () => void
  refilling: boolean
  onUploadMd: (file: File) => void
}) {
  const mdInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [activeKey, setActiveKey] = useState('')
  const [textMode, setTextMode] = useState(false)
  const [textValue, setTextValue] = useState('')
  const [zoomImage, setZoomImage] = useState<string | null>(null)
  const [imageError, setImageError] = useState('')
  const [insertTarget, setInsertTarget] = useState<string | null>(null)

  const groups = useMemo(() => templateGroups(draft), [draft])
  const stats = useMemo(() => templateStats(draft), [draft])
  const activeGroup = groups.find((group) => group.key === activeKey) ?? groups[0]
  const activeQuestions = (activeGroup?.ids ?? [])
    .map((id) => draft.questions.find((question) => question.id === id))
    .filter((question): question is TemplateQuestion => Boolean(question))

  useEffect(() => {
    if (textMode) setTextValue(draftToMarkdown(draft))
  }, [textMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: string, changes: Partial<TemplateQuestion>) => {
    const target = draft.questions.find((question) => question.id === id)
    onChange({
      ...draft,
      questions: draft.questions.map((question) => question.id === id
        ? { ...question, ...changes, origin: changes.origin ?? 'manual' }
        : question),
    })
    // 部分/页码变化会让当前分组 key 失效，跟随该移动到新分组，避免编辑器跳回第一页
    if (target && (changes.section !== undefined || changes.page !== undefined)) {
      setActiveKey(`${changes.section ?? target.section}|${changes.page ?? target.page}`)
    }
  }

  const move = (id: string, delta: number) => {
    const from = draft.questions.findIndex((question) => question.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= draft.questions.length) return
    const questions = [...draft.questions]
    const [item] = questions.splice(from, 1)
    questions.splice(to, 0, { ...item, origin: 'manual' })
    onChange({ ...draft, questions })
  }

  const remove = (id: string) => {
    onChange({ ...draft, questions: draft.questions.filter((question) => question.id !== id) })
  }

  const addQuestion = () => {
    const maxNo = activeQuestions.reduce((max, question) => Math.max(max, question.no), 0)
    const index = activeGroup
      ? draft.questions.findIndex((question) => question.id === activeGroup.ids[activeGroup.ids.length - 1]) + 1
      : draft.questions.length
    const question: TemplateQuestion = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      no: maxNo + 1,
      paper: 1,
      section: activeGroup?.section || '常识判断',
      module: '常识',
      page: activeGroup?.page ?? 1,
      material: '',
      stem: '',
      options: ['', '', '', ''],
      answer: '',
      analysis: '',
      images: [],
      source: '',
      origin: 'manual',
    }
    const questions = [...draft.questions]
    questions.splice(index < 0 ? questions.length : index, 0, question)
    onChange({ ...draft, questions })
    setActiveKey(`${question.section}|${question.page}`)
  }

  const splitQuestion = (id: string) => {
    const next = splitTemplateQuestion(draft, id)
    if (next === draft) setImageError('该题目内未发现可拆分的题号，可先手动添加题号后再拆分')
    else onChange(next)
  }

  const toggleAnswer = (question: TemplateQuestion, letter: string) => {
    const current = question.answer.replace(new RegExp(letter, 'g'), '')
    const next = current === question.answer ? current : `${current}${letter}`
    patch(question.id, { answer: ANSWER_LETTERS.filter((item) => next.includes(item)).join('') })
  }

  const insertImage = async (file: File | undefined) => {
    if (!file) return
    setImageError('')
    try {
      const dataUrl = await imageToDataUrl(file)
      const target = insertTarget ?? activeQuestions[0]?.id
      const question = draft.questions.find((item) => item.id === target)
      if (!question) return
      patch(question.id, { images: [...question.images, dataUrl] })
    } catch (err) {
      setImageError(err instanceof Error ? err.message : '图片插入失败')
    }
  }

  const applyText = () => {
    try {
      const next = markdownToDraft(textValue, draft)
      if (!next.questions.length) throw new Error('文本中没有识别到题块')
      onChange(next)
      setActiveKey('')
      setTextMode(false)
    } catch (err) {
      setImageError(err instanceof Error ? err.message : '文本应用失败')
    }
  }

  const download = () => {
    const blob = new Blob([draftToMarkdown(draft)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${draft.title || '试卷'}-套卷模板.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  const originLabel = (origin: TemplateQuestion['origin']) => origin === 'ai' ? 'AI 填充' : origin === 'manual' ? '人工编辑' : '规则拆题'

  return (
    <div className="te-page document-to-paper-page">
      <div className="te-head">
        <div>
          <button className="btn btn-sm" onClick={onBack}><Icon name="back" size={14} /> 返回题库管理</button>
          <h2>结构化套卷模版编辑器</h2>
          <p className="muted small">
            {draft.title || draft.fileName} · {stats.sections} 个部分 / {stats.pages} 页 / <b>{stats.questions}</b> 题
            {' · '}{draft.usedLlm ? 'AI 已填充字段' : '规则拆题字段'}
            {draft.usedOcr ? ' · OCR' : ''}
          </p>
        </div>
        <div className="te-head-actions">
          <button className="btn btn-sm" disabled={refilling || generating} onClick={onRefill}>
            <Icon name="sparkle" size={14} /> {refilling ? 'AI 填充中…' : 'AI 重新填充'}
          </button>
          <button className="btn btn-sm" onClick={() => mdInputRef.current?.click()}><Icon name="upload" size={14} /> 导入 .md</button>
          <button className="btn btn-sm" onClick={download}><Icon name="download" size={14} /> 下载 .md</button>
          <button className="btn btn-sm" onClick={() => setTextMode((value) => !value)}><Icon name="filetext" size={14} /> {textMode ? '返回结构化编辑' : '文本视图'}</button>
          <button className="btn btn-primary" disabled={generating || refilling || !draft.questions.length} onClick={onGenerate}>
            <Icon name="check" size={15} /> {generating ? '生成中…' : '生成套卷'}
          </button>
        </div>
      </div>

      {!draft.usedLlm && draft.llmMessage && (
        <div className="op-notice warn"><Icon name="info" size={15} /> {draft.llmMessage}。规则已拆出题槽，你仍可人工校对并生成套卷。</div>
      )}
      {imageError && <div className="op-notice warn"><Icon name="alert" size={15} /> {imageError}</div>}

      <div className="te-tip">
        <Icon name="info" size={15} />
        <span>
          题号来自原文锚点，一题一槽；AI 只回填字段，不会把多道题并进同一题。左侧切换部分/页，中间逐题校对，右侧即改即预览。
        </span>
      </div>

      <input ref={mdInputRef} type="file" accept=".md,.markdown,text/markdown,text/plain" hidden
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0]
          if (file) onUploadMd(file)
          event.target.value = ''
        }} />
      <input ref={imageInputRef} type="file" accept="image/*" hidden
        onChange={(event) => { void insertImage(event.target.files?.[0]); event.target.value = '' }} />

      {textMode ? (
        <div className="te-text-mode">
          <div className="te-text-head">
            <b>高级：套卷 Markdown 文本</b>
            <span className="muted small">修改后点「应用文本」会按题号重新生成题槽并分配新的编辑 ID</span>
          </div>
          <textarea className="te-textarea" value={textValue} onChange={(event) => setTextValue(event.target.value)} spellCheck={false} />
          <div className="te-text-actions">
            <button className="btn btn-sm" onClick={() => setTextValue(draftToMarkdown(draft))}>还原当前模版</button>
            <button className="btn btn-primary btn-sm" onClick={applyText}>应用文本</button>
          </div>
        </div>
      ) : (
        <div className="te-layout">
          <aside className="te-sidebar">
            <div className="te-sidebar-title"><Icon name="list" size={14} /> 试卷目录</div>
            {groups.length === 0 && <div className="muted small te-empty">暂无题目，可手动添加</div>}
            {Array.from(new Set(groups.map((group) => group.section))).map((section) => (
              <div className="te-section" key={section}>
                <div className="te-section-name">{section || '未分组'}</div>
                {groups.filter((group) => group.section === section).map((group) => (
                  <button
                    key={group.key}
                    className={`te-page-tab${activeGroup?.key === group.key ? ' active' : ''}`}
                    onClick={() => setActiveKey(group.key)}
                  >
                    <span>第 {group.page} 页</span><span className="te-count">{group.ids.length} 题</span>
                  </button>
                ))}
              </div>
            ))}
          </aside>

          <section className="te-editor">
            <div className="te-editor-head">
              <div>
                <h3>第 {activeGroup?.page ?? 1} 页 · {activeGroup?.section || '未分组'}</h3>
                <p className="muted small">共 {activeQuestions.length} 题，字段修改即时同步到卷面预览</p>
              </div>
              <button className="btn btn-sm" onClick={addQuestion}><Icon name="plus" size={14} /> 添加题目</button>
            </div>

            {activeQuestions.map((question, index) => (
              <article className="te-question-card" key={question.id} data-question-id={question.id}>
                <div className="te-question-head">
                  <label className="te-no">第 <input type="number" min={1} max={300} value={question.no}
                    onChange={(event) => patch(question.id, { no: Number(event.target.value) || 1 })} /> 题</label>
                  <select className="te-select" value={question.module}
                    onChange={(event) => patch(question.id, {
                      module: event.target.value,
                      section: moduleToSection(event.target.value),
                    })}>
                    {MODULE_OPTIONS.map((module) => <option key={module} value={module}>{module}</option>)}
                  </select>
                  <span className={`te-origin te-origin-${question.origin}`}>{originLabel(question.origin)}</span>
                  <span className="te-spacer" />
                  <button className="icon-btn" title="上移" disabled={index === 0} onClick={() => move(question.id, -1)}>↑</button>
                  <button className="icon-btn" title="下移" disabled={index === activeQuestions.length - 1} onClick={() => move(question.id, 1)}>↓</button>
                  <button className="btn btn-sm" onClick={() => splitQuestion(question.id)} title="按原文题号拆开粘连题块">拆分题块</button>
                  <button className="icon-btn danger" title="删除本题" onClick={() => remove(question.id)}><Icon name="trash" size={14} /></button>
                </div>

                <div className="te-fields">
                  <label className="te-field te-field-wide">
                    <span>部分标题</span>
                    <input value={question.section} onChange={(event) => patch(question.id, { section: event.target.value })} />
                  </label>
                  <label className="te-field">
                    <span>页码</span>
                    <input type="number" min={1} value={question.page} onChange={(event) => patch(question.id, { page: Number(event.target.value) || 1 })} />
                  </label>
                  <label className="te-field te-field-wide">
                    <span>共用材料</span>
                    <textarea rows={2} value={question.material} placeholder="设问前的背景材料，可留空"
                      onChange={(event) => patch(question.id, { material: event.target.value })} />
                  </label>
                  <label className="te-field te-field-wide">
                    <span>题干 / 设问</span>
                    <textarea rows={3} value={question.stem} placeholder="本题设问"
                      onChange={(event) => patch(question.id, { stem: event.target.value })} />
                  </label>
                  {ANSWER_LETTERS.map((letter, optionIndex) => (
                    <label className="te-field te-option" key={letter}>
                      <span>{letter}</span>
                      <input value={question.options[optionIndex] ?? ''}
                        onChange={(event) => {
                          const options = [...question.options]
                          options[optionIndex] = event.target.value
                          patch(question.id, { options })
                        }} />
                    </label>
                  ))}
                  <div className="te-field te-field-wide">
                    <span>正确答案</span>
                    <div className="te-answer-buttons">
                      {ANSWER_LETTERS.map((letter) => (
                        <button key={letter}
                          className={`te-answer-chip${question.answer.includes(letter) ? ' active' : ''}`}
                          onClick={() => toggleAnswer(question, letter)}>{letter}</button>
                      ))}
                      <input className="te-answer-input" value={question.answer} placeholder="可留空，如 AB"
                        onChange={(event) => patch(question.id, { answer: event.target.value.toUpperCase().replace(/[^A-D]/g, '') })} />
                    </div>
                  </div>
                  <label className="te-field te-field-wide">
                    <span>解析</span>
                    <textarea rows={2} value={question.analysis} placeholder="原文解析，可留空"
                      onChange={(event) => patch(question.id, { analysis: event.target.value })} />
                  </label>
                  <div className="te-field te-field-wide">
                    <span>材料图片</span>
                    <div className="te-images">
                      {question.images.map((image, imageIndex) => (
                        <span className="te-image-thumb" key={`${image.slice(0, 40)}-${imageIndex}`}>
                          <img src={image} alt={`材料图 ${imageIndex + 1}`} onClick={() => setZoomImage(image)} />
                          <button className="icon-btn danger" title="移除图片"
                            onClick={() => patch(question.id, { images: question.images.filter((_, i) => i !== imageIndex) })}>
                            <Icon name="x" size={12} />
                          </button>
                        </span>
                      ))}
                      <button className="btn btn-sm" onClick={() => { setInsertTarget(question.id); imageInputRef.current?.click() }}>
                        <Icon name="image" size={14} /> 添加图片
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
            {!activeQuestions.length && <div className="te-empty">本页暂无题目，点击「添加题目」开始。</div>}
          </section>

          <aside className="te-preview">
            <div className="te-preview-head"><Icon name="eye" size={15} /> 卷面预览 · 第 {activeGroup?.page ?? 1} 页</div>
            {activeQuestions.map((question) => (
              <div className="te-preview-question" key={question.id}>
                <div className="te-preview-no">第 {question.no} 题{question.answer ? `（答案 ${question.answer}）` : ''}</div>
                {question.material && <div className="te-preview-material">{question.material}</div>}
                <div className="te-preview-stem">{question.stem}</div>
                {question.images.map((image, index) => (
                  <img className="te-preview-image" key={`${image.slice(0, 40)}-${index}`} src={image} alt={`材料图 ${index + 1}`} />
                ))}
                <div className="te-preview-options">
                  {question.options.map((option, index) => option && (
                    <div key={index}>{ANSWER_LETTERS[index]}. {option}</div>
                  ))}
                </div>
                {question.analysis && <div className="te-preview-analysis">解析：{question.analysis}</div>}
              </div>
            ))}
            {!activeQuestions.length && <div className="muted small te-empty">预览随编辑实时更新</div>}
          </aside>
        </div>
      )}

      {zoomImage && (
        <div className="te-lightbox" onClick={() => setZoomImage(null)}>
          <img src={zoomImage} alt="材料图放大" />
        </div>
      )}
    </div>
  )
}
