export type BlockType =
  | 'text' | 'h1' | 'h2' | 'h3' | 'todo' | 'bullet' | 'number' | 'quote'
  | 'code' | 'table' | 'divider' | 'image' | 'link' | 'docref'

export interface Block {
  id: string
  type: BlockType
  /** contentEditable 块的富文本 HTML */
  html: string
  /** 纯文本，便于快捷输入、搜索与字数统计 */
  text: string
  checked?: boolean
  language?: string
  rows?: string[][]
  src?: string
  href?: string
  docId?: string
}

export interface Doc {
  id: string
  title: string
  blocks: Block[]
  createdAt: number
  updatedAt: number
}

export interface Workspace {
  docs: Doc[]
  activeId: string
}

export interface SlashState {
  blockId: string
  query: string
  left: number
  top: number
}

export interface ToolbarState {
  blockId: string
  left: number
  top: number
}
