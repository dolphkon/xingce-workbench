import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon } from '../../components/ui'
import { getById, put, readCachedById, remove } from '../../lib/db'
import { renderMarkdown } from '../../lib/markdown'
import { formatDate, uid } from '../../lib/utils'
import type { KnowledgeDoc } from '../../types'

const TEMPLATE = `## 核心考点

## 解题方法

## 易错提醒

## 相关例题
`

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
    }
  })
  // 新建文档或有内容时已进入编辑态；已有文档默认展示阅读视图
  const [editing, setEditing] = useState(() => isNew || Boolean(id && !readCachedById('docs', id)?.content.trim()))
  const [loaded, setLoaded] = useState(() => isNew || Boolean(id && readCachedById('docs', id)))
  const [savedAt, setSavedAt] = useState<number | null>(() => (id ? readCachedById('docs', id)?.updatedAt ?? null : null))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (isNew || !id) {
      setLoaded(true)
      return
    }
    let active = true
    const cached = readCachedById('docs', id)
    if (cached) {
      setDoc(cached)
      setSavedAt(cached.updatedAt)
      setEditing(!cached.content.trim())
      setLoaded(true)
      return () => { active = false }
    }
    getById('docs', id)
      .then((data) => {
        if (!active) return
        if (data) {
          setDoc(data)
          setSavedAt(data.updatedAt)
          setEditing(!data.content.trim())
        } else {
          navigate('/knowledge')
        }
        setLoaded(true)
      })
      .catch(() => {
        if (active) setLoaded(true)
      })
    return () => { active = false }
  }, [id, isNew, navigate])

  const html = useMemo(() => renderMarkdown(doc.content), [doc.content])

  // switchToView=true 时，保存成功后若有内容则切回阅读视图
  const saveNow = useCallback(async (switchToView = false) => {
    if (!loaded) return
    setSaving(true)
    try {
      const now = Date.now()
      await put('docs', { ...doc, updatedAt: now })
      setSavedAt(now)
      if (switchToView && doc.content.trim()) setEditing(false)
    } finally {
      setSaving(false)
    }
  }, [doc, loaded])

  useEffect(() => {
    if (!loaded || !editing) return
    const timer = setTimeout(() => {
      void saveNow()
    }, 800)
    return () => clearTimeout(timer)
  }, [loaded, editing, saveNow])

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

  const handleDelete = async () => {
    await remove('docs', doc.id)
    navigate('/knowledge')
  }

  if (!loaded) return <div className="loading">加载中…</div>

  return (
    <>
      <div className="page-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to="/knowledge" className="small" style={{ color: 'var(--primary)', fontWeight: 600 }}>
            ← 返回知识库
          </Link>
          {editing ? (
            <input
              className="input"
              value={doc.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="未命名文档"
              style={{ fontSize: 22, fontWeight: 700, border: 'none', padding: '4px 0', marginTop: 4, background: 'transparent' }}
            />
          ) : (
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 0', lineHeight: 1.35 }}>
              {doc.title || '未命名文档'}
            </h1>
          )}
        </div>
        <div className="header-actions">
          <span className="small light" style={{ alignSelf: 'center' }}>
            {saving ? '保存中…' : savedAt ? `已保存 ${formatDate(savedAt)}` : '编辑中'}
          </span>
          {editing ? (
            <button className="btn btn-primary" onClick={() => void saveNow(true)} disabled={saving}>
              <Icon name="save" size={16} /> 保存
            </button>
          ) : (
            <button className="btn" onClick={() => setEditing(true)}>
              <Icon name="edit" size={16} /> 编辑
            </button>
          )}
          {!isNew && (
            <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={16} /> 删除
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <>
          <div className="editor-layout">
            <div className="editor-pane">
              <div className="pane-header">MARKDOWN 编辑</div>
              <textarea
                value={doc.content}
                onChange={(e) => update({ content: e.target.value })}
                placeholder="在这里书写你的知识点…"
                spellCheck={false}
              />
            </div>
            <div className="preview-pane">
              <div className="pane-header">实时预览</div>
              <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          </div>
          <p className="small light" style={{ marginTop: 12 }}>
            内容在停止输入后自动保存到本机 · 按 ⌘/Ctrl + S 保存并回到阅读视图 · 支持标题、列表、表格、代码块等 Markdown 语法
          </p>
        </>
      ) : doc.content.trim() ? (
        <div className="card">
          <div className="card-body">
            <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      ) : (
        <div className="card">
          <EmptyState
            icon="file"
            title="这篇文档还没有内容"
            description="点击右上角「编辑」开始书写"
            action={<button className="btn btn-primary" onClick={() => setEditing(true)}><Icon name="edit" size={15} /> 编辑文档</button>}
          />
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`确定删除文档「${doc.title || '未命名文档'}」吗？此操作不可撤销。`}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  )
}
