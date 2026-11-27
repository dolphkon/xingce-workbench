import { useEffect, useMemo, useState } from 'react'
import type { ParseProgress, ParseStage } from '../lib/paperParser'
import { formatClock } from '../lib/utils'

const STAGE_LABEL: Record<ParseStage, string> = {
  prepare: '准备文件',
  text: '读取文本',
  ocr: 'OCR 识别',
  llm: '智能拆题',
  rules: '规则校验',
  done: '完成',
}

const STAGE_ORDER: ParseStage[] = ['prepare', 'text', 'ocr', 'llm', 'rules', 'done']

/**
 * 拆题进行中的环形倒计时进度：
 * - 外圈旋转虚线表示「正在进行」
 * - 彩色圆弧按百分比推进
 * - 中心显示百分比与当前阶段
 * - 下方展示阶段文案、已用时与预计剩余（倒计时效果）
 */
export default function CircularProgress({ progress }: { progress: ParseProgress }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => window.clearInterval(timer)
  }, [])

  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)))
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - percent / 100)

  // 依据当前进度与已用时估算剩余秒数，进度越低越保守
  const remaining = useMemo(() => {
    if (percent <= 2 || elapsed < 1) return null
    return Math.max(1, Math.round((elapsed / percent) * (100 - percent)))
  }, [elapsed, percent])

  const activeIndex = STAGE_ORDER.indexOf(progress.stage)

  return (
    <div className="cp-wrap" role="status" aria-live="polite">
      <div className="cp-dial">
        <svg viewBox="0 0 120 120" className="cp-svg" aria-hidden="true">
          <defs>
            <linearGradient id="cp-arc-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" className="cp-grad-from" />
              <stop offset="100%" stopColor="#7c5cff" />
            </linearGradient>
          </defs>
          <circle className="cp-track" cx="60" cy="60" r={radius} />
          <circle
            className="cp-arc"
            cx="60" cy="60" r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
          <circle className="cp-spin" cx="60" cy="60" r={radius + 7} strokeDasharray="10 14" />
        </svg>
        <div className="cp-center">
          <div className="cp-percent">{percent}<small>%</small></div>
          <div className="cp-stage-label">{STAGE_LABEL[progress.stage] ?? '处理中'}</div>
        </div>
      </div>
      <div className="cp-info">
        <div className="cp-title"><span className="cp-spinner" /> 正在智能拆题，请稍候…</div>
        <div className="cp-message">{progress.message || '正在准备文档…'}</div>
        <div className="cp-time">
          <span>已用时 <b>{formatClock(elapsed)}</b></span>
          <span className="cp-eta">预计还需 <b>{remaining === null ? '计算中' : `~${formatClock(remaining)}`}</b></span>
        </div>
        <div className="cp-steps">
          {STAGE_ORDER.filter((s) => s !== 'done').map((stage, index) => (
            <span key={stage} className={`cp-step${index < activeIndex ? ' done' : ''}${stage === progress.stage ? ' active' : ''}`}>
              {STAGE_LABEL[stage]}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
