import type { Block, Doc } from '../types'
import { makeBlock } from './storage'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function safeUrl(url: string): string {
  return /^(https?:|mailto:|#|\/|\.\/|data:image\/)/i.test(url.trim()) ? url.trim() : '#'
}

/** 行内 Markdown → HTML（先转义，避免 XSS） */
export function inlineToHtml(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_all, label: string, href: string) =>
    `<a href="${escapeHtml(safeUrl(href))}" target="_blank" rel="noreferrer">${label}</a>`)
  return out
}

/** 富文本 HTML → Markdown */
export function htmlToMarkdown(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/([*_`~])/g, '\\$1')
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as HTMLElement
    const inner = Array.from(el.childNodes).map(walk).join('')
    switch (el.tagName) {
      case 'B': case 'STRONG': return `**${inner}**`
      case 'I': case 'EM': return `*${inner}*`
      case 'U': return `<u>${inner}</u>`
      case 'S': case 'STRIKE': case 'DEL': return `~~${inner}~~`
      case 'CODE': return '`' + (el.textContent ?? '').replace(/`/g, '\\`') + '`'
      case 'A': return `[${inner}](${el.getAttribute('href') ?? ''})`
      case 'BR': return '\n'
      default: return inner
    }
  }
  return Array.from(root.childNodes).map(walk).join('').trim()
}

export function docToMarkdown(doc: Doc): string {
  const lines = [`# ${doc.title}`, '']
  doc.blocks.forEach((block) => {
    const md = htmlToMarkdown(block.html)
    switch (block.type) {
      case 'h1': lines.push(`# ${block.text || md}`); break
      case 'h2': lines.push(`## ${block.text || md}`); break
      case 'h3': lines.push(`### ${block.text || md}`); break
      case 'todo': lines.push(`- [${block.checked ? 'x' : ' '}] ${md}`); break
      case 'bullet': lines.push(`- ${md}`); break
      case 'number': lines.push(`1. ${md}`); break
      case 'quote': lines.push(`> ${md}`); break
      case 'code': lines.push('```' + (block.language ?? ''), block.text, '```'); break
      case 'divider': lines.push('---'); break
      case 'table':
        (block.rows ?? []).forEach((row, index) => {
          lines.push(`| ${row.join(' | ')} |`)
          if (index === 0) lines.push(`| ${row.map(() => '---').join(' | ')} |`)
        })
        break
      case 'image': lines.push(`![${block.text || '图片'}](${block.src ?? ''})`); break
      case 'link': lines.push(`[${block.text || block.href || '链接'}](${block.href ?? ''})`); break
      case 'docref': lines.push(`[文档引用](#${block.docId ?? ''})`); break
      default: lines.push(md)
    }
  })
  return lines.join('\n') + '\n'
}

export function markdownToBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim() || 'javascript'
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index])
        index += 1
      }
      const block = makeBlock('code', '', code.join('\n'))
      block.language = language
      blocks.push(block)
      index += 1
      continue
    }

    if (trimmed.startsWith('|') && index + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[index + 1].trim())) {
      const rows: string[][] = []
      rows.push(trimmed.slice(1, -1).split('|').map((cell) => cell.trim()))
      index += 2
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(lines[index].trim().slice(1, -1).split('|').map((cell) => cell.trim()))
        index += 1
      }
      const block = makeBlock('table')
      block.rows = rows
      blocks.push(block)
      continue
    }

    if (!trimmed) { index += 1; continue }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (heading) {
      const type = (['h1', 'h2', 'h3'] as const)[heading[1].length - 1]
      blocks.push(makeBlock(type, inlineToHtml(heading[2]), heading[2]))
      index += 1
      continue
    }
    const todo = /^-\s+\[([ xX])\]\s*(.*)$/.exec(trimmed)
    if (todo) {
      const block = makeBlock('todo', inlineToHtml(todo[2]), todo[2])
      block.checked = todo[1].toLowerCase() === 'x'
      blocks.push(block)
      index += 1
      continue
    }
    if (/^[-*]\s+/.test(trimmed)) {
      const text = trimmed.replace(/^[-*]\s+/, '')
      blocks.push(makeBlock('bullet', inlineToHtml(text), text))
      index += 1
      continue
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const text = trimmed.replace(/^\d+\.\s+/, '')
      blocks.push(makeBlock('number', inlineToHtml(text), text))
      index += 1
      continue
    }
    if (/^>\s?/.test(trimmed)) {
      const text = trimmed.replace(/^>\s?/, '')
      blocks.push(makeBlock('quote', inlineToHtml(text), text))
      index += 1
      continue
    }
    if (/^---+$/.test(trimmed)) { blocks.push(makeBlock('divider')); index += 1; continue }
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed)
    if (image) {
      const block = makeBlock('image', '', image[1])
      block.src = safeUrl(image[2])
      blocks.push(block)
      index += 1
      continue
    }
    if (/^\[[^\]]+\]\([^)]+\)$/.test(trimmed)) {
      const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(trimmed)!
      const block = makeBlock('link', inlineToHtml(match[1]), match[1])
      block.href = safeUrl(match[2])
      blocks.push(block)
      index += 1
      continue
    }
    blocks.push(makeBlock('text', inlineToHtml(trimmed), trimmed))
    index += 1
  }
  return blocks.length ? blocks : [makeBlock()]
}

export function docToHtml(doc: Doc): string {
  const body = doc.blocks.map((block) => {
    switch (block.type) {
      case 'h1': return `<h1>${inlineToHtml(block.text)}</h1>`
      case 'h2': return `<h2>${inlineToHtml(block.text)}</h2>`
      case 'h3': return `<h3>${inlineToHtml(block.text)}</h3>`
      case 'todo': return `<p><input type="checkbox" ${block.checked ? 'checked' : ''} disabled> ${block.html}</p>`
      case 'bullet': return `<ul><li>${block.html}</li></ul>`
      case 'number': return `<ol><li>${block.html}</li></ol>`
      case 'quote': return `<blockquote>${block.html}</blockquote>`
      case 'code': return `<pre><code>${escapeHtml(block.text)}</code></pre>`
      case 'divider': return '<hr>'
      case 'table': return `<table>${(block.rows ?? []).map((row, i) =>
        `<tr>${row.map((cell) => i === 0 ? `<th>${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</table>`
      case 'image': return `<img src="${escapeHtml(safeUrl(block.src ?? ''))}" alt="${escapeHtml(block.text)}">`
      case 'link': return `<p><a href="${escapeHtml(safeUrl(block.href ?? ''))}">${escapeHtml(block.text)}</a></p>`
      case 'docref': return `<p><a href="#${escapeHtml(block.docId ?? '')}">文档引用</a></p>`
      default: return `<p>${block.html}</p>`
    }
  }).join('\n')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title>
<style>body{max-width:720px;margin:48px auto;padding:0 24px;font-family:system-ui,-apple-system,"PingFang SC",sans-serif;color:#191919;line-height:1.8}
h1,h2,h3{line-height:1.35}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}pre{background:#f6f6f5;padding:16px;border-radius:8px;overflow:auto}
blockquote{border-left:3px solid #2383E2;margin:0;padding-left:16px;color:#555}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e9e9e7;padding:8px;text-align:left}img{max-width:100%}hr{border:0;border-top:1px solid #e9e9e7;margin:24px 0}</style>
</head><body><h1>${escapeHtml(doc.title)}</h1>\n${body}</body></html>`
}
