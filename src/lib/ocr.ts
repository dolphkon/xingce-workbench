import type { PSM, Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null
let progressHandler: ((progress: number, stage?: string) => void) | undefined

/**
 * 按需加载 OCR 引擎，但支持"预热"：组件挂载时即可提前初始化，
 * 用户真正粘贴图片时引擎/语言包已就绪，避免首次识别长时间等待。
 * tesseract.js 体积较大，动态 import 不拖慢首屏。
 */
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(async ({ createWorker }) => {
        const worker = await createWorker('chi_sim', 1, {
          logger: (message) => {
            if (!progressHandler) return
            const status = String(message.status || '')
            const p = Math.round((message.progress || 0) * 100)
            // 覆盖加载引擎/语言包/初始化/识别全部阶段，避免长时间停在 0%
            if (status === 'initializing tesseract') progressHandler(Math.min(10, p), '正在加载识别引擎…')
            else if (status === 'loading language traineddata') progressHandler(10 + Math.round(p * 0.3), '正在加载中文语言包…')
            else if (status === 'initializing api') progressHandler(45 + Math.round(p * 0.1), '正在初始化识别器…')
            else if (status === 'recognizing text') progressHandler(55 + Math.round(p * 0.45), '正在识别文字…')
          },
        })
        // 默认 PSM 4：实测对带圆圈选项 ⒶⒷⒸⒹ 的排版题更稳。
        // recognizeImage 会按图片实际识别效果在 4/3 之间自适应切换选优。
        // 类型 import 不破坏按需加载。
        await worker.setParameters({ tessedit_pageseg_mode: '4' as PSM })
        return worker
      })
      .catch((err) => {
        workerPromise = null
        throw err
      })
  }
  return workerPromise
}

/** 预热 OCR 引擎（不阻塞调用方），返回 Promise 便于需要时等待 */
export function warmupOcr(): Promise<Worker> {
  return getWorker()
}

export function isOcrReady(): boolean {
  return workerPromise !== null
}

/**
 * 浏览器本地中文 OCR。首次运行会下载中文语言包（约 15MB），之后浏览器缓存，秒级识别。
 *
 * 重要经验：直接用原始清晰图识别正确率最高。任何放大/二值化/锐化预处理都会
 * 破坏圆圈选项标记（ⒶⒷⒸⒹ）和字形，反而把"重塑"认成"重明"、"关乎"认成"关平"，
 * 因此这里不做图像预处理，OCR 输入始终使用未经压缩的原始图片。
 */
export async function recognizeImage(
  dataUrl: string,
  onProgress?: (progress: number, stage?: string) => void,
): Promise<string> {
  progressHandler = onProgress
  try {
    onProgress?.(2, '准备图片…')
    const worker = await getWorker()

    // 不同截图的圆圈选项 ⒶⒷⒸⒹ 在不同 PSM 下识别差异极大：
    // 有的图 PSM4 能识别成 "(A)(B)(c)(D)" 而 PSM3 会把圆圈丢掉、选项连成一团；
    // 有的图恰好相反。固定单一 PSM 必然在某些图上把选项塞进题干（出现 OONRONe 等乱码）。
    // 这里用 PSM4 先识别；若拆不出至少 2 个选项，再回退 PSM3 对比，按"拆出选项数 + 题干是否含乱码"选优。
    onProgress?.(55, '正在识别文字…')
    await worker.setParameters({ tessedit_pageseg_mode: '4' as PSM })
    const primary = postprocessOcrText((await worker.recognize(dataUrl)).data.text)

    let best = primary
    if (parseQuestionText(primary).options.filter((o) => o.trim()).length < 2) {
      // 首选模式没拆出选项：回退 PSM3 再识别一次，选更完整的结果
      onProgress?.(80, '正在优化识别结果…')
      progressHandler = undefined // 第二次识别不重复刷进度，避免进度条倒退
      await worker.setParameters({ tessedit_pageseg_mode: '3' as PSM })
      const fallback = postprocessOcrText((await worker.recognize(dataUrl)).data.text)
      if (scoreOcrResult(fallback) > scoreOcrResult(primary)) best = fallback
    }

    onProgress?.(100, '识别完成')
    return best
  } finally {
    progressHandler = undefined
  }
}

/**
 * OCR 结果质量评分：选项拆得越完整、题干越干净分越高。
 * 用于在多种 PSM 结果间自动选优。
 */
function scoreOcrResult(text: string): number {
  const parsed = parseQuestionText(text)
  const filled = parsed.options.filter((o) => o.trim()).length
  // 题干里残留 (A)(B) 圆圈乱码、OONRONe 之类说明选项没拆出来，重罚
  const garbage = /OONRONe|[（(]\s*[A-Da-d]\s*[）)]|AAA|[《〈]/.test(parsed.stem) ? 20 : 0
  return filled * 10 - garbage
}

/**
 * OCR 常见形近错字纠正表（仅针对确定性高的场景，保守替换）。
 * 中文 OCR 对低分辨率字易混淆，这里纠正高频且上下文明确的错认。
 */
const OCR_TYPO_FIXES: Array<[RegExp, string]> = [
  [/(?:单|車)先题/g, '单选题'],
  [/单迭题/g, '单选题'],
  [/单遠题/g, '单选题'],
  [/重明(?=[，。、])/g, '重塑'],       // "消费体验的重明，" → "重塑，"
  [/关平(?=每|于|乎)/g, '关乎'],
  [/可持线/g, '可持续'],
  [/成几/g, '成败'],                    // "决定了…的成几" → "成败"
  [/保章/g, '保障'],
]

