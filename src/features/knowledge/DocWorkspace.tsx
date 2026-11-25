/** 单页工作台右侧的文档编辑区：块编辑器核心，保留自动保存、沉浸/全屏、腾讯文档与删除。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConfirmDialog, Icon, Modal } from '../../components/ui'
import { put, readCachedById, remove } from '../../lib/db'
import { folderPath } from '../../lib/folders'
import { blocksToMarkdown, markdownToBlocks } from '../../lib/blocks'
import { formatDate } from '../../lib/utils'
import { docFileKind, formatBytes } from '../../lib/docFile'
import BlockEditor from './BlockEditor'
import { FileReader } from './FileViewer'
import type { DocBlock, KnowledgeDoc, KnowledgeFolder } from '../../types'

export interface DocWorkspaceProps {
  docId?: string
  readMode?: boolean
  docs: KnowledgeDoc[]
  folders: KnowledgeFolder[]
  onDocSaved?: () => void
  onDocDeleted?: () => void
  onReadClosed?: () => void
  onOpenDoc?: (id: string) => void
  onNewDoc?: () => void
}

export default function DocWorkspace({
  docId, readMode = false, docs, folders,
  onDocSaved, onDocDeleted, onReadClosed, onOpenDoc, onNewDoc,
}: DocWorkspaceProps) {
  const [doc, setDoc] = useState<KnowledgeDoc | null>(() => (docId ? readCachedById('docs', docId) ?? null : null))
  const [blocks, setBlocks] = useState<DocBlock[]>(() => {
    const cached = docId ? readCachedById('docs', docId) : undefined
    return cached?.blocks?.length ? cached.blocks : markdownToBlocks(cached?.content ?? '')
  })
  const [savedAt, setSavedAt] = useState<number | null>(() => (docId ? readCachedById('docs', docId)?.updatedAt ?? null : null))
  const [saving, setSaving] = useState(false)
  const [tagsInput, setTagsInput] = useState(() => (docId ? readCachedById('docs', docId)?.tags.join(', ') ?? '' : ''))
  const [immersive, setImmersive] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showTencent, setShowTencent] = useState(false)
  const [tencentInput, setTencentInput] = useState('')
  const [tencentError, setTencentError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const isFileDoc = doc?.kind === 'file' && Boolean(doc.fileData)
  const fileKind = useMemo(() => docFileKind(doc?.fileName, doc?.fileType), [doc?.fileName, doc?.fileType])
  const refDocs = useMemo(() => docs.filter((item) => item.id !== doc?.id && item.kind !== 'file'), [docs, doc?.id])
  const fileDocs = useMemo(() => docs.filter((item) => item.kind === 'file' && Boolean(item.fileData)), [docs])

  // 仅在切换文档时重建本地状态，列表刷新不应打断正在书写的内容
  useEffect(() => {
    if (!docId) {
      setDoc(null)
      setBlocks([])
      setSavedAt(null)
      setTagsInput('')
      setImmersive(false)
      setShowInfo(false)
      return
    }
    const cached = readCachedById('docs', docId)
    if (!cached) { setDoc(null); return }
    setDoc(cached)
    setBlocks(cached.blocks?.length ? cached.blocks : markdownToBlocks(cached.content))
    setSavedAt(cached.updatedAt)
    setTagsInput(cached.tags.join(', '))
    setTencentInput(cached.tencentUrl ?? '')
    setImmersive(false)
    setShowInfo(false)
  }, [docId])

  // 全屏入口统一进入沉浸模式（含 ?read=1 深链）
  useEffect(() => {
    if (readMode && docId) setImmersive(true)
  }, [readMode, docId])

  const saveNow = useCallback(async () => {
    if (!doc || !docId) return
    setSaving(true)
    try {
      const now = Date.now()
      const tags = tagsInput.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean)
      const saved = { ...doc, blocks, content: blocksToMarkdown(blocks), tags, updatedAt: now }
      await put('docs', saved)
      setSavedAt(now)
      onDocSaved?.()
    } finally {
      setSaving(false)
    }
  }, [doc, docId, blocks, tagsInput, onDocSaved])

  useEffect(() => {
    if (!docId || !doc || isFileDoc) return
    const timer = setTimeout(() => { void saveNow() }, 800)
    return () => clearTimeout(timer)
  }, [docId, doc, blocks, tagsInput, isFileDoc, saveNow])

  const closeImmersive = useCallback(() => {
    void saveNow()
    setImmersive(false)
    onReadClosed?.()
  }, [saveNow, onReadClosed])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && immersive) {
        closeImmersive()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveNow()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [immersive, saveNow, closeImmersive])

  useEffect(() => {
    if (!immersive) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [immersive])

  const copyForTencent = async () => {
    if (!doc) return
    const text = isFileDoc ? (doc.title || doc.fileName || '') : `${doc.title}\n\n${doc.content}`
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
    if (!doc) return
    setTencentError(null)
    const value = tencentInput.trim()
    if (!value) {
      const next = { ...doc, tencentUrl: undefined, updatedAt: Date.now() }
      await put('docs', next)
      setDoc(next)
      setShowTencent(false)
      onDocSaved?.()
      return
    }
    if (!/^https?:\/\//i.test(value)) { setTencentError('请输入以 http:// 或 https:// 开头的链接'); return }
    const next = { ...doc, tencentUrl: value, updatedAt: Date.now() }
    await put('docs', next)
    setDoc(next)
    setShowTencent(false)
    onDocSaved?.()
  }

  const handleDelete = async () => {
    if (!doc) return
    await remove('docs', doc.id)
    setConfirmDelete(false)
    onDocDeleted?.()
  }

  const update = (patch: Partial<KnowledgeDoc>) => setDoc((prev) => (prev ? { ...prev, ...patch } : prev))

  const editor = (
    <BlockEditor
      blocks={blocks}
      docs={refDocs}
      fileDocs={fileDocs}
      onChangeBlocks={(next) => {
        setBlocks(next)
        setDoc((prev) => (prev ? { ...prev, blocks: next, content: blocksToMarkdown(next) } : prev))
      }}
      onNavigateDoc={(id) => { void saveNow(); onOpenDoc?.(id) }}
    />
  )

  if (!docId || !doc) {
    return (
      <div className="fw-empty">
        <div className="fw-empty-icon"><Icon name="filetext" size={28} /></div>
        <h2>开始你的知识库</h2>
        <p>从左侧选择一篇文档，或新建一个文件夹与文档。</p>
        {onNewDoc && <button className="btn btn-primary" onClick={onNewDoc}><Icon name="plus" size={15} /> 新建文档</button>}
        <div className="fw-empty-tips">输入「/」唤出块命令 · 输入 # 转标题 · - 转列表 · [] 转待办</div>
      </div>
    )
  }

  const path = doc.folderId ? folderPath(doc.folderId, folders) : '未分类'

  return (
    <>
      <div className="fw-doc-header">
        <div className="fw-doc-heading">
          <div className="fw-breadcrumb"><Icon name="folder" size={12} /> {path}</div>
          {isFileDoc ? (
            <h1 className="fw-doc-title-static">{doc.title || doc.fileName || '未命名文档'}</h1>
          ) : (
            <input className="fw-doc-title" value={doc.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="无标题" spellCheck={false} aria-label="文档标题" />
          )}
          <div className="fw-doc-meta">
            <span>{saving ? '保存中…' : savedAt ? `已保存 ${formatDate(savedAt)}` : '自动保存'}</span>
            <span className="fw-meta-dot" />
            <span>输入「/」唤出块命令</span>
          </div>
        </div>
        <div className="fw-doc-actions">
          <button className="fw-action" onClick={() => { setImmersive(true) }} title="全屏阅读">
            <Icon name="expand" size={15} /> 全屏阅读
          </button>
          {doc.tencentUrl && (
            <a className="fw-action" href={doc.tencentUrl} target="_blank" rel="noreferrer" title="打开腾讯文档"><Icon name="link" size={15} /> 腾讯文档</a>
          )}
          {doc.fileData && (
            <a className="fw-action" href={doc.fileData} download={doc.fileName || doc.title} title="下载"><Icon name="download" size={15} /></a>
          )}
          <button className={`fw-action${showInfo ? ' active' : ''}`} onClick={() => setShowInfo((v) => !v)} title="文档信息"><Icon name="settings" size={15} /></button>
          <button className="fw-action danger" onClick={() => setConfirmDelete(true)} title="删除文档"><Icon name="trash" size={15} /></button>
        </div>
      </div>

      {showInfo && (
        <div className="fw-info-panel">
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
            <div className="form-field" style={{ marginBottom: 0, alignSelf: 'end' }}>
              <button className="btn" onClick={() => { setTencentInput(doc.tencentUrl ?? ''); setTencentError(null); setCopied(false); setShowTencent(true) }}>
                <Icon name="link" size={15} /> {doc.tencentUrl ? '修改腾讯文档' : '绑定腾讯文档'}
              </button>
            </div>
          </div>
          {isFileDoc && (
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              文件：{doc.fileName} · {formatBytes(doc.fileData)} · {fileKind.toUpperCase()}
            </p>
          )}
        </div>
      )}

      <div className="fw-doc-scroll">
        {isFileDoc ? (
          <div className="fw-doc-canvas fw-doc-canvas-file">
            <FileReader
              variant="embedded"
              fileData={doc.fileData ?? ''}
              fileName={doc.fileName || doc.title || '文件'}
              fileType={doc.fileType}
              onFullscreen={() => setImmersive(true)}
            />
          </div>
        ) : (
          <div className="fw-doc-canvas">{editor}</div>
        )}
      </div>

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
        <div className="kb-immersive" role="dialog" aria-modal="true" aria-label="全屏阅读">
          {!isFileDoc && (
            <div className="kb-immersive-bar">
              <button className="kb-immersive-back" onClick={closeImmersive}><Icon name="back" size={16} /> 返回工作台</button>
              <span className="small light">{saving ? '保存中…' : '自动保存 · 输入「/」唤出块命令'}</span>
              <div className="row" style={{ gap: 8 }}>
                <button className="kb-immersive-save" onClick={closeImmersive}><Icon name="save" size={15} /> 保存并退出</button>
                <button className="kb-immersive-close" onClick={closeImmersive} title="退出全屏（Esc）"><Icon name="x" size={18} /></button>
              </div>
            </div>
          )}
          <div className={`kb-immersive-body${isFileDoc ? ' kb-immersive-body-file' : ''}`}>
            {isFileDoc ? (
              <div className="kb-immersive-file">
                <FileReader
                  variant="embedded"
                  fileData={doc.fileData ?? ''}
                  fileName={doc.fileName || doc.title || '文件'}
                  fileType={doc.fileType}
                  onFullscreen={closeImmersive}
                  fullscreenLabel="退出全屏"
                />
              </div>
            ) : (
              <div className="kb-immersive-paper">
                <input className="kb-immersive-title" value={doc.title}
                  onChange={(e) => update({ title: e.target.value })} placeholder="无标题" spellCheck={false} />
                {editor}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
