import { useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import type { Doc, Workspace } from './types'
import { createDoc, loadWorkspace, saveWorkspace, uid } from './lib/storage'
import { docToHtml, docToMarkdown, markdownToBlocks } from './lib/markdown'

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeName(title: string): string {
  return (title.trim() || '无标题').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => loadWorkspace())
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem('flowus-sidebar-collapsed') === '1' } catch { return false }
  })
  const [toast, setToast] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const activeDoc = workspace.docs.find((doc) => doc.id === workspace.activeId) ?? workspace.docs[0]

  useEffect(() => {
    const timer = window.setTimeout(() => saveWorkspace(workspace), 400)
    return () => window.clearTimeout(timer)
  }, [workspace])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.replace(/^#\/doc\//, '')
      if (!id) return
      setWorkspace((prev) => prev.docs.some((doc) => doc.id === id) ? { ...prev, activeId: id } : prev)
    }
    window.addEventListener('hashchange', onHash)
    onHash()
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem('flowus-sidebar-collapsed', next ? '1' : '0') } catch { /* 忽略 */ }
      return next
    })
  }

  const patchDoc = (patch: Partial<Doc>) => {
    setWorkspace((prev) => ({
      ...prev,
      docs: prev.docs.map((doc) => doc.id === prev.activeId ? { ...doc, ...patch, updatedAt: Date.now() } : doc),
    }))
  }

  const selectDoc = (id: string) => {
    setWorkspace((prev) => ({ ...prev, activeId: id }))
    window.history.replaceState(null, '', `#/doc/${id}`)
  }

  const createNewDoc = () => {
    const doc = createDoc()
    setWorkspace((prev) => ({ docs: [...prev.docs, doc], activeId: doc.id }))
    window.history.replaceState(null, '', `#/doc/${doc.id}`)
    setToast('已新建文档')
  }

  const deleteDoc = (id: string) => {
    setWorkspace((prev) => {
      const docs = prev.docs.filter((doc) => doc.id !== id)
      if (docs.length === 0) {
        const fresh = createDoc()
        return { docs: [fresh], activeId: fresh.id }
      }
      return { docs, activeId: prev.activeId === id ? docs[0].id : prev.activeId }
    })
    setToast('文档已删除')
  }

  const renameDoc = (id: string, title: string) => {
    setWorkspace((prev) => ({
      ...prev,
      docs: prev.docs.map((doc) => doc.id === id ? { ...doc, title, updatedAt: Date.now() } : doc),
    }))
  }

  const importMarkdown = async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    const heading = /^#\s+(.*)$/.exec(lines[0]?.trim() ?? '')
    const title = heading ? heading[1].trim() : file.name.replace(/\.md$/i, '')
    const body = heading ? lines.slice(1).join('\n') : text
    const doc: Doc = {
      id: uid(), title, blocks: markdownToBlocks(body),
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    setWorkspace((prev) => ({ docs: [...prev.docs, doc], activeId: doc.id }))
    window.history.replaceState(null, '', `#/doc/${doc.id}`)
    if (importRef.current) importRef.current.value = ''
    setToast(`已导入「${title || '无标题'}」`)
  }

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/doc/${activeDoc.id}`
    try {
      await navigator.clipboard.writeText(url)
      setToast('文档链接已复制')
    } catch {
      setToast(url)
    }
  }

  const wordCount = (activeDoc.title + activeDoc.blocks.map((block) => block.text).join('')).replace(/\s/g, '').length
  const lastEdit = new Date(activeDoc.updatedAt).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="app">
      {collapsed && <button className="edge-open" onClick={toggleSidebar} title="展开侧边栏">»</button>}
      <Sidebar docs={workspace.docs} activeId={activeDoc.id} collapsed={collapsed} onToggle={toggleSidebar}
        onSelect={selectDoc} onCreate={createNewDoc} onRename={renameDoc} onDelete={deleteDoc} />

      <main className="main">
        <header className="topbar">
          <button className="icon-btn mobile-menu" onClick={toggleSidebar} title="文档列表">☰</button>
          <div className="breadcrumb">所有文档 <span>/</span> <strong>{activeDoc.title || '无标题'}</strong></div>
          <div className="top-actions">
            <button className="top-btn" onClick={() => importRef.current?.click()}>导入 .md</button>
            <button className="top-btn" onClick={() => {
              download(`${safeName(activeDoc.title)}.md`, docToMarkdown(activeDoc), 'text/markdown;charset=utf-8')
              setToast('已导出 Markdown')
            }}>导出 .md</button>
            <button className="top-btn" onClick={() => {
              download(`${safeName(activeDoc.title)}.html`, docToHtml(activeDoc), 'text/html;charset=utf-8')
              setToast('已导出 HTML')
            }}>导出 .html</button>
            <button className="share-btn" onClick={() => void share()}>分享</button>
          </div>
          <input ref={importRef} type="file" accept=".md,.markdown,text/markdown" hidden
            onChange={(e) => void importMarkdown(e.target.files?.[0])} />
        </header>

        <div className="doc-header">
          <input className="doc-title" value={activeDoc.title}
            onChange={(e) => patchDoc({ title: e.target.value })} placeholder="无标题" spellCheck={false} />
          <div className="saved-hint">✓ 已自动保存</div>
        </div>

        <div className="page">
          <Editor doc={activeDoc} docs={workspace.docs}
            onChangeBlocks={(blocks) => patchDoc({ blocks })} onNavigateDoc={selectDoc} />
        </div>

        <footer className="statusbar">
          <span>{wordCount} 字</span>
          <span className="dot">·</span>
          <span>{activeDoc.blocks.length} 个内容块</span>
          <span className="spacer" />
          <span>最后编辑 {lastEdit}</span>
        </footer>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
