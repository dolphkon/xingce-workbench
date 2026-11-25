import { useState } from 'react'
import type { Doc } from '../types'

interface SidebarProps {
  docs: Doc[]
  activeId: string
  collapsed: boolean
  onToggle: () => void
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

function timeLabel(value: number): string {
  const diff = Date.now() - value
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(value).toLocaleDateString('zh-CN')
}

export default function Sidebar({ docs, activeId, collapsed, onToggle, onSelect, onCreate, onRename, onDelete }: SidebarProps) {
  const [keyword, setKeyword] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const visible = docs.filter((doc) => {
    const query = keyword.trim().toLowerCase()
    if (!query) return true
    const content = doc.blocks.map((block) => block.text).join(' ')
    return `${doc.title} ${content}`.toLowerCase().includes(query)
  }).sort((a, b) => b.updatedAt - a.updatedAt)

  const commitRename = (id: string) => {
    if (renameValue.trim()) onRename(id, renameValue.trim())
    setRenamingId(null)
  }

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-head">
        <div className="brand"><span className="brand-mark">F</span><span>Flow 文档</span></div>
        <button className="icon-btn collapse-btn" onClick={onToggle} title={collapsed ? '展开侧边栏' : '折叠侧边栏'}>{collapsed ? '»' : '«'}</button>
      </div>
      <div className="sidebar-tools">
        <label className="search-box">
          <span className="search-icon">⌕</span>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索文档…" />
        </label>
        <button className="new-doc" onClick={onCreate}><span>＋</span> 新建文档</button>
      </div>
      <div className="doc-list">
        {visible.length === 0 ? (
          <div className="doc-empty">{keyword ? '没有匹配的文档' : '还没有文档'}</div>
        ) : visible.map((doc) => {
          const preview = doc.blocks.find((block) => block.text.trim())?.text.trim().slice(0, 40) ?? '暂无内容'
          return (
            <div key={doc.id} className={`doc-item${doc.id === activeId ? ' active' : ''}`}
              onClick={() => { if (renamingId !== doc.id) onSelect(doc.id) }}>
              {renamingId === doc.id ? (
                <input className="rename-input" autoFocus value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commitRename(doc.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(doc.id)
                    if (e.key === 'Escape') setRenamingId(null)
                  }} />
              ) : (
                <>
                  <div className="doc-item-title">{doc.title || '无标题'}</div>
                  <div className="doc-item-preview">{preview}</div>
                  <div className="doc-item-meta">{timeLabel(doc.updatedAt)}</div>
                  <div className="doc-item-ops">
                    <button title="重命名" onClick={(e) => {
                      e.stopPropagation(); setRenamingId(doc.id); setRenameValue(doc.title)
                    }}>✎</button>
                    <button title="删除" onClick={(e) => {
                      e.stopPropagation()
                      if (window.confirm(`确定删除「${doc.title || '无标题'}」吗？`)) onDelete(doc.id)
                    }}>✕</button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
      <div className="sidebar-foot">共 {docs.length} 篇 · 数据保存在本机</div>
    </aside>
  )
}
