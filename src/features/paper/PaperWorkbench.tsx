import { useEffect, useState } from 'react'
import { ConfirmDialog, Icon } from '../../components/ui'
import QuestionImages from '../../components/QuestionImages'
import { formatQuestionText, questionCategory, stripImagePlaceholder, uid } from '../../lib/utils'
import type { Paper, QuizQuestion } from '../../types'
import QuestionReviewModal from './QuestionReviewModal'

/** 把题干拆成「共用材料 / 题目正文」两段 */
function splitStem(title: string): { material: string; stem: string } {
  const parts = title.split('【题目】')
  if (parts.length === 2) {
    return { material: parts[0].replace(/^【共用材料】/, '').trim(), stem: parts[1].trim() }
  }
  return { material: '', stem: title.trim() }
}

interface Props {
  papers: Paper[]
  activeId: string | null
  onSelect: (id: string) => void
  onStartExam: (paper: Paper) => void
  onShowHistory: (paperId: string) => void
  onDeletePaper: (paper: Paper) => void
  onRenamePaper: (paper: Paper, title: string) => void
  onSaveQuestion: (paper: Paper, index: number | null, question: QuizQuestion) => void
  onDeleteQuestion: (paper: Paper, index: number) => void
  onToggleFavorite: (paper: Paper, index: number) => void
  onExportPaper: (paper: Paper) => void
  onUpload: () => void
}

/**
 * 我的试卷后台工作台：
 * 左侧套题列表，右侧为选中试卷的后台编辑管理（逐题查看/校对/收藏/增删）。
 */
