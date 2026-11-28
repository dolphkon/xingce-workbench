/**
 * 两阶段拆题的 Markdown 中间层。
 *
 * 阶段①：AI（或规则兜底）把清洗后的试卷文本整理成结构化 Markdown；
 * 人工在页面上校验/编辑排版、下载 .md、再上传；
 * 阶段②：AI（或规则兜底）把校验后的 Markdown 解析成待确认题目。
 *
 * 这样把「识别」与「结构化确认」解耦：OCR/AI 在阶段①出错了，人工可以直接改 Markdown，
 * 不必重新上传整份文档，也不必在几十道题里逐个修补粘连题干。
 *
 * 字段顺序固定：题号 → 题型 → 模块 → 材料 → 题干 → 选项 → 答案 → 解析。
 * 材料可为空，也可含 Markdown 图片（![...](data:image/...)）；
 * 材料/题干/选项中的 ①②③、1. 等序号符号按原样保留。
 */
import type { QuizQuestion } from '../types'
import {
  ruleParseAll, formatStem, splitByQuestionNumbers, extractAnswerKey, ruleParseBlock,
} from './paperSplit'
import { stripResidualBoilerplate } from './examClean'
import { uid } from './utils'

/** 阶段①提示词：文本 → 结构化 Markdown */
export const MD_GENERATE_PROMPT = `你是公务员考试（行测）试卷整理助手。把用户给的试卷文本（可能来自 OCR，含版式噪音）整理成规范的结构化 Markdown，方便人工逐题校对。

只输出 Markdown 正文，不要输出 \`\`\` 代码块标记，不要任何解释或总结。

格式规范（严格遵守，字段顺序不可调换）：
# 试卷名称（可选，只输出一次）

## 第 3 题
题型：单选题
模块：常识判断
材料：设问前的背景材料原文（没有就写「材料：」并留空）
题干：以下对应表述正确的有：

A. 选项正文
B. 选项正文
C. 选项正文
D. 选项正文
答案：B
解析：解析原文（没有就不写这一行）

硬性要求：
1. 每遇到一个题号新起一个 "## 第 N 题" 块；题号用原文题号，可能从 42 开始，也可能按部分重置为 2、3，不要重新编号。
2. 一题一拆，绝不能把两道题塞进同一块；跨页被拆开的同一道题要合并回同一块。
3. 剥离版式噪音：水印「复制必究」「版权所有」、乱码串、「第 X 页 共 Y 页」、密封线/装订线、条形码粘贴说明、考生须知/重要提示/注意事项条目、「第 X 部分 言语理解」「（共 30 题，参考时间：28 分钟）」、推广串 biguo368 等。这些绝不写进材料/题干/选项/解析；同一行里的题目正文必须保留。
4. 题干必须写 "题干：" 字段前缀，不要写成「题干原文：」；题干只写设问，不要重复材料内容。
5. 材料可以为空（写成「材料：」后留空）；若原文是图形推理等图片题，材料里写 "![图形材料](原文图片地址)" 保留图片引用，不要臆造图片内容或把图形描述成文字题干。
6. 题干、材料、选项里的序号符号（1.、2.、①、②、⑴ 等）必须原样保留，不要擅自改成 ABCD。四个选项各占一行、按原文顺序；优先用 A./B./C./D. 标记，若原文就是 ①/1. 等符号则保留该符号。原文没有的选项留空行。
7. 题型只能是「单选题」或「多选题」；模块只能是「政治理论」「常识」「言语理解」「数量关系」「判断推理」「资料分析」，不确定填「常识」。
8. 答案只按原文标注（如「答案：B」或末尾答案表）回填，写在选项之后；找不到就写「答案：」并留空。
9. 若输入不是试题（如纯讲义），输出空字符串。`

