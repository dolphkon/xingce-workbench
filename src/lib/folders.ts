/**
 * 知识库文件夹管理。
 * 文件夹独立于文档存储（folders store），因此可以存在空文件夹；
 * 文档通过 category=文件夹名 归属。文件夹与文档随 github 快照一起跨设备同步。
 */
import { put as dbPut, remove, readCachedAll } from './db'
import { uid } from './utils'
import type { KnowledgeFolder } from '../types'

/** 同步读取，首帧即可渲染 */
export function readFolders(): KnowledgeFolder[] {
  return readCachedAll('folders').sort((a, b) => a.createdAt - b.createdAt)
}

/** 文件夹名列表（不含空名），供上传/移动下拉使用 */
export function folderNames(folders: KnowledgeFolder[]): string[] {
  return folders.map((f) => f.name).filter(Boolean)
}

/** 新建文件夹（同名不可重复） */
export async function createFolder(name: string): Promise<KnowledgeFolder> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('文件夹名不能为空')
  const existing = readFolders()
  if (existing.some((f) => f.name === trimmed)) throw new Error('该文件夹已存在')
  const now = Date.now()
  const folder: KnowledgeFolder = { id: uid(), name: trimmed, createdAt: now, updatedAt: now }
  await dbPut('folders', folder)
  return folder
}

/** 重命名文件夹；调用方需同步迁移其下文档的 category */
export async function renameFolder(id: string, name: string): Promise<KnowledgeFolder> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('文件夹名不能为空')
  const existing = readFolders()
  if (existing.some((f) => f.name === trimmed && f.id !== id)) throw new Error('该文件夹已存在')
  const folder = existing.find((f) => f.id === id)
  if (!folder) throw new Error('文件夹不存在')
  const updated: KnowledgeFolder = { ...folder, name: trimmed, updatedAt: Date.now() }
  await dbPut('folders', updated)
  return updated
}

/** 删除文件夹记录（文档迁移由调用方处理） */
export async function deleteFolder(id: string): Promise<void> {
  await remove('folders', id)
}
