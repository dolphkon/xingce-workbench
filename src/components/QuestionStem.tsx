import QuestionImages from './QuestionImages'
import { formatQuestionText, questionCategory, stripImagePlaceholder } from '../lib/utils'

interface Props {
  /** 题干文本 */
  text: string
  /** 答案字母，用于推断单选题/多选题 */
  answer?: string
  /** 题库题等已有明确类别时直接指定，优先于答案推断 */
  category?: '单选题' | '多选题'
  /** 题目图片：放在题干下方，与类别标签右侧（即题干文字起点）对齐 */
  images?: string[]
  /** 图片无障碍前缀 */
  altPrefix?: string
  className?: string
}

/**
 * 题干统一展示：在题干前渲染类别标签（单选题/多选题），再渲染格式化后的题干。
 * 布局采用两列网格：左列为类别标签，右列为题干文字与图片，
 * 因此图片位于题干下方且左边缘与类别标签右侧对齐。
 * 用于错题详情、专项刷题、试卷刷题、母题详情等所有题干展示位置，保证一致。
 */
export default function QuestionStem({ text, answer, category, images, altPrefix = '题目图片', className = '' }: Props) {
  const label = category ?? questionCategory(answer)
  return (
    <div className={`question-text stem-with-category ${className}`.trim()}>
      <span className={`stem-category${label === '多选题' ? ' stem-category-multi' : ''}`}>{label}</span>
      <span className="stem-category-text">{formatQuestionText(stripImagePlaceholder(text))}</span>
      {!!images?.length && (
        <QuestionImages images={images} altPrefix={altPrefix} className="question-images-section stem-images" />
      )}
    </div>
  )
}