/** 阶段②提示词：人工校验后的 Markdown → 题目 JSON */
export const MD_PARSE_PROMPT = `你是行测题库录入助手。用户会给一份已人工校验过的结构化 Markdown 试卷，请把它转成严格 JSON。

只输出 JSON，不要代码块标记、不要解释文字。顶层结构：{"questions":[{...}]}

每道题必须用这些字段名（切勿用别名）：
- no：数字题号
- type：题型（单选题/多选题）
- module：模块
- material：材料原文，没有填空字符串
- stem：题干设问原文（取「题干：」字段后的内容，不含材料、选项、答案等字段行）
- options：长度恰好为 4 的字符串数组，依次对应四个选项，只填正文不带「A.」「①」等前缀
- answer：答案字母（多选如 AB），没有填空字符串
- analysis：解析文本，没有填空字符串
- images：字符串数组，材料或题干中 "![...](地址)" 图片的地址原样放入，没有填空数组

要求：
1. 每个 "## 第 N 题" 块恰好转一道题，不合并、不拆分，顺序保留。
2. 「题型：」「模块：」「答案：」「材料：」「题干：」字段行按值填入；题干取「题干：」之后、选项行之前的正文；解析取「解析：」后的内容。
3. 选项行可能是 "A. xxx" "1. xxx" "① xxx" 等形式，按出现顺序依次放入 options 下标 0/1/2/3；不要带前缀。原文留空的选项保持空字符串。
4. 保留原文中的 ①②③、⑴、1. 等序号符号，不要规范化、不要臆造、不把上一题内容带进下一题。
5. 若 Markdown 中没有题块，questions 返回空数组。`

/** Markdown 题块 */
export interface MdBlock { no: number; body: string }

/** 去掉可能的代码块包裹，统一换行 */
export function normalizeMarkdown(input: string): string {
  let md = String(input ?? '').replace(/\r\n?/g, '\n').trim()
  md = md.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
  // 合并题块之间多余的空行
  md = md.replace(/\n{3,}/g, '\n\n')
  return md
}

/** 按「## 第 N 题」切块；块外文本（如 # 标题）忽略 */
export function splitMarkdownBlocks(md: string): MdBlock[] {
  const lines = normalizeMarkdown(md).split('\n')
  const blocks: { no: number; lines: string[] }[] = []
  let current: { no: number; lines: string[] } | null = null
  for (const line of lines) {
    const match = line.match(/^\s*##\s*第?\s*(\d{1,3})\s*题/)
    if (match) {
      if (current) blocks.push(current)
      current = { no: Number(match[1]), lines: [] }
      continue
    }
    if (current) current.lines.push(line)
  }
  if (current) blocks.push(current)
  return blocks.map((block) => ({ no: block.no, body: block.lines.join('\n').trim() }))
}

/** 读取字段值；题干同时兼容早期 AI 误写的「题干原文：」 */
function readField(body: string, name: string): string {
  const pattern = name === '题干' ? '题干(?:原文)?' : name
  // 行内空白用 [ \t]，避免 \s 吞掉换行把下一行字段当成本字段的值
  const match = body.match(new RegExp(`^[ \\t]*(?:[-*][ \\t]*)?${pattern}[ \\t]*[:：][ \\t]*(.*)$`, 'm'))
  return match ? match[1].trim() : ''
}

/** 从文本中抽出 Markdown 图片，返回去掉图片标记后的纯文本 */
export function extractMarkdownImages(text: string): { text: string; images: string[] } {
  const images: string[] = []
  const cleaned = String(text ?? '')
    .replace(/!\[([^\]]*)\]\(\s*([^\s)]+)[^)]*\)/g, (_all, _alt: string, url: string) => {
      const src = String(url ?? '').trim()
      if (src) images.push(src)
      return ''
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return { text: cleaned, images }
}

const CIRCLED_OPTIONS = ['①', '②', '③', '④']
const PAREN_CIRCLED_OPTIONS = ['⑴', '⑵', '⑶', '⑷']
const DOT_CIRCLED_OPTIONS = ['⒈', '⒉', '⒊', '⒋']