/** OCR 原始文本的后处理：清理空白、纠错、规整标点与换行 */
function postprocessOcrText(raw: string): string {
  let text = raw.replace(/\r/g, '').replace(/[\u3000\t]+/g, ' ')
  // Tesseract 中文输出常在汉字间插入空格（"成 几"），先合并再套用纠错字典
  for (let i = 0; i < 3; i++) {
    const merged = text.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
    if (merged === text) break
    text = merged
  }
  for (const [pattern, replacement] of OCR_TYPO_FIXES) {
    text = text.replace(pattern, replacement)
  }
  return text
    .replace(/[ \t]+/g, ' ')
    // 引号内外多余空格："一键取消 " → "一键取消"
    .replace(/\s+([""''])/g, '$1')
    .replace(/([""''])\s+/g, '$1')
    // 破折号被识别成汉字"一"或"-"：事前告知一事中控制一事后补救
    .replace(/(告知|控制)[一–—-](?=事前|事中|事后)/g, '$1—')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

/**
 * 找出一行中所有选项标记。
 * 覆盖三类：
 *  1. 标准 "A." / "B、" / "C：" / "（D）"
 *  2. 圆圈字母被 OCR 识别成乱码："(《c )" / "（D）" / "Ⓐ" / "〇A" / "( A )"
 *  3. 行首裸字母 "A 内容…"
 */
function findOptionMarks(line: string): OptionMark[] {
  const marks: OptionMark[] = []
  const seen = new Set<number>()

  const push = (start: number, end: number, letter: string) => {
    // 同一位置只保留一个标记，避免重叠正则重复命中
    const key = Math.round(start / 3)
    if (seen.has(key)) return
    seen.add(key)
    marks.push({ start, end, letter: normalizeLetter(letter) })
  }

  // 圆圈字母 Unicode 直接形态 ⒶⒷⒸⒹ (2460-2463)
  const circleRe = /[\u2460-\u2463\u24B6-\u24B9]/g
  let match: RegExpExecArray | null
  while ((match = circleRe.exec(line)) !== null) {
    const idx = line.charCodeAt(match.index) - 0x2460
    const idx2 = line.charCodeAt(match.index) - 0x24b6
    const n = idx >= 0 && idx <= 3 ? idx : idx2
    if (n >= 0 && n <= 3) push(match.index, circleRe.lastIndex, String.fromCharCode(65 + n))
  }
  if (marks.length) return marks.sort((a, b) => a.start - b.start)

  // 括号内选项（含 OCR 乱码书名号）："（A）" / "(《c )" / "( D )" / "（D."
  // 关键：允许字母前后出现 《》〈〉 等被误认的符号与空白
  const parenRe = /[（(]\s*[《〈「『]?\s*([A-Da-dＡ-Ｄ])\s*[》〉」』.．、:：]?\s*[）)]?\s*/g
  while ((match = parenRe.exec(line)) !== null) {
    // 必须真的含右括号或紧跟内容，避免把普通 "(A)" 引用也当选项（后面有顺序校验兜底）
    push(match.index, parenRe.lastIndex, match[1])
  }
  if (marks.length) return marks.sort((a, b) => a.start - b.start)

  // 标准 "A." / "B、" / "C：" / "A)" ，允许出现在行中任意位置；
  // 也支持同行紧凑排版 "A.稻B.小麦C.燃料D.棉花"（题号切分后的一行内多个选项）。
  const withPunct = /(?:^|[\s\u4e00-\u9fff，。；：？！、）)])([A-Da-dＡ-Ｄ])\s*(?:[.．、:：,，]|[）)])\s*/g
  while ((match = withPunct.exec(line)) !== null) {
    push(match.index, withPunct.lastIndex, match[1])
  }
  if (marks.length) return marks.sort((a, b) => a.start - b.start)

  // 兼容 OCR 丢失标点的情况：行首 "A 内容…"
  const plain = line.match(/^\s*([A-Da-dＡ-Ｄ])\s+(.+)$/)
  if (plain) {
    push(plain.index ?? 0, (plain.index ?? 0) + plain[0].indexOf(plain[2]), plain[1])
  }
  return marks.sort((a, b) => a.start - b.start)
}

/** 判断是否为"正确答案：X"之类的答案行 */
const ANSWER_LINE_RE = /^(?:参考|正确|标准)?\s*答案\s*(?:是|为)?\s*[:：]?\s*[A-Da-dＡ-Ｄ](?:\s*[、,，]\s*[A-Da-dＡ-Ｄ])*\s*$/i

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
    // 答案行/答案表单独提取，不混入题干
    if (ANSWER_LINE_RE.test(line)) continue
    if (/^\s*(?:参考|正确|标准)?\s*答案\s*[:：]?\s*(?:\d+\s*[.．、]\s*[A-D])/i.test(line)) continue
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

      // 标记之前的文本（可能是题干，或与上一选项同行的残留）归入题干
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

    const tail = line.slice(cursor).trim()
    if (tail && !consumed) stemLines.push(tail)
  }

  const text = lines.join('\n')
  const answerMatch = text.match(
    /(?:正确|参考|标准)?答案(?:是|为)?\s*[:：]?\s*([A-Da-dＡ-Ｄ](?:\s*[、,，]\s*[A-Da-dＡ-Ｄ])*)/i,
  )
  // 答案表："答案：1.D 2.B 3.C" —— 这里解析函数作用于单题块，只取该块的答案字母
  const answer = answerMatch
    ? answerMatch[1].replace(/[^A-Da-dＡ-Ｄ]/g, '').toUpperCase()
    : ''

  return {
    stem: stemLines.join('\n').replace(/\n{2,}/g, '\n').trim(),
    options,
    answer,
  }
}
