import type { Block, Doc, Workspace } from '../types'

const KEY = 'flowus-editor-workspace-v1'

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function makeBlock(type: Block['type'] = 'text', html = '', text = ''): Block {
  const block: Block = { id: uid(), type, html, text }
  if (type === 'todo') block.checked = false
  if (type === 'code') block.language = 'javascript'
  if (type === 'table') block.rows = [['', ''], ['', '']]
  return block
}

export function createDoc(title = ''): Doc {
  const now = Date.now()
  return {
    id: uid(),
    title,
    blocks: [makeBlock()],
    createdAt: now,
    updatedAt: now,
  }
}

export function loadWorkspace(): Workspace {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as Workspace
      if (Array.isArray(data.docs) && data.docs.length) {
        const active = data.docs.find((doc) => doc.id === data.activeId) ? data.activeId : data.docs[0].id
        return { docs: data.docs, activeId: active }
      }
    }
  } catch {
    // 数据损坏时回退到新文档
  }
  const doc = createDoc()
  return { docs: [doc], activeId: doc.id }
}

export function saveWorkspace(workspace: Workspace): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(workspace))
  } catch {
    // 超出配额时静默失败，避免打断编辑
  }
}
