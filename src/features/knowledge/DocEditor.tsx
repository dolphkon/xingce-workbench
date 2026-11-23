import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog, Icon } from '../../components/ui'
import { getById, put, readCachedById, remove } from '../../lib/db'
import { renderMarkdown } from '../../lib/markdown'
import { formatDate, uid } from '../../lib/utils'
import { docFileKind, formatBytes } from '../../lib/docFile'
import type { KnowledgeDoc } from '../../types'

const TEMPLATE = `## 核心考点

## 解题方法

## 易错提醒

## 相关例题
`

type Tool = { label: string; title: string; wrap: [string, string]; block?: boolean }

const TOOLS: Tool[] = [
  { label: 'H2', title: '二级标题', wrap: ['## ', ''], block: true },
  { label: 'H3', title: '三级标题', wrap: ['### ', ''], block: true },
  { label: 'B', title: '加粗', wrap: ['**', '**'] },
  { label: 'I', title: '斜体', wrap: ['*', '*'] },
  { label: '• 列表', title: '无序列表', wrap: ['- ', ''], block: true },
  { label: '1. 列表', title: '有序列表', wrap: ['1. ', ''], block: true },
  { label: '❝', title: '引用', wrap: ['> ', ''], block: true },
  { label: '</>', title: '行内代码', wrap: ['`', '`'] },
  { label: '代码块', title: '代码块', wrap: ['```\n', '\n```'], block: true },
  { label: '链接', title: '链接', wrap: ['[', '](https://)'] },
  { label: '—', title: '分割线', wrap: ['\n---\n', ''], block: true },
]

