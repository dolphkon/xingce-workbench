/**
 * 通用拆题（在线刷题）输出规范化。
 *
 * 与题库链路的 questionRefine.ts 对应：LLM/规则拆出的题目常忠实保留 OCR 原文的
 * 「1.」题号、「A)」选项字母前缀，导致在线刷题校对页排版凌乱。
 * 本模块做确定性清理：去题号前缀、去选项字母前缀、行内选项抽取、答案回填。
 * 纯函数、无副作用，LLM 与规则两条路径统一调用。
 */

export interface AtomicQuestion {
  stem: string
  options: string[]
  answer: string
  analysis?: string
  type?: string
}

/** 题干行首题号："1. " "第2题 " "（3）" "4、" 等 */
const QUESTION_NUMBER_RE = /^\s*(?:第\s*)?\d{1,3}\s*(?:[.．、,，)）]|[ 　]*题)\s*/

/** 选项字母前缀："A. " "B) " "（C）" "D、" 等（全角字母一并处理） */
const OPTION_PREFIX_RE = /^[（(]?\s*[A-Da-dＡ-Ｄ]\s*[.．、:：)）]\s*/

/** 答案标注 */
const ANSWER_RE = /(?:正确|参考|标准)?\s*答案\s*(?:是|为)?\s*[:：]?\s*([A-Da-dＡ-Ｄ][A-Da-dＡ-Ｄ、,，\s]*)/i

/** OCR/UI 答案占位提示（"正确答案：未识别，请校对填写"），不是有效答案 */
const ANSWER_PLACEHOLDER_RE = /(?:正确|参考|标准)?\s*答案\s*[:：]\s*(?:未识别|未找到|待填写|请校对填写?)[，,]?\s*(?:请校对填写?)?/gi

/** 行内选项标记：前接空白或中文标点 */
const INLINE_OPTION_RE = /(?:^|[\s\n，,；;。：:])([A-Da-dＡ-Ｄ])\s*[.．、:：]\s*/g

function normalizeAnswer(raw: string): string {
  return Array.from(new Set(String(raw ?? '').toUpperCase().replace(/[^A-D]/g, ''))).sort().join('')
}

function toAscii(letter: string): string {
  return letter.toUpperCase().replace('Ａ', 'A').replace('Ｂ', 'B').replace('Ｃ', 'C').replace('Ｄ', 'D')
}

/**
 * 去掉题干每行行首题号；没有题号则原样返回。
 * OCR 常把题号留在题干第二行（如「42. 知识和信息时…」），因此必须逐行处理。
 */
export function stripQuestionNumber(text: string): string {
  return String(text ?? '').trim()
    .split('\n')
    .map((line) => line.replace(QUESTION_NUMBER_RE, '').trim())
    .filter(Boolean)
    .join('\n')
}

/** 去掉选项字母前缀；没有前缀则原样返回 */
export function stripOptionLetter(text: string): string {
  return String(text ?? '').trim().replace(OPTION_PREFIX_RE, '').trim()
}

/**
 * 对一道原子题做规范化。
 * 选项已完整时只清理前缀与题干题号；选项缺失时尝试从题干行内抽取。
 */
