import QuestionImages from '../../components/QuestionImages'
import { Icon } from '../../components/ui'
import { formatQuestionText, questionCategory, splitQuizTitle, stripImagePlaceholder } from '../../lib/utils'
import type { QuizQuestion } from '../../types'

interface Props {
  question: QuizQuestion
  index: number
  confirmed?: boolean
  onConfirm?: () => void
  onReview?: () => void
  onViewJson?: () => void
  onEditBank?: () => void
  onDelete?: () => void
  onToggleFavorite?: () => void
}

/** 试卷题目卡片：与题库管理「图片识别入库」结果保持同一套版式与操作区 */
export default function PaperQuestionCard({
  question, index, confirmed, onConfirm, onReview, onViewJson, onEditBank, onDelete, onToggleFavorite,
}: Props) {
  const { material, stem } = splitQuizTitle(question.title)
  const category = questionCategory(question.answer)
  const filled = question.options.map((option, i) => ({ option, i })).filter((item) => item.option.trim())
  const images = question.images ?? []

  return (
    <div className={`bank-item paper-q-card${confirmed ? ' confirmed' : ''}${question.favorite ? ' favorited' : ''}`}>
      <div className="bank-item-head">
        <span className="chip chip-primary">{index + 1}</span>
        <span className={`chip ${category === '多选题' ? 'chip-warning' : 'chip-primary'}`}>{category}</span>
        {question.type && question.type !== category && <span className="chip">{question.type}</span>}
        <span className={`chip ${question.answer ? 'chip-success' : 'chip-warning'}`}>答案 {question.answer || '未识别'}</span>
        {question.page ? <span className="chip">第 {question.page} 页</span> : null}
        {question.section ? <span className="chip">{question.section}</span> : null}
        {images.length > 0 && <span className="chip"><Icon name="image" size={11} /> {images.length}</span>}
        {confirmed && <span className="paper-q-confirmed"><Icon name="check" size={12} /> 已确认</span>}
        <span className="paper-q-id" title={question.id}>ID {question.id.slice(0, 8)}…</span>
      </div>

      {material && <div className="bank-item-material">{formatQuestionText(material).replace(/\n/g, ' ').slice(0, 240)}</div>}
      {images.length > 0 && <QuestionImages images={images} altPrefix={`第 ${index + 1} 题`} variant="thumb" className="question-images-section stem-images" />}
      <div className="bank-item-stem paper-q-stem"><b>{index + 1}.</b> {formatQuestionText(stripImagePlaceholder(stem))}</div>
      <div className="bank-item-options">
        {filled.length > 0
          ? filled.map(({ option, i }) => <span key={i}>{String.fromCharCode(65 + i)}. {option}</span>)
          : <span className="muted">（未识别到选项，请校对补充）</span>}
      </div>
      {question.analysis && <div className="paper-q-analysis">解析：{question.analysis}</div>}

      <div className="bank-item-actions">
        {onReview && <button className="btn btn-sm" onClick={onReview}><Icon name="edit" size={13} /> 校对</button>}
        {!confirmed && onConfirm && <button className="btn btn-sm btn-primary" onClick={onConfirm}><Icon name="check" size={13} /> 确认无误</button>}
        {onViewJson && <button className="btn btn-sm" onClick={onViewJson}><Icon name="filetext" size={13} /> 查看 JSON</button>}
        {onEditBank && <button className="btn btn-sm" onClick={onEditBank}><Icon name="database" size={13} /> 编辑题库</button>}
        {onToggleFavorite && (
          <button className={`icon-btn${question.favorite ? ' starred' : ''}`} title={question.favorite ? '取消收藏' : '收藏此题'} onClick={onToggleFavorite}>
            <Icon name="star" size={15} />
          </button>
        )}
        {onDelete && <button className="icon-btn danger" title="删除此题" onClick={onDelete}><Icon name="trash" size={15} /></button>}
      </div>
    </div>
  )
}
