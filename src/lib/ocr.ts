import { createWorker, type Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null
let progressHandler: ((progress: number) => void) | undefined

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('chi_sim', 1, {
      logger: (message) => {
        if (message.status === 'recognizing text' && progressHandler) {
          progressHandler(Math.round((message.progress || 0) * 100))
        }
      },
    }).catch((err) => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

/**
 * 浏览器本地中文 OCR。首次运行会下载中文语言包（约 15MB），之后浏览器会缓存。
 * 识别结果需人工校对后再入库。
 */
export async function recognizeImage(
  dataUrl: string,
  onProgress?: (progress: number) => void,
): Promise<string> {
  progressHandler = onProgress
  try {
    const worker = await getWorker()
    const result = await worker.recognize(dataUrl)
    onProgress?.(100)
    return result.data.text.replace(/[ \t]+/g, ' ').trim()
  } finally {
    progressHandler = undefined
  }
}

export function isOcrReady(): boolean {
  return workerPromise !== null
}

/* -------------------------------------------------------------------------- */
/* OCR 文本结构化：拆出题千、选项与答案                                       */
/* -------------------------------------------------------------------------- */

export interface ParsedQuestionText {
  stem: string
  options: string[]
  answer: string
}

/** Tesseract 中文识别常在汉字之间插入空格，这里做温和清理 */
function cleanLine(line: string): string {
  let out = line.replace(/\u3000/g, ' ').trim()
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
    if (next === out) break
    out = next
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

function normalizeLetter(raw: string): string {
  const code = raw.charCodeAt(0)
  if (code >= 0xff21 && code <= 0xff24) return String.fromCharCode(code - 0xfee0)
  return raw.toUpperCase()
}

interface OptionMark {
  start: number
  end: number
  letter: string
}

/** 找出一行中所有 "A." / "B、" / "C：" 形式的选项标记 */
function findOptionMarks(line: string): OptionMark[] {
  const marks: OptionMark[] = []
  const withPunct = /(?:^|[\s（(])([A-Da-dＡ-Ｄ])\s*(?:[）)]|[.．、:：,，])\s*/g
  let match: RegExpExecArray | null
  while ((match = withPunct.exec(line)) !== null) {
    marks.push({ start: match.index, end: withPunct.lastIndex, letter: normalizeLetter(match[1]) })
  }
  if (marks.length > 0) return marks

  // 兼容 OCR 丢失标点的情况：行首 "A 内容…"
  const plain = line.match(/^\s*([A-Da-dＡ-Ｄ])\s+(.+)$/)
  if (plain) {
    marks.push({ start: plain.index ?? 0, end: plain[0].indexOf(plain[2]), letter: normalizeLetter(plain[1]) })
  }
  return marks
}

/**
 * 将 OCR 得到的整段文字解析为结构化题目。
 * 只接受按 A→B→C→D 顺序出现的选项，避免把题干中的字母误判为选项。
 */
export function parseQuestionText(raw: string): ParsedQuestionText {
  const lines = raw.replace(/\r/g, '').split('\n').map(cleanLine)
  const stemLines: string[] = []
  const options: string[] = ['', '', '', '']
  let lastIndex = -1

  for (const line of lines) {
    if (!line) continue
    // "正确答案：D" 这类答案行单独提取，不混入题干
    if (/^(?:参考|正确)?答案\s*(?:是)?\s*[:：]?\s*[A-Da-dＡ-Ｄ](?:\s*[、,，]\s*[A-Da-dＡ-Ｄ])*\s*$/i.test(line)) continue
    const marks = findOptionMarks(line)
    if (marks.length === 0) {
      stemLines.push(line)
      continue
    }

    let cursor = 0
    let consumed = false
    for (let i = 0; i < marks.length; i++) {
      const mark = marks[i]
      const letterIndex = mark.letter.charCodeAt(0) - 65
      if (letterIndex <= lastIndex || letterIndex > 3) continue

      // 标记之前的文本（可能是题千，或与上一选项同行的残留）归入题千
      const before = line.slice(cursor, mark.start).trim()
      if (before) stemLines.push(before)
      const contentEnd = i + 1 < marks.length ? marks[i + 1].start : line.length
      const content = line.slice(mark.end, contentEnd).trim()
      if (content) options[letterIndex] = content
      lastIndex = letterIndex
      cursor = contentEnd
      consumed = true
    }
    if (!consumed) stemLines.push(line)

    // 行尾未匹配为选项的内容（如 "D. xxx 答案：A"）归入题千
    const tail = line.slice(cursor).trim()
    if (tail && !consumed) stemLines.push(tail)
  }

  const text = lines.join('\n')
  const answerMatch = text.match(
    /(?:正确)?答案(?:是)?\s*[:：]?\s*([A-Da-dＡ-Ｄ](?:\s*[、,，]\s*[A-Da-dＡ-Ｄ])*)/i,
  )
  const answer = answerMatch
    ? answerMatch[1].replace(/[^A-Da-dＡ-Ｄ]/g, '').toUpperCase()
    : ''

  return {
    stem: stemLines.join('\n').replace(/\n{2,}/g, '\n').trim(),
    options,
    answer,
  }
}
