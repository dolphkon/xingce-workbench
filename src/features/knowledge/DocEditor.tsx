import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ConfirmDialog, Icon, Modal } from '../../components/ui'
import { getById, put, readCachedAll, readCachedById, remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { folderPath } from '../../lib/folders'
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

const BLOCK_TOOLS: Tool[] = [
  { label: 'H1', title: '一级标题', wrap: ['# ', ''], block: true },
  { label: 'H2', title: '二级标题', wrap: ['## ', ''], block: true },
  { label: 'H3', title: '三级标题', wrap: ['### ', ''], block: true },
  { label: 'H4', title: '四级标题', wrap: ['#### ', ''], block: true },
  { label: 'H5', title: '五级标题', wrap: ['##### ', ''], block: true },
  { label: 'H6', title: '六级标题', wrap: ['###### ', ''], block: true },
  { label: '• 列表', title: '无序列表', wrap: ['- ', ''], block: true },
  { label: '1. 列表', title: '有序列表', wrap: ['1. ', ''], block: true },
  { label: '❝', title: '引用', wrap: ['> ', ''], block: true },
  { label: '</>', title: '代码块', wrap: ['```\n', '\n```'], block: true },
]

export default function DocEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isNew = id === 'new'
  const readMode = searchParams.get('read') === '1' && !isNew
  const targetFolderId = searchParams.get('folder') ?? ''
  const { items: folders } = useCollection('folders')

  const [doc, setDoc] = useState<KnowledgeDoc>(() => {
    const cached = !isNew && id ? readCachedById('docs', id) : undefined
    if (cached) return cached
    const folder = readCachedAll('folders').find((f) => f.id === targetFolderId)
    return {
      id: isNew ? uid() : (id ?? uid()),
      title: '',
      content: isNew ? TEMPLATE : '',
      folderId: folder?.id,
      category: folder?.name ?? '',
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
  // 从列表点击文档进入时 read=1：首帧即全屏阅读，退出后返回列表
  const [fullView, setFullView] = useState(() => readMode)
  const [leaveOnClose, setLeaveOnClose] = useState(() => readMode)
  const [immersive, setImmersive] = useState(false)
  const [blockMenuOpen, setBlockMenuOpen] = useState(false)
  const [showTencent, setShowTencent] = useState(false)
  const [tencentInput, setTencentInput] = useState('')
  const [tencentError, setTencentError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [tagsInput, setTagsInput] = useState(() => (id ? readCachedById('docs', id)?.tags.join(', ') ?? '' : ''))
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const immersiveRef = useRef<HTMLTextAreaElement>(null)

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
      if (event.key === 'Escape' && immersive) { setImmersive(false); setBlockMenuOpen(false); return }
      if (event.key === 'Escape' && fullView) {
        if (leaveOnClose) navigate('/knowledge')
        else setFullView(false)
        return
      }
      if (editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveNow(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editing, saveNow, fullView, leaveOnClose, navigate, immersive])

  // 全屏阅读 / 沉浸写作时锁定页面滚动
  useEffect(() => {
    if (!fullView && !immersive) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [fullView, immersive])

  const copyForTencent = async () => {
    const text = doc.kind === 'file' ? (doc.title || doc.fileName || '') : `${doc.title}\n\n${doc.content}`
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const saveTencentUrl = async () => {
    setTencentError(null)
    const value = tencentInput.trim()
    if (!value) { await put('docs', { ...doc, tencentUrl: undefined, updatedAt: Date.now() }); update({ tencentUrl: undefined }); setShowTencent(false); return }
    if (!/^https?:\/\//i.test(value)) { setTencentError('请输入以 http:// 或 https:// 开头的链接'); return }
    await put('docs', { ...doc, tencentUrl: value, updatedAt: Date.now() })
    update({ tencentUrl: value })
    setShowTencent(false)
  }

  const update = (patch: Partial<KnowledgeDoc>) => setDoc((prev) => ({ ...prev, ...patch }))

  const applyTool = (tool: Tool, target?: HTMLTextAreaElement | null) => {
    const el = target ?? textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = doc.content.slice(start, end)
    const [before, after] = tool.wrap
    let inserted: string
    if (tool.block) {
      const lineStart = doc.content.lastIndexOf('\n', start - 1) + 1
      const lineEndIndex = doc.content.indexOf('\n', start)
      const lineEnd = lineEndIndex < 0 ? doc.content.length : lineEndIndex
      const line = doc.content.slice(lineStart, lineEnd)
      const raw = selected || line || '文字'
      const plain = raw.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+)/, '')
      inserted = before === '\n---\n'
        ? `\n---\n${plain}`
        : before === '```\n'
          ? `\`\`\`\n${plain || '代码'}\n\`\`\``
          : `${before}${plain}${after}`
      const next = doc.content.slice(0, lineStart) + inserted + doc.content.slice(lineEnd)
      update({ content: next })
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(lineStart + inserted.length, lineStart + inserted.length) })
    } else {
      inserted = before + (selected || '文字') + after
      const next = doc.content.slice(0, start) + inserted + doc.content.slice(end)
      update({ content: next })
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + before.length, start + before.length + (selected || '文字').length) })
    }
  }

  const applyPlainBlock = () => {
    const el = immersiveRef.current
    if (!el) return
    const start = el.selectionStart
    const lineStart = doc.content.lastIndexOf('\n', start - 1) + 1
    const lineEndIndex = doc.content.indexOf('\n', start)
    const lineEnd = lineEndIndex < 0 ? doc.content.length : lineEndIndex
    const line = doc.content.slice(lineStart, lineEnd)
    const plain = line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+)/, '')
    const next = doc.content.slice(0, lineStart) + plain + doc.content.slice(lineEnd)
    update({ content: next })
    setBlockMenuOpen(false)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(lineStart + plain.length, lineStart + plain.length) })
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
          {!isFileDoc && (
            <button className="btn btn-primary" onClick={() => { setEditing(true); setBlockMenuOpen(false); setImmersive(true) }} title="沉浸式全屏书写">
              <Icon name="expand" size={16} /> 沉浸写作
            </button>
          )}
          {isFileDoc && (
            <button className="btn" onClick={() => setFullView(true)}><Icon name="expand" size={16} /> 全屏阅读</button>
          )}
          {doc.tencentUrl && (
            <a className="btn" href={doc.tencentUrl} target="_blank" rel="noreferrer" title="打开腾讯文档"><Icon name="link" size={16} /> 打开腾讯文档</a>
          )}
          <button className="btn" onClick={() => { setTencentInput(doc.tencentUrl ?? ''); setTencentError(null); setCopied(false); setShowTencent(true) }} title="用腾讯文档在线编辑">
            <Icon name="settings" size={16} /> {doc.tencentUrl ? '修改腾讯文档' : '绑定腾讯文档'}
          </button>
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
                <select className="select" value={doc.folderId && folders.some((f) => f.id === doc.folderId) ? doc.folderId : ''}
                  onChange={(e) => {
                    const folder = folders.find((f) => f.id === e.target.value)
                    update({ folderId: folder?.id, category: folder?.name ?? '' })
                  }}>
                  <option value="">未分类</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id, folders)}</option>)}
                </select>
              </div>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label className="form-label">标签</label>
                <input className="input" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="逗号分隔" />
              </div>
              <div className="form-field" style={{ marginBottom: 0, alignSelf: 'end' }}>
                <button className="btn" onClick={() => void saveNow()} disabled={saving}><Icon name="save" size={15} /> 保存信息</button>
              </div>
            </div>
            {isFileDoc && (
              <p className="small muted" style={{ margin: '10px 0 0' }}>
                文件：{doc.fileName} · {formatBytes(doc.fileData)} · {fileKind.toUpperCase()}
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
            <div className="row" style={{ gap: 12 }}>
              <span className="small muted">{doc.fileName} · {formatBytes(doc.fileData)}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setFullView(true)}><Icon name="expand" size={14} /> 全屏</button>
            </div>
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

      {showTencent && (
        <Modal title="腾讯文档在线编辑" onClose={() => setShowTencent(false)}
          footer={<>
            <button className="btn" onClick={() => setShowTencent(false)}>取消</button>
            <button className="btn btn-primary" onClick={() => void saveTencentUrl()}>保存</button>
          </>}>
          <p className="small muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
            本站为纯前端工作台，无法在你未登录时静默创建腾讯文档。请按下面步骤操作，之后即可一键打开在线编辑：
          </p>
          <ol className="small muted" style={{ lineHeight: 1.9, paddingLeft: 20, margin: '8px 0 14px' }}>
            <li>点击下方「打开腾讯文档」，登录并新建文档</li>
            <li>点击「复制本文内容」，粘贴到刚建的腾讯文档中</li>
            <li>在腾讯文档里点「分享 → 复制链接」，把链接粘贴到下方并保存</li>
          </ol>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <a className="btn" href="https://docs.qq.com/" target="_blank" rel="noreferrer"><Icon name="link" size={15} /> 打开腾讯文档</a>
            <button className="btn" onClick={() => void copyForTencent()}><Icon name="copy" size={15} /> {copied ? '已复制' : '复制本文内容'}</button>
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label className="form-label">腾讯文档链接（留空则解除绑定）</label>
            <input className="input" value={tencentInput} onChange={(e) => { setTencentInput(e.target.value); setTencentError(null) }}
              placeholder="https://docs.qq.com/doc/..." />
          </div>
          {tencentError && <p className="error-text" style={{ marginBottom: 0 }}>{tencentError}</p>}
        </Modal>
      )}

      {immersive && (
        <div className="kb-immersive" role="dialog" aria-modal="true" aria-label="沉浸式写作">
          <div className="kb-immersive-bar">
            <button className="kb-immersive-back" onClick={() => { void saveNow(); setImmersive(false) }}><Icon name="back" size={16} /> 返回知识库</button>
            <span className="small light">{saving ? '保存中…' : '自动保存 · Ctrl/⌘ + S 保存'}</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="kb-immersive-save" onClick={() => { void saveNow(); setImmersive(false) }}><Icon name="save" size={15} /> 保存并退出</button>
              <button className="kb-immersive-close" onClick={() => { void saveNow(); setImmersive(false) }} title="关闭（Esc）"><Icon name="x" size={18} /></button>
            </div>
          </div>
          <div className="kb-immersive-body">
            <div className="kb-immersive-paper">
              <input className="kb-immersive-title" value={doc.title}
                onChange={(e) => update({ title: e.target.value })} placeholder="请输入标题" spellCheck={false} />
              <textarea ref={immersiveRef} className="kb-immersive-text" value={doc.content}
                onChange={(e) => update({ content: e.target.value })} placeholder="开始书写…" spellCheck={false} />
            </div>
            <div className="kb-immersive-dock">
              <div className="kb-immersive-toolbar">
                {TOOLS.slice(0, 10).map((tool) => (
                  <button key={tool.label} title={tool.title} onClick={() => applyTool(tool, immersiveRef.current)}>{tool.label}</button>
                ))}
                <span className="kb-immersive-sep" />
                <button className={blockMenuOpen ? 'active' : ''} title="块类型" onClick={() => setBlockMenuOpen((v) => !v)}>块类型</button>
              </div>
              {blockMenuOpen && (
                <div className="kb-immersive-blockmenu" onClick={(e) => e.stopPropagation()}>
                  <button onClick={applyPlainBlock}>正文</button>
                  {BLOCK_TOOLS.map((tool) => (
                    <button key={tool.label} onClick={() => { applyTool(tool, immersiveRef.current); setBlockMenuOpen(false) }}>{tool.title}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {fullView && (
        <div className="kb-fullscreen" role="dialog" aria-modal="true" aria-label="全屏阅读">
          <div className="kb-fullscreen-bar">
            <div className="kb-fullscreen-title"><Icon name="filetext" size={17} /> {doc.title || doc.fileName || '文档'}</div>
            <div className="row" style={{ gap: 8 }}>
              {!isFileDoc && (
                <button className="kb-fullscreen-btn kb-fullscreen-text" onClick={() => {
                  setLeaveOnClose(false)
                  setFullView(false)
                  setEditing(true)
                  setTab('edit')
                }} title="编辑文档"><Icon name="edit" size={16} /> 编辑</button>
              )}
              {doc.fileData && (
                <a className="kb-fullscreen-btn" href={doc.fileData} download={doc.fileName || doc.title} title="下载"><Icon name="download" size={18} /></a>
              )}
              <button className="kb-fullscreen-btn" onClick={() => {
                if (leaveOnClose) navigate('/knowledge')
                else setFullView(false)
              }} title="退出全屏（Esc）"><Icon name="x" size={20} /></button>
            </div>
          </div>
          <div className="kb-fullscreen-body">
            {!isFileDoc ? (
              <div className="kb-fullscreen-doc md-preview" dangerouslySetInnerHTML={{ __html: html }} />
            ) : fileKind === 'pdf' ? (
              <iframe src={doc.fileData ?? ''} title={doc.fileName} className="kb-fullscreen-frame" />
            ) : fileKind === 'image' ? (
              <img src={doc.fileData ?? ''} alt={doc.title} className="kb-fullscreen-img" />
            ) : (
              <div className="empty-state" style={{ color: '#fff' }}>
                <h3>此格式暂不支持在线预览</h3>
                <p>请点击右上角下载后用本地软件打开</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