/**
 * 解析选项行：支持 A./A、/（A）、1./（1）/1、/①/⑴/⒈ 等序号。
 * 返回 null 表示该行不是选项。
 */
export function parseOptionLine(line: string): { index: number; text: string } | null {
  const s = String(line ?? '').trim()
  if (!s) return null
  let m = s.match(/^[（(]?\s*([A-Da-dＡ-Ｄ])\s*[.．、:：)）]\s*(.*)$/)
  if (m) return { index: m[1].toUpperCase().charCodeAt(0) - 65, text: m[2].trim() }
  m = s.match(/^[（(]\s*([1-4])\s*[）)]\s*[.．、:：]?\s*(.*)$/)
  if (m) return { index: Number(m[1]) - 1, text: m[2].trim() }
  m = s.match(/^([1-4])\s*[.．、:：)]\s*(.*)$/)
  if (m) return { index: Number(m[1]) - 1, text: m[2].trim() }
  const symbol = CIRCLED_OPTIONS.find((v) => s.startsWith(v))
    ?? PAREN_CIRCLED_OPTIONS.find((v) => s.startsWith(v))
    ?? DOT_CIRCLED_OPTIONS.find((v) => s.startsWith(v))
  if (symbol) {
    const group = [CIRCLED_OPTIONS, PAREN_CIRCLED_OPTIONS, DOT_CIRCLED_OPTIONS].find((g) => g.includes(symbol))!
    return { index: group.indexOf(symbol), text: s.slice(symbol.length).replace(/^\s*[.．、:：]\s*/, '').trim() }
  }
  return null
}

/** 规则兜底：把 Markdown 解析成题目（AI 不可用时使用） */
export function ruleMarkdownToQuestions(md: string): QuizQuestion[] {
  return splitMarkdownBlocks(md).map((block) => {
    const lines = block.body.split('\n')
    const stemLines: string[] = []
    const analysisLines: string[] = []
    let inAnalysis = false
    const options = ['', '', '', '']
    const fieldRe = /^\s*(?:[-*]\s*)?(?:题型|模块|答案|材料|题干(?:原文)?)\s*[:：]/
    for (const line of lines) {
      const analysisMatch = line.match(/^\s*(?:[-*]\s*)?解析\s*[:：]\s*(.*)$/)
      if (analysisMatch) {
        inAnalysis = true
        if (analysisMatch[1].trim()) analysisLines.push(analysisMatch[1].trim())
        continue
      }
      if (fieldRe.test(line)) { inAnalysis = false; continue }
      const option = parseOptionLine(line)
      if (option) { inAnalysis = false; options[option.index] = option.text; continue }
      if (inAnalysis) { if (line.trim()) analysisLines.push(line.trim()); continue }
      if (line.trim()) stemLines.push(line.trim())
    }
    const explicitStem = readField(block.body, '题干')
    let stem = explicitStem
    if (explicitStem) {
      // 题干字段后若还有自由文本行，视为题干续行（如换行后的设问）
      const extra = stemLines.filter((line) => line !== explicitStem).join('\n')
      if (extra && !stem.includes(extra)) stem = `${stem}\n${extra}`
    } else {
      stem = stemLines.join('\n')
    }
    const materialRaw = readField(block.body, '材料')
    const materialParsed = extractMarkdownImages(materialRaw)
    const stemParsed = extractMarkdownImages(stem)
    const material = materialParsed.text
    stem = stemParsed.text
    const images = [...materialParsed.images, ...stemParsed.images]
    const answer = (readField(block.body, '答案') || block.body.match(/(?:正确|参考|标准)?\s*答案\s*[:：]\s*([A-Da-d]{1,4})/i)?.[1] || '').toUpperCase()
    const type = readField(block.body, '题型') || '单选题'
    const module = readField(block.body, '模块') || '常识'
    const analysis = analysisLines.join('\n') || readField(block.body, '解析')
    const formattedStem = formatStem(stem)
    return {
      id: uid(),
      title: material ? `【共用材料】${material}\n【题目】${formattedStem}` : formattedStem,
      options,
      answer,
      analysis: stripResidualBoilerplate(analysis),
      type: type.includes('多') ? `${module}·多选题` : module,
      images,
    }
  }).filter((question) => question.title.trim().length > 0)
}

