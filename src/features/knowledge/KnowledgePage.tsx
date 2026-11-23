import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { put, remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { createFolder, deleteFolder, renameFolder } from '../../lib/folders'
import { formatDate, uid } from '../../lib/utils'
import { docFileKind, formatBytes, loadDocFile } from '../../lib/docFile'
import type { KnowledgeDoc, KnowledgeFolder } from '../../types'

function excerpt(content: string): string {
  return content
    .replace(/[#*`>\[\]()!_~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110)
}

const UNCATEGORIZED = '未分类'

/**
 * 目录树 = 独立文件夹 store 的文件夹 + 文档中出现但无对应文件夹记录的历史目录（兼容旧数据）+ 未分类（当有文档无 category 时）。
 * folders store 的文件夹按创建顺序，兼容项追加在后。
 */
function useFolderTree(docs: KnowledgeDoc[], folders: KnowledgeFolder[]) {
  return useMemo(() => {
    const counts = new Map<string, number>()
    let hasUncategorized = false
    docs.forEach((doc) => {
      const key = doc.category?.trim() || UNCATEGORIZED
      if (key === UNCATEGORIZED) hasUncategorized = true
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    const ordered: string[] = []
    folders.forEach((f) => { if (f.name) ordered.push(f.name) })
    // 文档中出现的目录若没有对应文件夹记录，补进来（旧数据兼容）
    counts.forEach((_, name) => {
      if (name !== UNCATEGORIZED && !ordered.includes(name)) ordered.push(name)
    })
    if (hasUncategorized) ordered.push(UNCATEGORIZED)
    // 已删除的文件夹若仍有文档，counts 里保留；这里只显示实际有内容或已注册的目录
    const list = ordered.filter((name) => folders.some((f) => f.name === name) || (counts.get(name) ?? 0) > 0)
    return { folders: list, counts, total: docs.length }
  }, [docs, folders])
}

export default function KnowledgePage() {
  const { items, loading, error, refresh } = useCollection('docs')
  const { items: folders, refresh: refreshFolders } = useCollection('folders')
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [folder, setFolder] = useState<string>('全部')
  const [deleting, setDeleting] = useState<KnowledgeDoc | null>(null)
  const [renaming, setRenaming] = useState<KnowledgeDoc | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  // 文件夹管理弹窗状态
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [folderNameInput, setFolderNameInput] = useState('')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [folderRenaming, setFolderRenaming] = useState<KnowledgeFolder | null>(null)
  const [folderDeleting, setFolderDeleting] = useState<KnowledgeFolder | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { folders: treeFolders, counts, total } = useFolderTree(items, folders)

  const filtered = items
    .filter((doc) => {
      if (folder !== '全部' && (doc.category?.trim() || UNCATEGORIZED) !== folder) return false
      if (keyword.trim()) {
        const text = `${doc.title} ${doc.category} ${doc.content} ${doc.fileName ?? ''} ${doc.tags.join(' ')}`.toLowerCase()
        if (!text.includes(keyword.trim().toLowerCase())) return false
      }
      return true
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)

  /** 将某文件夹名下的文档迁移到目标目录（UNCATEGORIZED 表示空 category） */
  const migrateDocs = async (from: string, to: string) => {
    const affected = items.filter((d) => (d.category?.trim() || UNCATEGORIZED) === from)
    const target = to === UNCATEGORIZED ? '' : to
    await Promise.all(affected.map((d) => put('docs', { ...d, category: target, updatedAt: Date.now() })))
  }

  const handleDelete = async () => {
    if (!deleting) return
    await remove('docs', deleting.id)
    setDeleting(null)
    refresh()
  }

  const handleCreateFolder = async () => {
    setFolderError(null)
    try {
      const created = await createFolder(folderNameInput)
      setShowNewFolder(false)
      setFolderNameInput('')
      refreshFolders()
      setFolder(created.name)
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : '创建失败')
    }
  }

  const handleRenameFolder = async () => {
    if (!folderRenaming) return
    setFolderError(null)
    try {
      const oldName = folderRenaming.name
      const updated = await renameFolder(folderRenaming.id, folderNameInput)
      if (oldName !== updated.name) await migrateDocs(oldName, updated.name)
      if (folder === oldName) setFolder(updated.name)
      setFolderRenaming(null)
      setFolderNameInput('')
      refreshFolders()
      refresh()
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : '重命名失败')
    }
  }

  const handleDeleteFolder = async () => {
    if (!folderDeleting) return
    const name = folderDeleting.name
    await deleteFolder(folderDeleting.id)
    await migrateDocs(name, UNCATEGORIZED)
    if (folder === name) setFolder('全部')
    setFolderDeleting(null)
    refreshFolders()
    refresh()
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      // 目标文件夹：优先新输入的名称；若不存在则自动创建为独立文件夹
      let target = newFolderName.trim() || (folder === '全部' || folder === UNCATEGORIZED ? '' : folder)
      if (target && !folders.some((f) => f.name === target)) {
        await createFolder(target)
        refreshFolders()
      }
      const list = Array.from(files)
      const loaded = await Promise.all(list.map((f) => loadDocFile(f)))
      const now = Date.now()
      const docs: KnowledgeDoc[] = loaded.map((item, i) => ({
        id: uid(),
        title: item.title,
        content: item.content,
        category: target,
        tags: [],
        createdAt: now + i,
        updatedAt: now + i,
        kind: item.kind,
        fileName: item.fileName,
        fileType: item.fileType,
        fileData: item.fileData,
      }))
      await Promise.all(docs.map((d) => put('docs', d)))
      refresh()
      setShowUpload(false)
      setNewFolderName('')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const handleRename = async () => {
    if (!renaming || !renameValue.trim()) return
    await put('docs', { ...renaming, title: renameValue.trim(), updatedAt: Date.now() })
    setRenaming(null)
    refresh()
  }

  const moveDoc = async (doc: KnowledgeDoc, target: string) => {
    await put('docs', { ...doc, category: target === UNCATEGORIZED ? '' : target, updatedAt: Date.now() })
    refresh()
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">知识库</h1>
          <p className="page-subtitle">按文件夹整理资料，上传 PDF/图片在线阅读，或用 Markdown 沉淀笔记</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => { setFolderError(null); setFolderNameInput(''); setShowNewFolder(true) }}><Icon name="plus" size={16} /> 新建文件夹</button>
          <button className="btn" onClick={() => setShowUpload(true)}><Icon name="upload" size={16} /> 上传文档</button>
          <button className="btn btn-primary" onClick={() => navigate('/knowledge/new')}><Icon name="plus" size={16} /> 新建笔记</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {uploadError && <div className="error-banner">{uploadError}</div>}

      <div className="kb-layout">
        <aside className="kb-sidebar">
          <div className="kb-side-title">
            <Icon name="folder" size={15} /> 文件夹
            <button className="kb-folder-add" title="新建文件夹" onClick={() => { setFolderError(null); setFolderNameInput(''); setShowNewFolder(true) }}><Icon name="plus" size={14} /></button>
          </div>
          <button className={`kb-folder${folder === '全部' ? ' active' : ''}`} onClick={() => setFolder('全部')}>
            <Icon name="book" size={15} /> <span>全部文档</span><span className="kb-count">{total}</span>
          </button>
          {treeFolders.map((name) => {
            const rec = folders.find((f) => f.name === name)
            return (
              <div key={name} className={`kb-folder-row${folder === name ? ' active' : ''}`}>
                <button className="kb-folder" onClick={() => setFolder(name)}>
                  <Icon name="folder" size={15} /> <span>{name}</span><span className="kb-count">{counts.get(name) ?? 0}</span>
                </button>
                {rec && (
                  <span className="kb-folder-ops">
                    <button title="重命名文件夹" onClick={() => { setFolderError(null); setFolderNameInput(name); setFolderRenaming(rec) }}><Icon name="edit" size={13} /></button>
                    <button title="删除文件夹" onClick={() => setFolderDeleting(rec)}><Icon name="trash" size={13} /></button>
                  </span>
                )}
              </div>
            )
          })}
          <div className="kb-hint">可新建、重命名或删除文件夹；删除后其中文档移入未分类</div>
        </aside>

        <div className="kb-main">
          <div className="filter-bar">
            <div className="search-box">
              <Icon name="search" size={15} />
              <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索标题、内容、文件名、标签…" />
            </div>
            <span className="spacer" />
            <span className="small muted">{folder === '全部' ? '全部文档' : folder} · {filtered.length} 篇</span>
          </div>

          <div className="card">
            <div className="card-body tight">
              {loading ? (
                <div className="loading">加载中…</div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon="folder"
                  title={items.length === 0 ? '知识库还是空的' : '这个文件夹还没有文档'}
                  description={items.length === 0 ? '上传 PDF/图片资料，或新建一篇 Markdown 笔记' : '上传文档到当前文件夹，或在文档详情中移动到这里'}
                  action={
                    <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="btn" onClick={() => setShowUpload(true)}><Icon name="upload" size={15} /> 上传文档</button>
                      <button className="btn btn-primary" onClick={() => navigate('/knowledge/new')}><Icon name="plus" size={15} /> 新建笔记</button>
                    </div>
                  }
                />
              ) : (
                <div className="list">
                  {filtered.map((doc) => {
                    const fk = doc.kind === 'file' ? docFileKind(doc.fileName, doc.fileType) : 'text'
                    return (
                      <div className="list-item" key={doc.id} style={{ alignItems: 'flex-start' }}>
                        <span className={`kb-file-icon kb-file-${fk}`}>
                          <Icon name={fk === 'pdf' ? 'filetext' : fk === 'image' ? 'image' : 'file'} size={19} />
                        </span>
                        <div className="list-item-main" onClick={() => navigate(`/knowledge/${doc.id}`)} style={{ cursor: 'pointer' }}>
                          <div className="item-title">{doc.title || doc.fileName || '未命名文档'}</div>
                          {doc.kind === 'file' ? (
                            <div className="item-excerpt">{doc.fileName} · {formatBytes(doc.fileData)} · 点击在线阅读</div>
                          ) : (
                            <div className="item-excerpt">{excerpt(doc.content) || '暂无内容'}</div>
                          )}
                          <div className="item-meta">
                            {doc.category && <span className="chip chip-primary"><Icon name="folder" size={11} /> {doc.category}</span>}
                            {doc.tencentUrl && <span className="chip chip-success">腾讯文档</span>}
                            {doc.kind === 'file' && <span className="chip chip-warning">{fk.toUpperCase()}</span>}
                            {doc.tags.slice(0, 3).map((tag) => <span className="chip" key={tag}>#{tag}</span>)}
                            <span className="small light">更新于 {formatDate(doc.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="item-actions">
                          {doc.tencentUrl && (
                            <a className="icon-btn" title="打开腾讯文档" href={doc.tencentUrl} target="_blank" rel="noreferrer"><Icon name="link" size={16} /></a>
                          )}
                          <button className="icon-btn" title="在线阅读" onClick={() => navigate(`/knowledge/${doc.id}`)}><Icon name="eye" size={16} /></button>
                          {doc.fileData && (
                            <a className="icon-btn" title="下载" href={doc.fileData} download={doc.fileName || doc.title}><Icon name="download" size={16} /></a>
                          )}
                          <button className="icon-btn" title="重命名" onClick={() => { setRenaming(doc); setRenameValue(doc.title) }}><Icon name="edit" size={16} /></button>
                          <button className="icon-btn danger" title="删除" onClick={() => setDeleting(doc)}><Icon name="trash" size={16} /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showUpload && (
        <Modal title="上传文档到知识库" onClose={() => setShowUpload(false)}
          footer={<button className="btn" onClick={() => setShowUpload(false)}>取消</button>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            当前目录：<strong>{folder === '全部' ? '未分类' : folder}</strong>。支持 PDF、Word、图片、TXT、Markdown 等；文本类可直接编辑，其余可在线阅读与下载。
          </p>
          <div className="form-field">
            <label className="form-label">目标文件夹（可输入新名称自动创建）</label>
            <input className="input" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={folder === '全部' || folder === UNCATEGORIZED ? '留空表示未分类' : folder} />
          </div>
          <label className="upload-zone">
            <Icon name="upload" size={24} />
            <div style={{ marginTop: 8 }}>{uploading ? '正在读取文件…' : '点击选择文件，可多选'}</div>
            <span className="form-hint">文档内容保存在本机浏览器，可随 GitHub 同步</span>
            <input ref={fileInput} type="file" multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.markdown,.png,.jpg,.jpeg,.gif,.webp"
              onChange={(e) => void handleUpload(e.target.files)} />
          </label>
          {newFolderName.trim() && (
            <p className="small muted" style={{ marginBottom: 0 }}>将上传到文件夹「{newFolderName.trim()}」</p>
          )}
        </Modal>
      )}

      {(showNewFolder || folderRenaming) && (
        <Modal title={folderRenaming ? '重命名文件夹' : '新建文件夹'} onClose={() => { setShowNewFolder(false); setFolderRenaming(null); setFolderError(null) }}
          footer={<>
            <button className="btn" onClick={() => { setShowNewFolder(false); setFolderRenaming(null); setFolderError(null) }}>取消</button>
            <button className="btn btn-primary" onClick={() => void (folderRenaming ? handleRenameFolder() : handleCreateFolder())}>{folderRenaming ? '保存' : '创建'}</button>
          </>}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label className="form-label">文件夹名称</label>
            <input className="input" value={folderNameInput} onChange={(e) => { setFolderNameInput(e.target.value); setFolderError(null) }} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void (folderRenaming ? handleRenameFolder() : handleCreateFolder()) }} />
          </div>
          {folderError && <p className="error-text" style={{ marginBottom: 0 }}>{folderError}</p>}
          {folderRenaming && <p className="small muted" style={{ marginBottom: 0 }}>重命名后，原文件夹内的文档会自动转移到新名称下。</p>}
        </Modal>
      )}

      {renaming && (
        <Modal title="重命名文档" onClose={() => setRenaming(null)}
          footer={<>
            <button className="btn" onClick={() => setRenaming(null)}>取消</button>
            <button className="btn btn-primary" onClick={() => void handleRename()}>保存</button>
          </>}>
          <input className="input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <div className="form-field" style={{ marginTop: 14 }}>
            <label className="form-label">移动到文件夹</label>
            <select className="select" value={renaming.category || UNCATEGORIZED}
              onChange={(e) => { void moveDoc(renaming, e.target.value); setRenaming(null) }}>
              <option value={UNCATEGORIZED}>{UNCATEGORIZED}</option>
              {folders.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
            </select>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          message={`确定删除文档「${deleting.title || deleting.fileName || '未命名'}」吗？此操作不可撤销。`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}

      {folderDeleting && (
        <ConfirmDialog
          message={`确定删除文件夹「${folderDeleting.name}」吗？其中的 ${counts.get(folderDeleting.name) ?? 0} 篇文档会移入「未分类」，不会被删除。`}
          onCancel={() => setFolderDeleting(null)}
          onConfirm={() => void handleDeleteFolder()}
        />
      )}
    </>
  )
}