export default function PaperWorkbench({
  papers, activeId, onSelect, onStartExam, onShowHistory, onDeletePaper,
  onRenamePaper, onSaveQuestion, onDeleteQuestion, onToggleFavorite, onExportPaper, onUpload,
}: Props) {
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [editing, setEditing] = useState<{ index: number | null; question: QuizQuestion } | null>(null)
  const [confirmDelQ, setConfirmDelQ] = useState<number | null>(null)

  const active = papers.find((paper) => paper.id === activeId) ?? null

  useEffect(() => { setRenaming(false); setEditing(null); setConfirmDelQ(null) }, [activeId])

  const startRename = () => {
    if (!active) return
    setRenameValue(active.title)
    setRenaming(true)
  }
  const commitRename = () => {
    if (active && renameValue.trim() && renameValue.trim() !== active.title) onRenamePaper(active, renameValue.trim())
    setRenaming(false)
  }

  const addQuestion = () => {
    const blank: QuizQuestion = { id: uid(), title: '', options: ['', '', '', ''], answer: '', analysis: '', type: '' }
    setEditing({ index: null, question: blank })
  }

  return (
    <section className="op-section">
      <div className="op-section-head">
        <h2>我的试卷 <span className="op-count">{papers.length}</span></h2>
        <span className="pw-head-hint muted small">点击左侧套卷，在右侧校对与管理题目</span>
        <button className="btn btn-sm pw-head-upload" onClick={onUpload}><Icon name="upload" size={14} /> 上传文档</button>
      </div>

      {papers.length === 0 ? (
        <div className="op-empty">
          <Icon name="filetext" size={30} />
          <p>还没有试卷。上传一份 PDF 或 Word 文档开始吧。</p>
          <button className="btn btn-primary" onClick={onUpload}><Icon name="upload" size={15} /> 上传文档</button>
        </div>
      ) : (
        <div className="pw-workbench">
          {/* 左侧：套题列表 */}
          <aside className="pw-sidebar">
            <div className="pw-sidebar-title"><Icon name="layers" size={14} /> 套题列表</div>
            <div className="pw-paper-list">
              {papers.map((paper) => (
                <button
                  key={paper.id}
                  className={`pw-paper-item${paper.id === activeId ? ' active' : ''}`}
                  onClick={() => onSelect(paper.id)}
                >
                  <span className="pw-paper-item-title">{paper.title}</span>
                  <span className="pw-paper-item-meta">{paper.questionCount} 题 · {paper.fileName || '文档'}</span>
                </button>
              ))}
            </div>
            <button className="pw-sidebar-add" onClick={onUpload}><Icon name="plus" size={14} /> 导入新试卷</button>
          </aside>

          {/* 右侧：该套卷后台编辑管理 */}
          <div className="pw-detail">
            {!active ? (
              <div className="pw-detail-empty"><Icon name="layers" size={28} /><p>从左侧选择一套试卷开始校对管理</p></div>
            ) : (
              <>
                <div className="pw-detail-head">
                  <div className="pw-detail-title-wrap">
                    {renaming ? (
                      <input
                        className="input pw-rename-input"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }}
                      />
                    ) : (
                      <h3 className="pw-detail-title" onDoubleClick={startRename} title="双击重命名">{active.title}</h3>
                    )}
                    <div className="pw-detail-sub muted small">
                      {active.questionCount} 道题 · 识别：{active.parseMethod || '—'}
                    </div>
                  </div>
                  <div className="pw-detail-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => onStartExam(active)}><Icon name="play" size={14} /> 开始刷题</button>
                    <button className="btn btn-sm" onClick={() => onShowHistory(active.id)}><Icon name="clock" size={14} /> 历史</button>
                    <button className="icon-btn" title="重命名" onClick={startRename}><Icon name="edit" size={15} /></button>
                    <button className="icon-btn" title="导出 JSON" onClick={() => onExportPaper(active)}><Icon name="download" size={15} /></button>
                    <button className="icon-btn danger" title="删除试卷" onClick={() => onDeletePaper(active)}><Icon name="trash" size={15} /></button>
                  </div>
                </div>

                <div className="pw-questions">
                  {active.questions.map((question, index) => {
                    const parsed = splitStem(question.title)
                    const category = questionCategory(question.answer)
                    const filled = question.options.map((option, i) => ({ option, i })).filter((item) => item.option.trim())
                    return (
                      <div className={`pw-question${question.favorite ? ' favorited' : ''}`} key={question.id || index}>
                        <div className="pw-question-head">
                          <span className="pw-q-num">{index + 1}.</span>
                          <span className={`stem-category${category === '多选题' ? ' stem-category-multi' : ''}`}>{category}</span>
                          {question.page ? <span className="chip">第 {question.page} 页</span> : null}
                          {question.section ? <span className="chip">{question.section}</span> : null}
                          {question.favorite && <span className="pw-q-fav-flag"><Icon name="star" size={12} /> 已收藏</span>}
                          <span className="spacer" />
                          <button
                            className={`icon-btn${question.favorite ? ' starred' : ''}`}
                            title={question.favorite ? '取消收藏' : '收藏此题'}
                            onClick={() => onToggleFavorite(active, index)}
                          ><Icon name="star" size={15} /></button>
                          <button className="icon-btn" title="校对编辑" onClick={() => setEditing({ index, question })}><Icon name="edit" size={15} /></button>
                          <button className="icon-btn danger" title="删除此题" onClick={() => setConfirmDelQ(index)}><Icon name="trash" size={15} /></button>
                        </div>
                        {parsed.material && (
                          <div className="pw-q-material">
                            <div className="op-material-label">共用材料</div>
                            <div className="op-preserve">{parsed.material}</div>
                          </div>
                        )}
                        <div className="pw-q-stem op-preserve">{formatQuestionText(stripImagePlaceholder(parsed.stem))}</div>
                        {!!question.images?.length && (
                          <QuestionImages images={question.images} altPrefix={`第 ${index + 1} 题`} variant="thumb" className="question-images-section stem-images" />
                        )}
                        <div className="pw-q-options">
                          {filled.length > 0 ? filled.map(({ option, i }) => (
                            <div className="pw-q-option" key={i}>
                              <span className="op-option-key">{String.fromCharCode(65 + i)}</span>
                              <span className="op-preserve">{option}</span>
                            </div>
                          )) : <span className="muted small">（未识别到选项，请校对补充）</span>}
                        </div>
                        <div className={`pw-q-answer${question.answer ? '' : ' missing'}`}>
                          正确答案：<b>{question.answer || '未识别 · 请校对填写'}</b>
                        </div>
                        {question.analysis && <div className="pr-analysis">{question.analysis}</div>}
                      </div>
                    )
                  })}
                  <button className="pw-add-question" onClick={addQuestion}><Icon name="plus" size={15} /> 添加题目</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {editing && active && (
        <QuestionReviewModal
          question={editing.question}
          index={editing.index === null ? active.questions.length : editing.index}
          onClose={() => setEditing(null)}
          onDelete={() => {
            if (editing.index !== null) onDeleteQuestion(active, editing.index)
            setEditing(null)
          }}
          onSave={(next) => { onSaveQuestion(active, editing.index, next); setEditing(null) }}
        />
      )}

      {confirmDelQ !== null && active && (
        <ConfirmDialog
          message={`确定删除第 ${confirmDelQ + 1} 题吗？`}
          onCancel={() => setConfirmDelQ(null)}
          onConfirm={() => { onDeleteQuestion(active, confirmDelQ); setConfirmDelQ(null) }}
        />
      )}
    </section>
  )
}
