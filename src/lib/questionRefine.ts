/**
 * 拆题结果后处理与准确度校验。
 *
 * 背景：题库后台识别「言语理解片段阅读」题时，模型常把整段文段塞进 stem、
 * 把设问句丢掉，也会把挤在一行的 A./B./C./D. 选项当成一条。
 * 本模块以人工矫正后的标准结构为锚点，对模型/规则输出做确定性修复：
 *   1. 从单行文本中切出 A/B/C/D 四个独立选项；
 *   2. 将「文段 + 设问」拆成 material / stem；
 *   3. 回填散落在文本里的「答案：X」，规范化选项字母；
 *   4. 依据答案字母修正单选题/多选题，并兜底推断模块。
 *
 * 纯函数、无副作用，便于单元测试与模型输出后统一调用。
 */
import { BANK_MODULES } from '../types'

export interface RefinableBankQuestion {
  category: '单选题' | '多选题'
  module: string
  material: string
  stem: string
  options: string[]
  answer: string
  analysis: string
}

/** 言语理解/资料分析等题型常见的设问句开头 */
const STEM_CUE = [
  '对上述文段', '对这段文字', '对以上文段', '对上文',
  '根据(?:上述|这段|以上|所给|材料)?(?:文段|文字|材料|文章|内容)',
  '这段文字', '上述文段', '以上文段', '这段话', '本段文字',
  '下列说法', '以下说法', '下列选项', '下列成语', '下列词语',
  '填入(?:画|划)?横线', '该文段', '文中',
  '文章(?:主要|意在|讲述)', '作者(?:主要|意在)', '文段(?:主要|意在)',
].join('|')

/** 匹配「……句号 + 设问句」结构，设问句必须位于文本末尾 */
const MATERIAL_STEM_RE = new RegExp(
  `[。！？；!?\\n]\\s*((?:${STEM_CUE})[^。！？\\n；;]{0,80}[：:？?]?)\\s*$`,
)

/** 单行里出现的选项标记：前面是空白或中文标点，形如「 A. 」「，B、」 */
const INLINE_OPTION_RE = /(?:^|[\s\n，,；;。：:])([A-Da-dＡ-Ｄ])\s*[.．、:：]\s*/g

/** 文本中的答案标注 */
const ANSWER_RE = /(?:正确|参考|标准)?\s*答案\s*(?:是|为)?\s*[:：]?\s*([A-Da-dＡ-Ｄ][A-Da-dＡ-Ｄ、,，\s]*)/i

function isBankModule(value: string): boolean {
  return (BANK_MODULES as readonly string[]).includes(value)
}

/** 关键词兜底推断模块（仅在模型给出非法模块时使用） */
function guessModule(text: string): string {
  if (/增长率|增长量|比重|平均数|倍数|同比|环比|统计|亿元|万人/.test(text)) return '资料分析'
  if (/削弱|加强|论证|推理|定义判断|类比|图形|空间重构|逻辑/.test(text)) return '判断推理'
  if (/工程|行程|排列组合|概率|利润|容斥|浓度|年龄|方程|数字推理/.test(text)) return '数量关系'
  if (/主旨|意图|细节|标题|语句排序|逻辑填空|词语|文段|这段文字|概括准确/.test(text)) return '言语理解'
  if (/党|政治|马列|毛泽东|邓小平|习近平|二十大|党史|马克思主义/.test(text)) return '政治理论'
  return '常识'
}

/** 去掉选项文本前残留的字母前缀，如「B. 免密技术…」→「免密技术…」 */
function stripOptionPrefix(value: string): string {
  return value.trim().replace(/^[A-Da-dＡ-Ｄ]\s*[.．、:：)）]\s*/, '').trim()
}

/**
 * 从一段文字中抽出多个选项。
 * 返回剩余正文（最后一个选项之前的文字）与四个选项；不足 2 个选项标记时返回 null。
 */
function extractInlineOptions(text: string): { rest: string; options: string[]; answer: string } | null {
  const marks = Array.from(text.matchAll(INLINE_OPTION_RE))
  if (marks.length < 2) return null
  const letters = marks.map((m) => m[1].toUpperCase().replace('Ｄ', 'D').replace('Ａ', 'A').replace('Ｂ', 'B').replace('Ｃ', 'C'))
  if (!letters.includes('A') || !letters.includes('B')) return null
  const options = ['', '', '', '']
  let answer = ''
  for (let i = 0; i < marks.length; i += 1) {
    const start = (marks[i].index ?? 0) + marks[i][0].length
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? text.length) : text.length
    const idx = letters[i].charCodeAt(0) - 65
    if (idx < 0 || idx > 3) continue
    // 末尾可能跟着「答案：B」：取出来回填，且不写进选项正文
    const segment = text.slice(start, end).trim()
    const answerMatch = segment.match(ANSWER_RE)
    if (answerMatch?.[1]) answer = answerMatch[1]
    options[idx] = stripOptionPrefix(segment.replace(ANSWER_RE, '').trim())
  }
  if (!options.some(Boolean)) return null
  return { rest: text.slice(0, marks[0].index ?? 0).trim(), options, answer }
}

