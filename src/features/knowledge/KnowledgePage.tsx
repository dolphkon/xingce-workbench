import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { put, remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import {
  ALL_DOCS_ID,
  UNCATEGORIZED_ID,
  buildFolderTree,
  createFolder,
  deleteFolder,
  descendantFolderIds,
  folderPath,
  migrateLegacyFolderData,
  normalizeParentId,
  renameFolder,
  type TreeFolder,
} from '../../lib/folders'
import { formatDate } from '../../lib/utils'
import { docFileKind, formatBytes } from '../../lib/docFile'
import type { KnowledgeDoc, KnowledgeFolder } from '../../types'

function excerpt(content: string): string {
  return content
    .replace(/[#*`>\[\]()!_~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110)
}

export default function KnowledgePage() {
  const { items: docs, loading, error, refresh } = useCollection('docs')
  const { items: folders, refresh: refreshFolders } = useCollection('folders')
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string>(ALL_DOCS_ID)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>())
  const [deletingDoc, setDeletingDoc] = useState<KnowledgeDoc | null>(null)
  const [renamingDoc, setRenamingDoc] = useState<KnowledgeDoc | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [moveTarget, setMoveTarget] = useState<string>(UNCATEGORIZED_ID)
  const [folderDialog, setFolderDialog] = useState<{ mode: 'create' | 'rename'; folder?: KnowledgeFolder; parentId?: string | null } | null>(null)
  const [folderNameInput, setFolderNameInput] = useState('')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [folderDeleting, setFolderDeleting] = useState<KnowledgeFolder | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const saved = window.localStorage.getItem('xingce-kb-sidebar')
      return saved === null ? true : saved === '1'
    } catch {
      return true
    }
  })
  const [folderMenu, setFolderMenu] = useState<string | null>(null)
  const initExpanded = useRef(false)
  const migrating = useRef(false)

  const tree = useMemo(() => buildFolderTree(folders), [folders])
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])

  // 首次加载默认展开全部目录，方便看到层级结构
  useEffect(() => {
    if (initExpanded.current || folders.length === 0) return
    initExpanded.current = true
    setExpanded(new Set(folders.map((f) => f.id)))
  }, [folders])

  // 旧数据只有 category 文件夹名：自动补建文件夹并回填 folderId（幂等）
  useEffect(() => {
    if (migrating.current || loading) return
    if (!docs.some((doc) => !doc.folderId && doc.category?.trim())) return
    migrating.current = true
    void migrateLegacyFolderData(docs, folders)
      .then((count) => { if (count > 0) { refresh(); refreshFolders() } })
      .finally(() => { migrating.current = false })
  }, [docs, folders, loading, refresh, refreshFolders])

  useEffect(() => {
    if (!folderMenu) return
    const close = () => setFolderMenu(null)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [folderMenu])

  const toggleKbSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev
      try { window.localStorage.setItem('xingce-kb-sidebar', next ? '1' : '0') } catch { /* 忽略写失败 */ }
      return next
    })
  }

  const { subtreeCounts, uncategorizedCount } = useMemo(() => {
    const direct = new Map<string, number>()
    let unc = 0
    docs.forEach((doc) => {
      if (doc.folderId && folderById.has(doc.folderId)) {
        direct.set(doc.folderId, (direct.get(doc.folderId) ?? 0) + 1)
      } else {
        unc += 1
      }
    })
    const subtree = new Map<string, number>()
    folders.forEach((folder) => {
      const ids = descendantFolderIds(folder.id, folders)
      subtree.set(folder.id, ids.reduce((sum, id) => sum + (direct.get(id) ?? 0), 0))
    })
    return { subtreeCounts: subtree, uncategorizedCount: unc }
  }, [docs, folders, folderById])

  const isFolderSelected = selected !== ALL_DOCS_ID && selected !== UNCATEGORIZED_ID && folderById.has(selected)

  const filtered = docs
    .filter((doc) => {
      if (selected === UNCATEGORIZED_ID && doc.folderId && folderById.has(doc.folderId)) return false
      if (isFolderSelected && doc.folderId !== selected) return false
      if (keyword.trim()) {
        const text = `${doc.title} ${folderPath(doc.folderId, folders)} ${doc.content} ${doc.fileName ?? ''} ${doc.tags.join(' ')}`.toLowerCase()
        if (!text.includes(keyword.trim().toLowerCase())) return false
      }
      return true
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const currentLabel = selected === ALL_DOCS_ID
    ? '全部文档'
    : selected === UNCATEGORIZED_ID
      ? '未分类'
      : folderPath(selected, folders)

  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openCreateFolder = (parentId?: string | null) => {
    setFolderDialog({ mode: 'create', parentId: normalizeParentId(parentId) })
    setFolderNameInput('')
    setFolderError(null)
  }

  const openRenameFolder = (folder: KnowledgeFolder) => {
    setFolderDialog({ mode: 'rename', folder })
    setFolderNameInput(folder.name)
    setFolderError(null)
  }

  const openNewNote = (folderId?: string) => {
    const target = folderId ?? (isFolderSelected ? selected : '')
    const param = target && folderById.has(target) ? `?folder=${encodeURIComponent(target)}` : ''
    navigate(`/knowledge/new${param}`)
  }

  const handleFolderSubmit = async () => {
    if (!folderDialog) return
    setFolderError(null)
    try {
      if (folderDialog.mode === 'create') {
        const created = await createFolder(folderNameInput, folderDialog.parentId)
        if (created.parentId) setExpanded((prev) => new Set([...prev, created.parentId!]))
        setSelected(created.id)
      } else if (folderDialog.folder) {
        const updated = await renameFolder(folderDialog.folder.id, folderNameInput)
        const affected = docs.filter((doc) => doc.folderId === updated.id)
        await Promise.all(affected.map((doc) => put('docs', { ...doc, category: updated.name, updatedAt: Date.now() })))
        refresh()
      }
      setFolderDialog(null)
      setFolderNameInput('')
      refreshFolders()
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : '操作失败')
    }
  }

  const handleDeleteFolder = async () => {
    if (!folderDeleting) return
    const ids = descendantFolderIds(folderDeleting.id, folders)
    const idSet = new Set(ids)
    await Promise.all(ids.map((id) => deleteFolder(id)))
    const affected = docs.filter((doc) => doc.folderId && idSet.has(doc.folderId))
    await Promise.all(affected.map((doc) => put('docs', { ...doc, folderId: undefined, category: '', updatedAt: Date.now() })))
    if (idSet.has(selected)) setSelected(ALL_DOCS_ID)
    setExpanded((prev) => new Set([...prev].filter((id) => !idSet.has(id))))
    setFolderDeleting(null)
    refreshFolders()
    refresh()
  }

  const handleRenameDoc = async () => {
    if (!renamingDoc || !renameValue.trim()) return
    const target = moveTarget === UNCATEGORIZED_ID ? undefined : moveTarget
    const folder = target ? folderById.get(target) : undefined
    await put('docs', {
      ...renamingDoc,
      title: renameValue.trim(),
      folderId: target,
      category: folder?.name ?? '',
      updatedAt: Date.now(),
    })
    setRenamingDoc(null)
    refresh()
  }

  const handleDeleteDoc = async () => {
    if (!deletingDoc) return
    await remove('docs', deletingDoc.id)
    setDeletingDoc(null)
    refresh()
  }

  const renderFolder = (folder: TreeFolder, depth: number): ReactNode => {
    const count = subtreeCounts.get(folder.id) ?? 0
    const active = selected === folder.id
    const isOpen = expanded.has(folder.id)
    return (
      <div key={folder.id} className="kb-tree-branch">
        <div className={`kb-folder-row${active ? ' active' : ''}`} style={{ paddingLeft: 2 + depth * 13 }}>
          {folder.children.length > 0 ? (
            <button className={`kb-tree-caret${isOpen ? ' open' : ''}`} onClick={() => toggleFolder(folder.id)} title={isOpen ? '收起' : '展开'}>
              <Icon name="chevron" size={13} />
            </button>
          ) : (
            <span className="kb-tree-caret placeholder" />
          )}
          <button className="kb-folder" onClick={() => setSelected(folder.id)} title={folderPath(folder.id, folders)}>
            <Icon name="folder" size={15} /> <span>{folder.name}</span><span className="kb-count">{count}</span>
          </button>
          <span className={`kb-folder-ops${folderMenu === folder.id ? ' menu-open' : ''}`}>
            <button title={`管理「${folder.name}」`} onClick={(event) => {
              event.stopPropagation()
              setFolderMenu((prev) => prev === folder.id ? null : folder.id)
            }}><Icon name="more" size={14} /></button>
            {folderMenu === folder.id && (
              <span className="kb-folder-menu" onClick={(event) => event.stopPropagation()}>
                <button onClick={() => { setFolderMenu(null); openNewNote(folder.id) }}><Icon name="filetext" size={13} /> 新建文档</button>
                <button onClick={() => { setFolderMenu(null); openCreateFolder(folder.id) }}><Icon name="plus" size={13} /> 新建子文件夹</button>
                <button onClick={() => { setFolderMenu(null); openRenameFolder(folder) }}><Icon name="edit" size={13} /> 重命名</button>
                <button className="danger" onClick={() => { setFolderMenu(null); setFolderDeleting(folder) }}><Icon name="trash" size={13} /> 删除文件夹</button>
              </span>
            )}
          </span>
        </div>
        {isOpen && (
          <>
            {folder.children.map((child) => renderFolder(child, depth + 1))}
            {docs.filter((doc) => doc.folderId === folder.id).map((doc) => {
              const fk = doc.kind === 'file' ? docFileKind(doc.fileName, doc.fileType) : 'text'
              return (
                <div className="kb-tree-file-row" key={doc.id} style={{ paddingLeft: 18 + depth * 13 }}>
                  <Icon name={fk === 'pdf' ? 'filetext' : fk === 'image' ? 'image' : 'file'} size={13} />
                  <button className="kb-tree-file" onClick={() => navigate(`/knowledge/${doc.id}?read=1`)} title={doc.title || doc.fileName}>
                    {doc.title || doc.fileName || '未命名文档'}
                  </button>
                  <button className="kb-tree-file-del" title="删除文件" onClick={() => setDeletingDoc(doc)}><Icon name="trash" size={12} /></button>
                </div>
              )
            })}
          </>
        )}
      </div>
    )
  }

  const parentLabel = folderDialog?.mode === 'rename'
    ? (folderDialog.folder?.parentId ? folderPath(folderDialog.folder.parentId, folders) : '根目录')
    : (folderDialog?.parentId ? folderPath(folderDialog.parentId, folders) : '根目录')

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">知识库</h1>
          <p className="page-subtitle">按文件夹整理资料，新建文档即可沉浸式书写，输入「/」快速插入各类内容块</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={toggleKbSidebar} title={sidebarOpen ? '收起文件管理栏' : '展开文件管理栏'}>
            <Icon name={sidebarOpen ? 'back' : 'chevron'} size={16} /> {sidebarOpen ? '收起文件栏' : '展开文件栏'}
          </button>
          <button className="btn" onClick={() => openCreateFolder(isFolderSelected ? selected : null)}><Icon name="plus" size={16} /> 新建文件夹</button>
          <button className="btn btn-primary" onClick={() => openNewNote()}><Icon name="plus" size={16} /> 新建文档</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className={`kb-layout${sidebarOpen ? '' : ' kb-sidebar-hidden'}`}>
        <aside className="kb-sidebar">
          <div className="kb-side-title">
            <Icon name="folder" size={15} /> 文件管理
            <button className="kb-folder-add" title="新建根目录文件夹" onClick={() => openCreateFolder(null)}><Icon name="plus" size={14} /></button>
          </div>
          <button className={`kb-folder${selected === ALL_DOCS_ID ? ' active' : ''}`} onClick={() => setSelected(ALL_DOCS_ID)}>
            <Icon name="book" size={15} /> <span>全部文档</span><span className="kb-count">{docs.length}</span>
          </button>
          <div className={`kb-folder-row${selected === UNCATEGORIZED_ID ? ' active' : ''}`}>
            <span className="kb-tree-caret placeholder" />
            <button className="kb-folder" onClick={() => setSelected(UNCATEGORIZED_ID)}>
              <Icon name="folder" size={15} /> <span>未分类</span><span className="kb-count">{uncategorizedCount}</span>
            </button>
            <span className="kb-folder-ops">
              <button title="在未分类中新建文档" onClick={() => openNewNote()}><Icon name="file" size={13} /></button>
              <button title="新建根目录文件夹" onClick={() => openCreateFolder(null)}><Icon name="plus" size={13} /></button>
            </span>
          </div>
          {tree.map((folder) => renderFolder(folder, 0))}
          <div className="kb-hint">点击文件夹右侧「···」可新建文档/子文件夹、重命名或删除；文档可直接展开查看并单独删除。</div>
        </aside>

        <div className="kb-main">
          <div className="filter-bar">
            <div className="search-box">
              <Icon name="search" size={15} />
              <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索标题、内容、文件名、标签…" />
            </div>
            <span className="spacer" />
            <span className="small muted">{currentLabel} · {filtered.length} 篇</span>
          </div>

          <div className="card">
            <div className="card-body tight">
              {loading ? (
                <div className="loading">加载中…</div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon="folder"
                  title={docs.length === 0 ? '知识库还是空的' : '这个文件夹还没有文档'}
                  description={docs.length === 0 ? '新建一篇文档，用「/」命令快速组织你的笔记' : '可在这里新建文档，或在文档详情中移动到当前文件夹'}
                  action={
                    <button className="btn btn-primary" onClick={() => openNewNote()}><Icon name="plus" size={15} /> 新建文档</button>
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
                        <div className="list-item-main" onClick={() => navigate(`/knowledge/${doc.id}?read=1`)} style={{ cursor: 'pointer' }}>
                          <div className="item-title">{doc.title || doc.fileName || '未命名文档'}</div>
                          {doc.kind === 'file' ? (
                            <div className="item-excerpt">{doc.fileName} · {formatBytes(doc.fileData)} · 点击全屏阅读</div>
                          ) : (
                            <div className="item-excerpt">{excerpt(doc.content) || '暂无内容'}</div>
                          )}
                          <div className="item-meta">
                            <span className="chip chip-primary"><Icon name="folder" size={11} /> {folderPath(doc.folderId, folders)}</span>
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
                          <button className="icon-btn" title="全屏阅读" onClick={() => navigate(`/knowledge/${doc.id}?read=1`)}><Icon name="eye" size={16} /></button>
                          {doc.fileData && (
                            <a className="icon-btn" title="下载" href={doc.fileData} download={doc.fileName || doc.title}><Icon name="download" size={16} /></a>
                          )}
                          <button className="icon-btn" title="重命名 / 移动" onClick={() => {
                            setRenamingDoc(doc)
                            setRenameValue(doc.title)
                            setMoveTarget(doc.folderId && folderById.has(doc.folderId) ? doc.folderId : UNCATEGORIZED_ID)
                          }}><Icon name="edit" size={16} /></button>
                          <button className="icon-btn danger" title="删除" onClick={() => setDeletingDoc(doc)}><Icon name="trash" size={16} /></button>
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

      {folderDialog && (
        <Modal title={folderDialog.mode === 'rename' ? '重命名文件夹' : '新建文件夹'} onClose={() => setFolderDialog(null)}
          footer={<>
            <button className="btn" onClick={() => setFolderDialog(null)}>取消</button>
            <button className="btn btn-primary" onClick={() => void handleFolderSubmit()}>{folderDialog.mode === 'rename' ? '保存' : '创建'}</button>
          </>}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label className="form-label">文件夹名称</label>
            <input className="input" value={folderNameInput} onChange={(e) => { setFolderNameInput(e.target.value); setFolderError(null) }} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void handleFolderSubmit() }} />
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            {folderDialog.mode === 'rename' ? '所在位置：' : '创建位置：'}<strong>{parentLabel}</strong>
          </p>
          {folderError && <p className="error-text" style={{ marginBottom: 0 }}>{folderError}</p>}
          {folderDialog.mode === 'rename' && <p className="small muted" style={{ marginBottom: 0 }}>重命名后，该文件夹内文档的目录显示会自动更新。</p>}
        </Modal>
      )}

      {renamingDoc && (
        <Modal title="重命名 / 移动文档" onClose={() => setRenamingDoc(null)}
          footer={<>
            <button className="btn" onClick={() => setRenamingDoc(null)}>取消</button>
            <button className="btn btn-primary" onClick={() => void handleRenameDoc()}>保存</button>
          </>}>
          <input className="input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <div className="form-field" style={{ marginTop: 14 }}>
            <label className="form-label">移动到文件夹</label>
            <select className="select" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
              <option value={UNCATEGORIZED_ID}>未分类</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id, folders)}</option>)}
            </select>
          </div>
        </Modal>
      )}

      {deletingDoc && (
        <ConfirmDialog
          message={`确定删除文档「${deletingDoc.title || deletingDoc.fileName || '未命名'}」吗？此操作不可撤销。`}
          onCancel={() => setDeletingDoc(null)}
          onConfirm={() => void handleDeleteDoc()}
        />
      )}

      {folderDeleting && (
        <ConfirmDialog
          message={`确定删除文件夹「${folderDeleting.name}」及其所有子文件夹吗？其中 ${subtreeCounts.get(folderDeleting.id) ?? 0} 篇文档会移入「未分类」，不会被删除。`}
          onCancel={() => setFolderDeleting(null)}
          onConfirm={() => void handleDeleteFolder()}
        />
      )}
    </>
  )
}