export function refineAtomicQuestion<T extends AtomicQuestion>(input: T): T {
  let stem = String(input.stem ?? '').replace(ANSWER_PLACEHOLDER_RE, '').trim()
  let analysis = String(input.analysis ?? '').replace(ANSWER_PLACEHOLDER_RE, '').trim()
  let options = Array.isArray(input.options)
    ? ['A', 'B', 'C', 'D'].map((_, i) => stripOptionLetter(String(input.options[i] ?? '')).replace(ANSWER_RE, '').trim())
    : ['', '', '', '']
  let answer = normalizeAnswer(String(input.answer ?? ''))

  // ⓪ 题干末尾残留的 ①②③ / 1. / （1） 选项行：回填到选项并从题干移除。
  // 仅在「连续 ≥2 行、序号递增、且位于题干末尾、与已识别选项一致」时才处理，
  // 避免误删材料里的普通编号列表。
  {
    const lines = stem.split('\n')
    const found: { line: number; index: number; text: string }[] = []
    lines.forEach((line, i) => {
      const marker = line.match(/^\s*([①②③④]|⑴|⑵|⑶|⑷|⒈|⒉|⒊|⒋|（[1-4]）|\([1-4]\)|[1-4][.．、:：)])\s*(.+)$/)
      if (!marker) return
      const groups = [['①', '②', '③', '④'], ['⑴', '⑵', '⑶', '⑷'], ['⒈', '⒉', '⒊', '⒋']]
      const group = groups.find((g) => g.includes(marker[1]))
      const index = group ? group.indexOf(marker[1])
        : Number(marker[1].replace(/[（）()]/g, '').replace(/[.．、:：)]/g, '')) - 1
      if (index >= 0 && index <= 3) found.push({ line: i, index, text: marker[2].trim() })
    })
    // 选项已识别时 ≥2 行即可清理残留；选项为空时必须凑齐 4 个才回填，避免误删材料列表
    const coherent = found.length >= (options.filter(Boolean).length >= 2 ? 2 : 4)
      && found[found.length - 1].line === lines.length - 1
      && found[0].index === 0
      && found.every((item, i) => i === 0 || item.line === found[i - 1].line + 1)
    if (coherent) {
      const compact = (s: string) => s.replace(/[\s，,。：:、；;]/g, '')
      const consistent = options.filter(Boolean).length < 2
        || options.every((value, i) => {
          const text = found.find((f) => f.index === i)?.text ?? ''
          return !value || !text || compact(value).includes(compact(text)) || compact(text).includes(compact(value))
        })
      if (consistent) {
        options = options.map((value, i) => value || found.find((f) => f.index === i)?.text || '')
        stem = lines.filter((_line, i) => !found.some((f) => f.line === i)).join('\n').trim()
      }
    }
  }

  // ① 题干去行首题号
  stem = stripQuestionNumber(stem)

  // ② 选项缺失/不完整时，从题干里的 "A.xx B.xx C.xx D.xx" 抽取
  let inlineAnswer = ''
  if (options.filter(Boolean).length < 2) {
    const marks = Array.from(stem.matchAll(INLINE_OPTION_RE))
    const letters = marks.map((m) => toAscii(m[1]))
    if (marks.length >= 2 && letters.includes('A') && letters.includes('B')) {
      const extracted = ['', '', '', '']
      for (let i = 0; i < marks.length; i += 1) {
        const idx = letters[i].charCodeAt(0) - 65
        if (idx < 0 || idx > 3) continue
        const start = (marks[i].index ?? 0) + marks[i][0].length
        const end = i + 1 < marks.length ? (marks[i + 1].index ?? stem.length) : stem.length
        const segment = stem.slice(start, end).trim()
        const found = segment.match(ANSWER_RE)
        if (found?.[1]) inlineAnswer = toAscii(found[1])
        extracted[idx] = stripOptionLetter(segment.replace(ANSWER_RE, '').trim())
      }
      // 保留紧邻首个选项前面的标点（如「准确的是：A.」中的冒号属于题干）
      const firstLead = marks[0][0].match(/^[\s\n，,；;。：:]/)?.[0] ?? ''
      stem = (stem.slice(0, marks[0].index ?? 0) + firstLead).trim()
      options = extracted
    }
  }

  // ③ 答案回填：显式答案 → 行内抽取 → 题干/解析里的「答案：X」
  if (!answer && inlineAnswer) answer = normalizeAnswer(inlineAnswer)
  if (!answer) {
    for (const source of [stem, analysis]) {
      const found = source.match(ANSWER_RE)
      if (found) { answer = normalizeAnswer(found[1]); break }
    }
  }
  // 去掉题干/解析里残留的答案标注
  stem = stem.replace(ANSWER_RE, '').trim()
  analysis = analysis.replace(ANSWER_RE, '').trim()

  return { ...input, stem, options, answer, analysis }
}
