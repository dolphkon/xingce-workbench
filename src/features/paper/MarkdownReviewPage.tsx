import { useRef, useState, type ChangeEvent } from 'react'
import { Icon } from '../../components/ui'
import { splitMarkdownBlocks } from '../../lib/markdownFlow'
import type { LlmBlockReason } from '../../lib/llm'

export interface MarkdownDraftState {
  markdown: string
  fileName: string
  fileType: string
  fileData: string
  defaultTitle: string
  usedLlm: boolean
  llmReason?: LlmBlockReason
  llmMessage?: string
  textMethod: string
  usedOcr: boolean
}

/**
 * 两阶段拆题中间页：展示 AI 生成的结构化 Markdown，
 * 人工直接编辑排版（拆粘连、改题号、调整选项），下载备份/上传续改，确认后再解析成题目。
 */
export default function MarkdownReviewPage({
  draft,
  onMarkdownChange,
  onBack,
  onParse,
  parsing,
  onUploadMd,
}: {
  draft: MarkdownDraftState
  onMarkdownChange: (markdown: string) => void
  onBack: () => void
  onParse: () => void
  parsing: boolean
  onUploadMd: (file: File) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [copied, setCopied] = useState(false)
  const blocks = splitMarkdownBlocks(draft.markdown)

  const download = () => {
    const blob = new Blob([draft.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${draft.defaultTitle || '试卷'}-拆题中间稿.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.markdown)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch { /* 剪贴板不可用时静默 */ }
  }

  const importMd = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onUploadMd(file)
    event.target.value = ''
  }

  return (
    <div className="md-review">
      <div className="md-review-head">
        <div>
          <h2>阶段① · Markdown 中间稿校验</h2>
          <p className="muted small">
            {draft.usedLlm ? 'AI 已按规则整理排版' : '规则生成（当前环境 AI 未启用）'} · {draft.textMethod}
            {draft.usedOcr ? ' + OCR 回退' : ''} · 检测到 <b>{blocks.length}</b> 道题
          </p>
        </div>
        <button className="btn" onClick={onBack}><Icon name="back" size={15} /> 返回</button>
      </div>

      {!draft.usedLlm && draft.llmMessage && (
        <div className="op-notice warn"><Icon name="info" size={15} /> {draft.llmMessage}。你仍可校验下面的 Markdown 并继续生成题目。</div>
      )}

      <div className="md-review-tip">
        <Icon name="info" size={15} />
        <span>
          这是<strong>可编辑的中间稿</strong>。请检查每道题是否独立成块、题号是否正确、选项是否分行、水印页码是否清除。
          发现问题可直接在下方修改（例如把粘在一起的两题拆成两个 <code>## 第 N 题</code> 块），确认无误后再解析成题目。
        </span>
        <button className="btn btn-sm" onClick={() => setShowHelp((v) => !v)}>{showHelp ? '收起格式说明' : '查看格式说明'}</button>
      </div>

      {showHelp && (
        <div className="md-review-help">
          <div className="md-help-title">Markdown 格式约定</div>
          <pre>{`# 试卷名称（可选）

## 第 3 题
题型：单选题
模块：常识判断
答案：B
材料：设问前的背景材料（没有可删掉此行）

题干原文写在这里……

A. 选项正文
B. 选项正文
C. 选项正文
D. 选项正文

解析：解析原文（没有可删掉此行）`}</pre>
          <ul>
            <li>每道题必须以 <code>## 第 N 题</code> 开头，题号用原文编号（可从 42 开始、可重置为 2）。</li>
            <li>一题一块：如果发现一块里有两道题，在第二个题号前另起一行写 <code>## 第 N 题</code>。</li>
            <li>选项固定 A/B/C/D 各一行、不带额外字母前缀；材料、解析行可删除。</li>
          </ul>
        </div>
      )}

      <div className="md-review-toolbar">
        <div className="md-review-actions">
          <button className="btn btn-sm" onClick={download}><Icon name="download" size={14} /> 下载 .md</button>
          <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={14} /> 上传 .md 续改</button>
          <button className="btn btn-sm" onClick={() => void copy()}><Icon name="copy" size={14} /> {copied ? '已复制' : '复制'}</button>
          <input ref={fileInputRef} type="file" accept=".md,.markdown,text/markdown,text/plain" hidden onChange={importMd} />
        </div>
        <span className="md-review-count">共 {draft.markdown.length} 字符 · {blocks.length} 个题块</span>
      </div>

      <textarea
        className="md-review-editor"
        value={draft.markdown}
        onChange={(e) => onMarkdownChange(e.target.value)}
        spellCheck={false}
        aria-label="Markdown 中间稿编辑器"
      />

      <div className="md-review-footer">
        <span className="muted small">修改会自动保存；解析后进入逐题校对，可继续逐题修正。</span>
        <button className="btn btn-primary" onClick={onParse} disabled={parsing || blocks.length === 0}>
          <Icon name="brain" size={16} /> {parsing ? '解析中…' : `确认排版，解析为 ${blocks.length} 道题`}
        </button>
      </div>
    </div>
  )
}