/** 单题 → 标准 Markdown 块（题号用原文编号，支持重置/跳号） */
export function questionToBlock(question: QuizQuestion, no: number): string {
  const [material, stem] = question.title.includes('【题目】')
    ? question.title.split('【题目】').map((part) => part.replace(/^【共用材料】/, '').trim())
    : ['', question.title.trim()]
  const type = /多选|AB|AC|AD|BC|BD|CD|ABC|ABD|ACD|BCD/.test(`${question.type}${question.answer}`) ? '多选题' : '单选题'
  const module = question.type.replace(/[·•]?\s*(?:单选题|多选题)\s*$/, '').trim() || '常识'
  const materialImages = (question.images ?? [])
    .filter((src) => /^(data:image\/|https?:\/\/|attachment:)/i.test(src))
    .map((src) => `![图形材料](${src})`)
  const materialText = [material, ...materialImages].filter(Boolean).join(' ')
  const parts = [
    `## 第 ${no} 题`,
    `题型：${type}`,
    `模块：${module}`,
    `材料：${materialText}`,
    `题干：${stem}`,
    '',
  ]
  question.options.slice(0, 4).forEach((option, i) => {
    parts.push(`${String.fromCharCode(65 + i)}. ${option.trim()}`)
  })
  parts.push(`答案：${question.answer.trim().toUpperCase()}`)
  if (question.analysis.trim()) parts.push('', `解析：${question.analysis.trim()}`)
  parts.push('')
  return parts.join('\n')
}

/** 把题目序列化成标准 Markdown（下载、人工编辑的起点） */
export function questionsToMarkdown(questions: QuizQuestion[], title = ''): string {
  const parts: string[] = []
  if (title.trim()) parts.push(`# ${title.trim()}`, '')
  questions.forEach((question, index) => parts.push(questionToBlock(question, index + 1)))
  return normalizeMarkdown(parts.join('\n'))
}

/**
 * 用规则切题结果校验 AI 生成的 Markdown：
 * AI 常把题号重置后的小序号题或末尾题漏掉（截图中的第 43 题、重置的第 2 题）。
 * 规则按题号切分的召回更稳定，这里把 AI 漏掉的题号补回中间稿，保证人工校验前题目齐全。
 */
export function mergeMarkdownWithRules(aiMarkdown: string, rawText: string): string {
  const aiBlocks = splitMarkdownBlocks(aiMarkdown)
  const aiNos = new Set(aiBlocks.map((block) => block.no))
  const answerKey = extractAnswerKey(rawText)
  const missing = splitByQuestionNumbers(rawText)
    .filter((block) => !aiNos.has(block.no))
    .map((block) => ({ no: block.no, question: ruleParseBlock(block, answerKey) }))
    .filter((item): item is { no: number; question: QuizQuestion } => Boolean(item.question))
  if (!missing.length) return aiMarkdown
  // 按原文顺序插回：题号小的在前，题号重置的（如 42→2）放对应位置之后
  const extras = missing.map((item) => questionToBlock(item.question, item.no)).join('\n')
  return normalizeMarkdown(`${aiMarkdown}\n\n${extras}`)
}

/** 无 AI 时的阶段①兜底：用规则切题结果生成 Markdown */
export function ruleTextToMarkdown(text: string, title = ''): string {
  const questions = ruleParseAll(text)
  if (!questions.length) return ''
  return questionsToMarkdown(questions, title)
}
