import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { put, remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { formatDate, uid } from '../../lib/utils'
import { docFileKind, formatBytes, loadDocFile } from '../../lib/docFile'
import type { KnowledgeDoc } from '../../types'

function excerpt(content: string): string {
  return content
    .replace(/[#*`>\[\]()!_~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110)
}

/** 由文档 category 构建目录树；category 以 / 分隔表示多级目录，空视为「未分类」 */
function useFolderTree(docs: KnowledgeDoc[]) {
  return useMemo(() => {
    const counts = new Map<string, number>()
    docs.forEach((doc) => {
      const key = doc.category?.trim() || '未分类'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    const folders = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'zh-CN'))
    return { folders, counts, total: docs.length }
  }, [docs])
}

export default function KnowledgePage() {
  const { items, loading, error, refresh } = useCollection('docs')
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
  const fileInput = useRef<HTMLInputElement>(null)
  const { folders, counts, total } = useFolderTree(items)

  const filtered = items
    .filter((doc) => {
      if (folder !== '全部' && (doc.category?.trim() || '未分类') !== folder) return false
      if (keyword.trim()) {
        const text = `${doc.title} ${doc.category} ${doc.content} ${doc.fileName ?? ''} ${doc.tags.join(' ')}`.toLowerCase()
        if (!text.includes(keyword.trim().toLowerCase())) return false
      }
      return true
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const handleDelete = async () => {
    if (!deleting) return
    await remove('docs', deleting.id)
    setDeleting(null)
    refresh()
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      const list = Array.from(files)
      const loaded = await Promise.all(list.map((f) => loadDocFile(f)))
      const now = Date.now()
      const target = newFolderName.trim() || (folder === '全部' ? '' : folder)
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
    await put('docs', { ...doc, category: target === '未分类' ? '' : target, updatedAt: Date.now() })
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
          <button className="btn" onClick={() => setShowUpload(true)}><Icon name="upload" size={16} /> 上传文档</button>
          <button className="btn btn-primary" onClick={() => navigate('/knowledge/new')}><Icon name="plus" size={16} /> 新建笔记</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {uploadError && <div className="error-banner">{uploadError}</div>}

      <div className="kb-layout">
        <aside className="kb-sidebar">
          <div className="kb-side-title"><Icon name="folder" size={15} /> 文件夹</div>
          <button className={`kb-folder${folder === '全部' ? ' active' : ''}`} onClick={() => setFolder('全部')}>
            <Icon name="book" size={15} /> <span>全部文档</span><span className="kb-count">{total}</span>
          </button>
          {folders.map((name) => (
            <button key={name} className={`kb-folder${folder === name ? ' active' : ''}`} onClick={() => setFolder(name)}>
              <Icon name="folder" size={15} /> <span>{name}</span><span className="kb-count">{counts.get(name)}</span>
            </button>
          ))}
          <div className="kb-hint">在文档详情中可修改所属文件夹</div>
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
                            {doc.kind === 'file' && <span className="chip chip-warning">{fk.toUpperCase()}</span>}
                            {doc.tags.slice(0, 3).map((tag) => <span className="chip" key={tag}>#{tag}</span>)}
                            <span className="small light">更新于 {formatDate(doc.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="item-actions">
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
              placeholder={folder === '全部' ? '留空表示未分类' : folder} />
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

      {renaming && (
        <Modal title="重命名文档" onClose={() => setRenaming(null)}
          footer={<>
            <button className="btn" onClick={() => setRenaming(null)}>取消</button>
            <button className="btn btn-primary" onClick={() => void handleRename()}>保存</button>
          </>}>
          <input className="input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <div className="form-field" style={{ marginTop: 14 }}>
            <label className="form-label">移动到文件夹</label>
            <select className="select" value={renaming.category || '未分类'}
              onChange={(e) => { void moveDoc(renaming, e.target.value); setRenaming(null) }}>
              <option value="未分类">未分类</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
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
    </>
  )
}
