/**
 * 知识库文件夹管理：支持无限层级的父/子文件夹。
 * 文件夹独立于文档存储（folders store），因此可以存在空文件夹；
 * 文档通过 folderId 归属，category 仅保留旧数据与显示名称。
 * 文件夹与文档随 GitHub 快照一起跨设备同步。
 */
import { put as dbPut, remove, readCachedAll } from './db'
import { uid } from './utils'
import type { KnowledgeDoc, KnowledgeFolder } from '../types'

/** 未分类目录的虚拟 id（不落入数据库） */
export const UNCATEGORIZED_ID = '__uncategorized__'
export const ALL_DOCS_ID = '__all__'

/** 同步读取，首帧即可渲染 */
export function readFolders(): KnowledgeFolder[] {
  return readCachedAll('folders').sort((a, b) => a.createdAt - b.createdAt)
}

/** 文件夹名列表（不含空名），供兼容旧代码使用 */
export function folderNames(folders: KnowledgeFolder[]): string[] {
  return folders.map((f) => f.name).filter(Boolean)
}

export function normalizeParentId(parentId?: string | null): string | null {
  return parentId && parentId !== ALL_DOCS_ID && parentId !== UNCATEGORIZED_ID ? parentId : null
}

/** 新建文件夹（同一父目录下同名不可重复） */
export async function createFolder(name: string, parentId?: string | null): Promise<KnowledgeFolder> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('文件夹名不能为空')
  const parent = normalizeParentId(parentId)
  const existing = readFolders()
  if (existing.some((f) => f.name === trimmed && normalizeParentId(f.parentId) === parent)) {
    throw new Error('同一目录下已存在同名文件夹')
  }
  const now = Date.now()
  const folder: KnowledgeFolder = { id: uid(), name: trimmed, parentId: parent, createdAt: now, updatedAt: now }
  await dbPut('folders', folder)
  return folder
}

/** 重命名文件夹；调用方需同步更新其下文档的 category 显示名 */
export async function renameFolder(id: string, name: string): Promise<KnowledgeFolder> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('文件夹名不能为空')
  const existing = readFolders()
  const folder = existing.find((f) => f.id === id)
  if (!folder) throw new Error('文件夹不存在')
  const parent = normalizeParentId(folder.parentId)
  if (existing.some((f) => f.name === trimmed && f.id !== id && normalizeParentId(f.parentId) === parent)) {
    throw new Error('同一目录下已存在同名文件夹')
  }
  const updated: KnowledgeFolder = { ...folder, name: trimmed, updatedAt: Date.now() }
  await dbPut('folders', updated)
  return updated
}

/** 删除文件夹记录（子目录与文档迁移由调用方处理） */
export async function deleteFolder(id: string): Promise<void> {
  await remove('folders', id)
}

/** 文件夹及其所有祖先的路径，如「资料 / 行测 / 言语」 */
export function folderPath(folderId: string | undefined, folders: KnowledgeFolder[], sep = ' / '): string {
  if (!folderId) return '未分类'
  const byId = new Map(folders.map((f) => [f.id, f]))
  const parts: string[] = []
  const seen = new Set<string>()
  let cursor: KnowledgeFolder | undefined = byId.get(folderId)
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    parts.unshift(cursor.name)
    const parent = normalizeParentId(cursor.parentId)
    cursor = parent ? byId.get(parent) : undefined
  }
  return parts.join(sep) || '未分类'
}

/** 目标文件夹及其所有子孙文件夹 id（删除/计数时使用） */
export function descendantFolderIds(folderId: string, folders: KnowledgeFolder[]): string[] {
  const children = new Map<string | null, KnowledgeFolder[]>()
  folders.forEach((f) => {
    const parent = normalizeParentId(f.parentId)
    const list = children.get(parent) ?? []
    list.push(f)
    children.set(parent, list)
  })
  const result: string[] = []
  const visit = (id: string) => {
    if (result.includes(id)) return
    result.push(id)
    ;(children.get(id) ?? []).forEach((child) => visit(child.id))
  }
  visit(folderId)
  return result
}

export type TreeFolder = KnowledgeFolder & { children: TreeFolder[] }

/** 构建目录树；损坏的 parentId 会降级为根目录，避免循环导致死循环 */
export function buildFolderTree(folders: KnowledgeFolder[]): TreeFolder[] {
  const byId = new Map<string, TreeFolder>()
  folders.forEach((f) => byId.set(f.id, { ...f, children: [] }))
  const roots: TreeFolder[] = []
  byId.forEach((node) => {
    const parentId = normalizeParentId(node.parentId)
    const parent = parentId && parentId !== node.id ? byId.get(parentId) : undefined
    // 损坏数据可能形成 A→B→A 的环：向上探测，发现环则降级为根目录
    let cursor = parent
    const seen = new Set<string>([node.id])
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      const next = normalizeParentId(cursor.parentId)
      cursor = next && next !== cursor.id ? byId.get(next) : undefined
    }
    if (cursor) {
      node.parentId = null
      roots.push(node)
    } else if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  })
  const sortTree = (nodes: TreeFolder[]) => {
    nodes.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
    nodes.forEach((node) => sortTree(node.children))
  }
  sortTree(roots)
  return roots
}

/**
 * 旧数据迁移：早期文档只有 category 文件夹名，没有 folderId。
 * 按名称找到已有文件夹（找不到则自动在根目录补建），并回填 folderId。
 * 幂等：已带 folderId 的文档不会再次写入。
 */
export async function migrateLegacyFolderData(docs: KnowledgeDoc[], folders: KnowledgeFolder[]): Promise<number> {
  const legacy = docs.filter((doc) => !doc.folderId && doc.category?.trim())
  if (legacy.length === 0) return 0
  let current = [...folders]
  for (const doc of legacy) {
    let folder = current.find((f) => f.name === doc.category.trim() && !normalizeParentId(f.parentId))
      ?? current.find((f) => f.name === doc.category.trim())
    if (!folder) {
      folder = await createFolder(doc.category.trim(), null)
      current = [...current, folder]
    }
    await dbPut('docs', { ...doc, folderId: folder.id, category: folder.name, updatedAt: Math.max(doc.updatedAt, Date.now()) })
  }
  return legacy.length
}