/** 把「文段 + 设问」拆开；无法识别设问句时返回 null */
function splitMaterialStem(text: string): { material: string; stem: string } | null {
  const match = text.match(MATERIAL_STEM_RE)
  if (!match) return null
  const boundary = match.index ?? 0
  // 保留设问前的句号，材料原文不能缺末尾标点（人工矫正后与原文一致）
  const material = text.slice(0, boundary + 1).trim()
  const stem = match[1].trim()
  // 文段过短说明整段就是设问，不拆
  if (!material || material.length < 12 || !stem) return null
  return { material, stem }
}

/** 规范化答案字母：去重、升序、剔除不存在于选项中的字母 */
function normalizeAnswer(raw: string, options: string[]): string {
  const letters = Array.from(new Set(raw.toUpperCase().replace(/[^A-D]/g, ''))).sort()
  return letters.filter((L) => {
    const idx = L.charCodeAt(0) - 65
    return idx >= 0 && idx < options.length && Boolean(options[idx])
  }).join('')
}

/**
 * 对单道题执行后处理修复。
 * 不修改入参，返回修复后的新对象。
 */
export function refineBankQuestion<T extends RefinableBankQuestion>(input: T): T {
  let stem = String(input.stem ?? '').trim()
  let material = String(input.material ?? '').trim()
  let analysis = String(input.analysis ?? '').trim()
  const options = Array.isArray(input.options)
    ? ['A', 'B', 'C', 'D'].map((_, i) => stripOptionPrefix(String(input.options[i] ?? '')))
    : ['', '', '', '']

  // ① 选项挤在题干里：先抽出选项，再处理设问；同时保留行内「答案：X」
  let inlineAnswer = ''
  if (options.filter(Boolean).length < 2) {
    const fromStem = extractInlineOptions(stem)
    if (fromStem) {
      stem = fromStem.rest
      fromStem.options.forEach((o, i) => { if (o) options[i] = o })
      inlineAnswer = fromStem.answer
    }
  }
  if (options.filter(Boolean).length < 2 && material) {
    const fromMaterial = extractInlineOptions(material)
    if (fromMaterial) {
      material = fromMaterial.rest
      fromMaterial.options.forEach((o, i) => { if (o) options[i] = o })
      inlineAnswer = inlineAnswer || fromMaterial.answer
    }
  }

  // ② 文段/设问分离：以人工矫正结果为准，material 保留文段原文，stem 只留设问句
  const split = splitMaterialStem(stem)
  if (split) {
    stem = split.stem
    if (!material) material = split.material
  }
  if (!stem && material) {
    const splitFromMaterial = splitMaterialStem(material)
    if (splitFromMaterial) { material = splitFromMaterial.material; stem = splitFromMaterial.stem }
  }

  // ③ 答案回填：显式 answer → 行内抽取的答案 → 题干/材料/解析中的「答案：X」
  let answer = normalizeAnswer(String(input.answer ?? ''), options)
  if (!answer && inlineAnswer) answer = normalizeAnswer(inlineAnswer, options)
  if (!answer) {
    for (const source of [stem, material, analysis]) {
      const found = source.match(ANSWER_RE)
      if (found) { answer = normalizeAnswer(found[1], options); break }
    }
  }
  // 去掉题干/材料/解析中残留的答案标注，但保留原有标点
  const stripAnswer = (s: string) => s.replace(ANSWER_RE, '').trim()
  stem = stripAnswer(stem)
  material = stripAnswer(material)
  analysis = stripAnswer(analysis)

  // ④ 类别与模块校正
  const category: '单选题' | '多选题' = answer.length > 1 ? '多选题' : input.category === '多选题' ? '多选题' : '单选题'
  const guessedModule = guessModule(`${material} ${stem}`)
  // 模型常把片段阅读/资料分析误填为默认的「常识」；有明确关键词时按内容纠正
  const module = !isBankModule(input.module) || input.module === '常识'
    ? (guessedModule || '常识')
    : input.module

  return {
    ...input,
    category,
    module,
    material,
    stem,
    options,
    answer,
    analysis,
  }
}

/** 批量后处理 */
export function refineBankQuestions<T extends RefinableBankQuestion>(items: T[]): T[] {
  return items.map(refineBankQuestion)
}
