import { useEffect, useState } from 'react'
import { ConfirmDialog, Icon, Modal } from '../../components/ui'
import { put } from '../../lib/db'
import { bankQuestionToQuiz, quizToBankQuestion } from '../../lib/bankSync'
import { uid } from '../../lib/utils'
import type { BankQuestion, Paper, QuizQuestion } from '../../types'
import BankForm from '../bank/BankForm'
import AnswerManager from '../bank/AnswerManager'
import PaperQuestionCard from './PaperQuestionCard'
import QuestionReviewModal from './QuestionReviewModal'

interface Props {
  papers: Paper[]
  activeId: string | null
  onSelect: (id: string) => void
  onStartExam: (paper: Paper) => void
  onShowHistory: (paperId: string) => void
  onDeletePaper: (paper: Paper) => void
  onRenamePaper: (paper: Paper, title: string) => void
  onSaveQuestion: (paper: Paper, index: number | null, question: QuizQuestion) => void
  onSaveAnswers: (paper: Paper, answers: Record<string, string>) => void | Promise<void>
  onDeleteQuestion: (paper: Paper, index: number) => void
  onToggleFavorite: (paper: Paper, index: number) => void
  onExportPaper: (paper: Paper) => void
  onUpload: () => void
}

/**
 * 我的试卷后台工作台：
 * 左侧套题列表，右侧逐题校对与管理；题目卡片与题库管理入库卡片同一版式，
 * 每题可查看 JSON、编辑题库，整卷在开始刷题处推送到在线刷题。
 */
export default function PaperWorkbench({
  papers, activeId, onSelect, onStartExam, onShowHistory, onDeletePaper,
  onRenamePaper, onSaveQuestion, onSaveAnswers, onDeleteQuestion, onToggleFavorite, onExportPaper, onUpload,
}: Props) {
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [editing, setEditing] = useState<{ index: number | null; question: QuizQuestion } | null>(null)
  const [confirmDelQ, setConfirmDelQ] = useState<number | null>(null)
  const [jsonIndex, setJsonIndex] = useState<number | null>(null)
  const [editingBank, setEditingBank] = useState<{ index: number; initial: BankQuestion } | null>(null)
  const [answerManagerOpen, setAnswerManagerOpen] = useState(false)

  const active = papers.find((paper) => paper.id === activeId) ?? null

  useEffect(() => { setRenaming(false); setEditing(null); setConfirmDelQ(null); setJsonIndex(null); setEditingBank(null); setAnswerManagerOpen(false) }, [activeId])

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
        <button className="btn btn-sm pw-head-upload" onClick={onUpload}><Icon name="layers" size={14} /> 智能组卷</button>
      </div>

      {papers.length === 0 ? (
        <div className="op-empty">
          <Icon name="filetext" size={30} />
          <p>还没有试卷。到题库管理页用智能组卷生成一套试卷吧。</p>
          <button className="btn btn-primary" onClick={onUpload}><Icon name="upload" size={15} /> 去题库管理</button>
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
            <button className="pw-sidebar-add" onClick={onUpload}><Icon name="plus" size={14} /> 智能组卷</button>
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
                    <button className="btn btn-sm" onClick={() => setAnswerManagerOpen(true)} title="批量导入 / 导出本卷答案"><Icon name="check" size={14} /> 答案管理</button>
                    <button className="btn btn-sm" onClick={() => onShowHistory(active.id)}><Icon name="clock" size={14} /> 历史</button>
                    <button className="icon-btn" title="重命名" onClick={startRename}><Icon name="edit" size={15} /></button>
                    <button className="icon-btn" title="导出 JSON" onClick={() => onExportPaper(active)}><Icon name="download" size={15} /></button>
                    <button className="icon-btn danger" title="删除试卷" onClick={() => onDeletePaper(active)}><Icon name="trash" size={15} /></button>
                  </div>
                </div>

                <div className="pw-questions">
                  {active.questions.map((question, index) => (
                    <PaperQuestionCard
                      key={question.id || index}
                      question={question}
                      index={index}
                      onReview={() => setEditing({ index, question })}
                      onViewJson={() => setJsonIndex(index)}
                      onEditBank={() => setEditingBank({ index, initial: quizToBankQuestion(question) })}
                      onDelete={() => setConfirmDelQ(index)}
                      onToggleFavorite={() => onToggleFavorite(active, index)}
                    />
                  ))}
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

      {jsonIndex !== null && active?.questions[jsonIndex] && (
        <Modal
          title={`第 ${jsonIndex + 1} 题 JSON`}
          onClose={() => setJsonIndex(null)}
          footer={<button className="btn" onClick={() => setJsonIndex(null)}>关闭</button>}
        >
          <pre className="bank-json-view">{JSON.stringify(active.questions[jsonIndex], null, 2)}</pre>
        </Modal>
      )}

      {editingBank && active && (
        <Modal title={`编辑题库 · 第 ${editingBank.index + 1} 题`} onClose={() => setEditingBank(null)} wide>
          <BankForm
            initial={editingBank.initial}
            onCancel={() => setEditingBank(null)}
            onSaved={async (q) => {
              await put('bank', q)
              onSaveQuestion(active, editingBank.index, bankQuestionToQuiz(q, active.questions[editingBank.index]))
              setEditingBank(null)
            }}
          />
        </Modal>
      )}

      {answerManagerOpen && active && (
        <AnswerManager
          title={`答案管理 · ${active.title}`}
          targets={active.questions.map((question, index) => ({
            id: question.id,
            no: question.no ?? index + 1,
            title: question.title,
            answer: question.answer,
          }))}
          onClose={() => setAnswerManagerOpen(false)}
          onApply={(answers) => onSaveAnswers(active, answers)}
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