export default function DocEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === 'new'

  const [doc, setDoc] = useState<KnowledgeDoc>(() => {
    const cached = !isNew && id ? readCachedById('docs', id) : undefined
    return cached ?? {
      id: isNew ? uid() : (id ?? uid()),
      title: '',
      content: isNew ? TEMPLATE : '',
      category: '',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      kind: 'md',
    }
  })
  const isFileDoc = doc.kind === 'file' && Boolean(doc.fileData)
  const fileKind = useMemo(() => docFileKind(doc.fileName, doc.fileType), [doc.fileName, doc.fileType])

  const [editing, setEditing] = useState(() => isNew || Boolean(id && !readCachedById('docs', id)?.content.trim()))
  const [loaded, setLoaded] = useState(() => isNew || Boolean(id && readCachedById('docs', id)))
  const [savedAt, setSavedAt] = useState<number | null>(() => (id ? readCachedById('docs', id)?.updatedAt ?? null : null))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [tagsInput, setTagsInput] = useState(() => (id ? readCachedById('docs', id)?.tags.join(', ') ?? '' : ''))
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isNew || !id) { setLoaded(true); return }
    let active = true
    const cached = readCachedById('docs', id)
    if (cached) {
      setDoc(cached); setSavedAt(cached.updatedAt); setEditing(!cached.content.trim() && cached.kind !== 'file')
      setTagsInput(cached.tags.join(', ')); setLoaded(true)
      return () => { active = false }
    }
    getById('docs', id)
      .then((data) => {
        if (!active) return
        if (data) {
          setDoc(data); setSavedAt(data.updatedAt)
          setEditing(!data.content.trim() && data.kind !== 'file'); setTagsInput(data.tags.join(', '))
        } else navigate('/knowledge')
        setLoaded(true)
      })
      .catch(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [id, isNew, navigate])

  const html = useMemo(() => renderMarkdown(doc.content), [doc.content])

  const saveNow = useCallback(async (switchToView = false) => {
    if (!loaded) return
    setSaving(true)
    try {
      const now = Date.now()
      const tags = tagsInput.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean)
      await put('docs', { ...doc, tags, updatedAt: now })
      setSavedAt(now)
      if (switchToView && doc.content.trim()) setEditing(false)
    } finally {
      setSaving(false)
    }
  }, [doc, loaded, tagsInput])

  // 自动保存（仅文本编辑态）
  useEffect(() => {
    if (!loaded || !editing || isFileDoc) return
    const timer = setTimeout(() => { void saveNow() }, 800)
    return () => clearTimeout(timer)
  }, [loaded, editing, isFileDoc, saveNow])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveNow(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editing, saveNow])

  const update = (patch: Partial<KnowledgeDoc>) => setDoc((prev) => ({ ...prev, ...patch }))

  const applyTool = (tool: Tool) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = doc.content.slice(start, end)
    const [before, after] = tool.wrap
    let inserted: string
    if (tool.block) {
      const lineStart = doc.content.lastIndexOf('\n', start - 1) + 1
      inserted = before + (selected || '文字') + after
      const next = doc.content.slice(0, lineStart) + inserted + doc.content.slice(end)
      update({ content: next })
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(lineStart + inserted.length, lineStart + inserted.length) })
    } else {
      inserted = before + (selected || '文字') + after
      const next = doc.content.slice(0, start) + inserted + doc.content.slice(end)
      update({ content: next })
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + before.length, start + before.length + (selected || '文字').length) })
    }
  }

  const handleDelete = async () => {
    await remove('docs', doc.id)
    navigate('/knowledge')
  }

  if (!loaded) return <div className="loading">加载中…</div>

  return (
    <>
      <div className="page-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to="/knowledge" className="small" style={{ color: 'var(--primary)', fontWeight: 600 }}>← 返回知识库</Link>
          {editing && !isFileDoc ? (
            <input className="input" value={doc.title} onChange={(e) => update({ title: e.target.value })}
              placeholder="未命名文档" style={{ fontSize: 22, fontWeight: 700, border: 'none', padding: '4px 0', marginTop: 4, background: 'transparent' }} />
          ) : (
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 0', lineHeight: 1.35 }}>{doc.title || doc.fileName || '未命名文档'}</h1>
          )}
        </div>
        <div className="header-actions">
          <span className="small light" style={{ alignSelf: 'center' }}>
            {saving ? '保存中…' : savedAt ? `已保存 ${formatDate(savedAt)}` : isNew ? '新文档' : ''}
          </span>
          {!isFileDoc && editing && (
            <button className="btn btn-primary" onClick={() => void saveNow(true)} disabled={saving}><Icon name="save" size={16} /> 保存</button>
          )}
          {!isFileDoc && !editing && (
            <button className="btn" onClick={() => { setEditing(true); setTab('edit') }}><Icon name="edit" size={16} /> 编辑</button>
          )}
          {doc.fileData && (
            <a className="btn" href={doc.fileData} download={doc.fileName || doc.title}><Icon name="download" size={16} /> 下载</a>
          )}
          <button className="btn btn-ghost" onClick={() => setShowInfo((v) => !v)} title="文档信息"><Icon name="settings" size={16} /> 信息</button>
          {!isNew && (
            <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={16} /> 删除</button>
          )}
        </div>
      </div>

      {showInfo && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="form-row">
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label className="form-label">所属文件夹</label>
                <input className="input" value={doc.category} onChange={(e) => update({ category: e.target.value })} placeholder="如：政治理论" />
              </div>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label className="form-label">标签</label>
                <input className="input" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="逗号分隔" />
              </div>
            </div>
            {isFileDoc && (
              <p className="small muted" style={{ margin: '10px 0 0' }}>
                文件：{doc.fileName} · {formatBytes(doc.fileData)} · {fileKind.toUpperCase()}
                <br />修改文件夹或标签后会自动保存。
              </p>
            )}
          </div>
        </div>
      )}

      {/* 上传文件：在线阅读 */}
      {isFileDoc ? (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">在线阅读</h2>
            <span className="small muted">{doc.fileName} · {formatBytes(doc.fileData)}</span>
          </div>
          <div className="card-body">
            {fileKind === 'pdf' ? (
              <iframe src={doc.fileData} title={doc.fileName} className="kb-viewer" />
            ) : fileKind === 'image' ? (
              <div style={{ textAlign: 'center' }}>
                <img src={doc.fileData} alt={doc.title} className="kb-viewer-img" />
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '40px 20px' }}>
                <div className="empty-icon"><Icon name="file" size={24} /></div>
                <h3>此格式暂不支持在线预览</h3>
                <p>可点击右上角「下载」后用本地软件打开</p>
                <a className="btn btn-primary" href={doc.fileData} download={doc.fileName || doc.title}><Icon name="download" size={15} /> 下载文件</a>
              </div>
            )}
          </div>
        </div>
      ) : editing ? (
        /* Markdown 编辑器：工具栏 + 单栏编辑/预览切换 */
        <div className="editor-card">
          <div className="editor-toolbar">
            <div className="segmented">
              <button className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>编辑</button>
              <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>预览</button>
            </div>
            {tab === 'edit' && (
              <>
                <span className="editor-tool-sep" />
                {TOOLS.map((tool) => (
                  <button key={tool.label} className="editor-tool" title={tool.title} onClick={() => applyTool(tool)}>{tool.label}</button>
                ))}
              </>
            )}
            <span className="spacer" />
            <span className="small light">自动保存 · ⌘/Ctrl+S 保存并返回</span>
          </div>
          {tab === 'edit' ? (
            <textarea
              ref={textareaRef}
              className="editor-textarea"
              value={doc.content}
              onChange={(e) => update({ content: e.target.value })}
              placeholder="在这里书写你的知识点，支持 Markdown…"
              spellCheck={false}
            />
          ) : (
            <div className="md-preview editor-preview" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      ) : doc.content.trim() ? (
        <div className="card">
          <div className="card-body"><div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} /></div>
        </div>
      ) : (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon"><Icon name="file" size={24} /></div>
            <h3>这篇文档还没有内容</h3>
            <p>点击右上角「编辑」开始书写</p>
            <button className="btn btn-primary" onClick={() => { setEditing(true); setTab('edit') }}><Icon name="edit" size={15} /> 编辑文档</button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`确定删除文档「${doc.title || doc.fileName || '未命名'}」吗？此操作不可撤销。`}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  )
}
