import { useState, type ReactNode } from 'react'
import ImageLightbox from './ImageLightbox'

interface Props {
  images: string[]
  altPrefix?: string
  /** detail：详情页/练习页完整大图；thumb：录入表单缩略图 */
  variant?: 'detail' | 'thumb'
  className?: string
  /** 每张图下方的自定义操作区（如 OCR / 删除按钮） */
  renderActions?: (index: number) => ReactNode
}

/**
 * 题目图片统一展示：图片按原始比例完整显示（object-fit: contain），
 * 不会再因固定高度 + cover 裁掉图形推理题两侧的 A/B/C/D 选项；点击可开灯箱看大图。
 */
export default function QuestionImages({
  images, altPrefix = '题目图片', variant = 'detail', className = '', renderActions,
}: Props) {
  const [viewing, setViewing] = useState<number | null>(null)

  if (!images?.length) return null

  return (
    <>
      <div className={`question-images question-images-${variant} ${className}`.trim()}>
        {images.map((image, index) => {
          const alt = `${altPrefix} ${index + 1}`
          return (
            <div className="question-image-item" key={`${image.slice(0, 40)}-${index}`}>
              <button type="button" className="question-image-view" onClick={() => setViewing(index)} title="点击查看大图">
                <img src={image} alt={alt} />
                <span className="question-image-zoom">查看大图</span>
              </button>
              {renderActions && <div className="question-image-actions">{renderActions(index)}</div>}
            </div>
          )
        })}
      </div>
      {viewing !== null && images[viewing] && (
        <ImageLightbox src={images[viewing]} alt={`${altPrefix} ${viewing + 1}`} onClose={() => setViewing(null)} />
      )}
    </>
  )
}
