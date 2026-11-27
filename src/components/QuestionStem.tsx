import { formatQuestionText, questionCategory } from '../lib/utils'

interface Props {
  /** 题干文本 */
  text: string
  /** 答案字母，用于推断单选题/多选题 */
  answer?: string
  /** 题库题等已有明确类别时直接指定，优先于答案推断 */
  category?: '单选题' | '多选题'
  className?: string
}

/**
 * 题干统一展示：在题干前渲染类别标签（单选题/多选题），再渲染格式化后的题干。
 * 用于错题详情、专项刷题、试卷刷题、母题详情等所有题干展示位置，保证一致。
 */
export default function QuestionStem({ text, answer, category, className = '' }: Props) {
  const label = category ?? questionCategory(answer)
  return (
    <div className={`question-text ${className}`.trim()}>
      <span className={`stem-category${label === '多选题' ? ' stem-category-multi' : ''}`}>{label}</span>
      <span className="stem-category-text">{formatQuestionText(text)}</span>
    </div>
  )
}
