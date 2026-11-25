import { useEffect, useState } from 'react'
import { Icon } from './ui'

interface Props {
  src: string
  alt: string
  onClose: () => void
}

/** 公共大图灯箱：错题/母题图片与知识库图片共用，支持缩放、下载与 Esc 关闭。 */
export default function ImageLightbox({ src, alt, onClose }: Props) {
  const [zoom, setZoom] = useState(1)

  useEffect(() => { setZoom(1) }, [src])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === '+' || event.key === '=') setZoom((z) => Math.min(3, Math.round((z + 0.1) * 100) / 100))
      if (event.key === '-') setZoom((z) => Math.max(0.3, Math.round((z - 0.1) * 100) / 100))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="be-lightbox" role="dialog" aria-modal="true" aria-label={alt}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="be-lightbox-bar">
        <span className="be-lightbox-title">{alt || '图片'}</span>
        <div className="be-lightbox-actions">
          <button onClick={() => setZoom((z) => Math.max(0.3, Math.round((z - 0.1) * 100) / 100))} title="缩小">−</button>
          <button onClick={() => setZoom(1)} title="恢复 100%">{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 100) / 100))} title="放大">+</button>
          <a href={src} download={alt || 'image'} title="下载图片"><Icon name="download" size={16} /></a>
          <button onClick={onClose} title="关闭（Esc）"><Icon name="x" size={18} /></button>
        </div>
      </div>
      <div className="be-lightbox-body">
        <img src={src} alt={alt} style={{ zoom }} />
      </div>
    </div>
  )
}
