/** FlowUs 式知识库单页工作台：左侧无限层级文件夹树 + 文档列表，右侧同屏块编辑器。 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ConfirmDialog, Icon, Modal } from '../../components/ui'
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
import { formatDate, uid } from '../../lib/utils'
import { docFileKind, loadDocFile } from '../../lib/docFile'
import DocWorkspace from './DocWorkspace'
import type { KnowledgeDoc, KnowledgeFolder } from '../../types'

const KB_SIDEBAR_KEY = 'xingce-kb-sidebar'

export default function KnowledgePage() {
  const { items: docs, loading, error, refresh } = useCollection('docs')
  const { items: folders, refresh: refreshFolders } = useCollection('folders')
  const [searchParams, setSearchParams] = useSearchParams()
  const activeDocId = searchParams.get('doc') || undefined
  const readMode = searchParams.get('read') === '1'

  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string>(ALL_DOCS_ID)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>())
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // 手机端每次进入默认展开文档列表（列表是唯一入口，收起后用户看不到文档）
    if (window.innerWidth <= 900) return true
    try {
      const saved = window.localStorage.getItem(KB_SIDEBAR_KEY)
      return saved === null ? true : saved === '1'
    } catch {
      return true
    }
  })
  const [folderDialog, setFolderDialog] = useState<{ mode: 'create' | 'rename'; folder?: KnowledgeFolder; parentId?: string | null } | null>(null)
  const [folderNameInput, setFolderNameInput] = useState('')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [folderDeleting, setFolderDeleting] = useState<KnowledgeFolder | null>(null)
  const [folderMenu, setFolderMenu] = useState<string | null>(null)
  const [renamingDoc, setRenamingDoc] = useState<KnowledgeDoc | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [moveTarget, setMoveTarget] = useState<string>(UNCATEGORIZED_ID)
  const [deletingDoc, setDeletingDoc] = useState<KnowledgeDoc | null>(null)
  const initExpanded = useRef(false)
  const migrating = useRef(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<string | null>(null)

  const tree = useMemo(() => buildFolderTree(folders), [folders])
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const isFolderSelected = selected !== ALL_DOCS_ID && selected !== UNCATEGORIZED_ID && folderById.has(selected)
  const activeDoc = docs.find((d) => d.id === activeDocId)

  const { subtreeCounts, uncategorizedCount } = useMemo(() => {
    const direct = new Map<string, number>()
    let unc = 0
    docs.forEach((doc) => {
      if (doc.folderId && folderById.has(doc.folderId)) direct.set(doc.folderId, (direct.get(doc.folderId) ?? 0) + 1)
      else unc += 1
    })
    const subtree = new Map<string, number>()
    folders.forEach((folder) => {
      const ids = descendantFolderIds(folder.id, folders)
      subtree.set(folder.id, ids.reduce((sum, id) => sum + (direct.get(id) ?? 0), 0))
    })
    return { subtreeCounts: subtree, uncategorizedCount: unc }
  }, [docs, folders, folderById])

  const searchResults = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return []
    return docs.filter((doc) => `${doc.title} ${folderPath(doc.folderId, folders)} ${doc.content} ${doc.fileName ?? ''} ${doc.tags.join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [docs, folders, keyword])

  useEffect(() => {
    if (initExpanded.current || folders.length === 0) return
    initExpanded.current = true
    setExpanded(new Set(folders.map((f) => f.id)))
  }, [folders])

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

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev
      // 手机端状态不持久化，避免与桌面偏好互相锁死
      if (window.innerWidth > 900) {
        try { window.localStorage.setItem(KB_SIDEBAR_KEY, next ? '1' : '0') } catch { /* 忽略写失败 */ }
      }
      return next
    })
  }

  // 手机端：Esc 收起文档列表；跨断点切换时自动适配
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && window.innerWidth <= 900) setSidebarOpen(false)
    }
    let wasMobile = window.innerWidth <= 900
    const onResize = () => {
      const mobile = window.innerWidth <= 900
      if (mobile === wasMobile) return
      wasMobile = mobile
      if (mobile) setSidebarOpen(true)
      else {
        let saved: string | null = null
        try { saved = window.localStorage.getItem(KB_SIDEBAR_KEY) } catch { /* 忽略 */ }
        setSidebarOpen(saved !== '0')
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const withParams = useCallback((mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams)
    mutate(next)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const openDoc = useCallback((id: string) => {
    withParams((next) => { next.set('doc', id); next.delete('read') })
    if (window.innerWidth <= 900) setSidebarOpen(false)
  }, [withParams])

  const closeDoc = useCallback(() => {
    withParams((next) => { next.delete('doc'); next.delete('read') })
    // 手机端关闭文档后回到文档列表，避免落到没有入口的空状态
    if (window.innerWidth <= 900) setSidebarOpen(true)
  }, [withParams])

  const onReadClosed = useCallback(() => {
    withParams((next) => next.delete('read'))
  }, [withParams])

  const onDocSaved = useCallback(() => { refresh() }, [refresh])
  const onDocDeleted = useCallback(() => { closeDoc(); refresh() }, [closeDoc, refresh])

  // 兼容旧链接 /knowledge/new?folder=xxx
  const pendingNewFolder = searchParams.get('new')
  useEffect(() => {
    if (pendingNewFolder === null) return
    withParams((next) => next.delete('new'))
    void openNewDoc(pendingNewFolder || null)
    // 仅在新文档请求出现时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewFolder])

  const openNewDoc = async (folderId?: string | null) => {
    const target = folderId === undefined
      ? (isFolderSelected ? selected : null)
      : normalizeParentId(folderId)
    const folder = target ? folderById.get(target) : undefined
    const now = Date.now()
    const created: KnowledgeDoc = {
      id: uid(),
      title: '',
      content: '',
      blocks: [{ id: uid(), type: 'text', html: '', text: '' }],
      folderId: target ?? undefined,
      category: folder?.name ?? '',
      tags: [],
      createdAt: now,
      updatedAt: now,
      kind: 'md',
    }
    await put('docs', created)
    if (target) {
      setSelected(target)
      setExpanded((prev) => new Set([...prev, target]))
    }
    refresh()
    openDoc(created.id)
  }

  // 文件夹菜单「上传本地文件」：记住目标文件夹并唤起文件选择框
  const startFolderUpload = (folderId: string) => {
    setFolderMenu(null)
    uploadTargetRef.current = folderId
    const input = uploadInputRef.current
    if (!input) return
    input.value = '' // 允许连续选择同一文件
    input.click()
  }

  // 读取所选本地文件（支持多选），逐个创建文档并归入目标文件夹
  const handleFolderUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    const target = uploadTargetRef.current
    uploadTargetRef.current = null
    if (!files.length) return
    const folder = target ? folderById.get(target) : undefined
    const now = Date.now()
    const created: KnowledgeDoc[] = []
    for (const file of files) {
      try {
        const loaded = await loadDocFile(file)
        created.push({
          id: uid(),
          // 文件类保留完整文件名（含扩展名）便于识别，文本类用去扩展名标题
          title: loaded.kind === 'file' ? loaded.fileName : (loaded.title || loaded.fileName),
          content: loaded.content,
          blocks: loaded.kind === 'md' ? undefined : [],
          folderId: target ?? undefined,
          category: folder?.name ?? '',
          tags: [],
          createdAt: now,
          updatedAt: now,
          kind: loaded.kind,
          fileName: loaded.fileName,
          fileType: loaded.fileType,
          fileData: loaded.fileData,
        })
      } catch (err) {
        console.error('读取本地文件失败', file.name, err)
      }
    }
    if (!created.length) return
    await Promise.all(created.map((doc) => put('docs', doc)))
    if (target) {
      setSelected(target)
      setExpanded((prev) => new Set([...prev, target]))
    }
    refresh()
    openDoc(created[0].id)
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
    if (activeDocId && affected.some((doc) => doc.id === activeDocId)) closeDoc()
    setExpanded((prev) => new Set([...prev].filter((id) => !idSet.has(id))))
    setFolderDeleting(null)
    refreshFolders()
    refresh()
  }

  const openRenameDoc = (doc: KnowledgeDoc) => {
    setRenamingDoc(doc)
    setRenameValue(doc.title)
    setMoveTarget(doc.folderId && folderById.has(doc.folderId) ? doc.folderId : UNCATEGORIZED_ID)
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
    if (activeDocId === deletingDoc.id) closeDoc()
    setDeletingDoc(null)
    refresh()
  }

  const renderDocRow = (doc: KnowledgeDoc, depth: number): ReactNode => {
    const fk = doc.kind === 'file' ? docFileKind(doc.fileName, doc.fileType) : 'text'
    return (
      <div className={`fw-doc-row${activeDocId === doc.id ? ' active' : ''}`} key={doc.id}
        style={{ paddingLeft: 20 + depth * 13 }}>
        <button className="fw-doc-row-main" onClick={() => openDoc(doc.id)} title={doc.title || doc.fileName}>
          <Icon name={fk === 'pdf' ? 'filetext' : fk === 'image' ? 'image' : 'file'} size={13} />
          <span>{doc.title || doc.fileName || '未命名文档'}</span>
        </button>
        <span className="fw-row-ops">
          <button title="重命名 / 移动" onClick={() => openRenameDoc(doc)}><Icon name="edit" size={12} /></button>
          <button title="删除" onClick={() => setDeletingDoc(doc)}><Icon name="trash" size={12} /></button>
        </span>
      </div>
    )
  }

  const renderFolder = (folder: TreeFolder, depth: number): ReactNode => {
    const docsHere = docs.filter((doc) => doc.folderId === folder.id).sort((a, b) => b.updatedAt - a.updatedAt)
    const isOpen = expanded.has(folder.id)
    return (
      <div className="fw-tree-branch" key={folder.id}>
        <div className={`fw-folder-row${selected === folder.id ? ' active' : ''}`} style={{ paddingLeft: 4 + depth * 13 }}>
          <button className={`fw-caret${isOpen ? ' open' : ''}`}
            onClick={() => toggleFolder(folder.id)} title={isOpen ? '收起' : '展开'}>
            {folder.children.length || docsHere.length ? <Icon name="chevron" size={12} /> : null}
          </button>
          <button className="fw-folder-name" onClick={() => setSelected(folder.id)} title={folderPath(folder.id, folders)}>
            <Icon name="folder" size={14} /> <span>{folder.name}</span>
          </button>
          <span className="fw-count">{subtreeCounts.get(folder.id) ?? 0}</span>
          <span className={`fw-row-ops${folderMenu === folder.id ? ' menu-open' : ''}`}>
            <button title={`在「${folder.name}」中新建文档`} onClick={(event) => { event.stopPropagation(); void openNewDoc(folder.id) }}><Icon name="file" size={12} /></button>
            <button title="更多操作" onClick={(event) => { event.stopPropagation(); setFolderMenu((prev) => prev === folder.id ? null : folder.id) }}><Icon name="more" size={13} /></button>
            {folderMenu === folder.id && (
              <span className="fw-folder-menu" onClick={(event) => event.stopPropagation()}>
                <button onClick={() => { setFolderMenu(null); void openNewDoc(folder.id) }}><Icon name="file" size={13} /> 新建文档</button>
                <button onClick={() => startFolderUpload(folder.id)}><Icon name="upload" size={13} /> 上传本地文件</button>
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
            {docsHere.map((doc) => renderDocRow(doc, depth + 1))}
          </>
        )}
      </div>
    )
  }

  const parentLabel = folderDialog?.mode === 'rename'
    ? (folderDialog.folder?.parentId ? folderPath(folderDialog.folder.parentId, folders) : '根目录')
    : (folderDialog?.parentId ? folderPath(folderDialog.parentId, folders) : '根目录')

  return (
    <div className="fw-workspace">
      {/* 隐藏文件选择框：由文件夹菜单「上传本地文件」唤起 */}
      <input ref={uploadInputRef} type="file" multiple style={{ display: 'none' }}
        onChange={(event) => { void handleFolderUpload(event) }} aria-label="上传本地文件到文件夹" />
      <aside className={`fw-sidebar${sidebarOpen ? '' : ' collapsed'}`}>
        <div className="fw-side-head">
          <div className="fw-brand"><Icon name="book" size={17} /> 知识库</div>
          <button className="fw-side-toggle" onClick={toggleSidebar} title={sidebarOpen ? '收起文件栏' : '展开文件栏'}>
            <Icon name={sidebarOpen ? 'back' : 'chevron'} size={15} />
          </button>
          <button className="fw-side-mobile-close" onClick={toggleSidebar} aria-label="关闭文档列表" title="关闭文档列表">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="fw-side-search">
          <Icon name="search" size={14} />
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索文档…" aria-label="搜索文档" />
          {keyword && <button title="清空" onClick={() => setKeyword('')}><Icon name="x" size={13} /></button>}
        </div>
        <div className="fw-side-actions">
          <button className="fw-new-doc" onClick={() => void openNewDoc()}><Icon name="plus" size={15} /> 新建文档</button>
          <button className="fw-new-folder" onClick={() => openCreateFolder(isFolderSelected ? selected : null)} title="新建文件夹"><Icon name="folder" size={15} /></button>
        </div>
        <div className="fw-tree">
          {keyword.trim() ? (
            <>
              <div className="fw-tree-section">搜索结果 · {searchResults.length}</div>
              {searchResults.length === 0
                ? <div className="fw-tree-empty">没有匹配的文档</div>
                : searchResults.map((doc) => renderDocRow(doc, 0))}
            </>
          ) : (
            <>
              <div className={`fw-root-row${selected === ALL_DOCS_ID ? ' active' : ''}`}>
                <button onClick={() => setSelected(ALL_DOCS_ID)}><Icon name="book" size={14} /> <span>全部文档</span></button>
                <span className="fw-count">{docs.length}</span>
              </div>
              <div className={`fw-root-row${selected === UNCATEGORIZED_ID ? ' active' : ''}`}>
                <button onClick={() => setSelected(UNCATEGORIZED_ID)}><Icon name="folder" size={14} /> <span>未分类</span></button>
                <span className="fw-count">{uncategorizedCount}</span>
                <span className="fw-row-ops">
                  <button title="在未分类中新建文档" onClick={() => void openNewDoc(null)}><Icon name="file" size={12} /></button>
                </span>
              </div>
              {selected === UNCATEGORIZED_ID && <div className="fw-tree-section">未分类文档</div>}
              {selected === UNCATEGORIZED_ID
                ? docs.filter((doc) => !doc.folderId || !folderById.has(doc.folderId)).sort((a, b) => b.updatedAt - a.updatedAt).map((doc) => renderDocRow(doc, 0))
                : (
                  <>
                    <div className="fw-tree-section">文件夹</div>
                    {tree.map((folder) => renderFolder(folder, 0))}
                    {!loading && tree.length === 0 && <div className="fw-tree-empty">还没有文件夹，点击上方 + 新建</div>}
                  </>
                )}
            </>
          )}
        </div>
        <div className="fw-side-foot">
          <span className="small light">{docs.length} 篇文档 · {folders.length} 个文件夹</span>
        </div>
      </aside>

      {sidebarOpen && <div className="fw-side-backdrop" onClick={toggleSidebar} aria-hidden="true" />}
      {!sidebarOpen && (
        <button className="fw-side-restore" onClick={toggleSidebar} title="展开文件栏"><Icon name="chevron" size={14} /></button>
      )}

      <main className="fw-main">
        <div className="fw-mobile-bar">
          <button className="fw-mobile-list-btn" onClick={toggleSidebar} aria-label="打开文档列表">
            <Icon name="book" size={16} /> 文档列表 <span className="fw-mobile-count">{docs.length}</span>
          </button>
          <span className="fw-mobile-bar-title">知识库</span>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <DocWorkspace
          docId={activeDocId}
          readMode={readMode}
          docs={docs}
          folders={folders}
          onDocSaved={onDocSaved}
          onDocDeleted={onDocDeleted}
          onReadClosed={onReadClosed}
          onOpenDoc={openDoc}
          onNewDoc={() => void openNewDoc()}
        />
        {activeDoc && (
          <div className="fw-statusbar">
            <span>{activeDoc.blocks?.length ?? 0} 个内容块</span>
            <span className="fw-meta-dot" />
            <span>更新于 {formatDate(activeDoc.updatedAt)}</span>
            <span className="spacer" />
            <span>输入「/」插入块 · # 标题 · - 列表 · [] 待办</span>
          </div>
        )}
      </main>

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
    </div>
  )
}
