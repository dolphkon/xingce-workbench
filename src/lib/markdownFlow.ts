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
export const MD_GENERATE_PROMPT = `你是公务员考试（行测）试卷整理助手。把用户给的试卷文本（可能来自 OCR，含版式噪音）整理成【套卷固定模板】的 Markdown，模拟真实试卷按部分、按页排版，方便人工逐页校验。

只输出 Markdown 正文，不要输出 \`\`\` 代码块标记，不要任何解释或总结。

模板层级（严格遵守，不可调换）：
# 试卷名称（可选，只输出一次）

## 第一部分 言语理解与表达
### 第 1 页
#### 第 3 题
题型：单选题
模块：言语理解
材料：设问前的背景材料原文（没有就写「材料：」并留空）
题干：以下对应表述正确的有：

A. 选项正文
B. 选项正文
C. 选项正文
D. 选项正文
答案：B
解析：解析原文（没有就不写这一行）

### 第 2 页
#### 第 4 题
...

硬性要求：
1. 按原文「第X部分 / 模块标题」输出 "## 第X部分 模块名"；同一部分内按页输出 "### 第 N 页"。输入中的「【第 N 页】」是分页标记，必须据此输出对应页码；没有标记时按每页约 8 题顺序估算分页。每道题输出 "#### 第 N 题"：题号标题恰好 4 个 #、第与数字之间恰好 1 个空格、数字与「题」之间恰好 1 个空格，绝不能输出 5 个或 6 个 #，也不要双空格。题号用原文题号，可能从 42 开始，也可能按部分重置为 2、3，不要重新编号。
2. 一题一拆，绝不能把两道题塞进同一块；跨页被拆开的同一道题要合并回同一块，放在题目开始的那一页。若输入包含多套完整试卷（后面再次出现「公务员考试（行测）」等封面标题），每套卷单独输出一个 "# 试卷名"，页码各自从 1 开始；绝不能把后一套卷的标题、部分标题或页标题写进前一套卷的题干。
3. 剥离版式噪音：水印「复制必究」「版权所有」、乱码串、「第 X 页 共 Y 页」、密封线/装订线、条形码粘贴说明、考生须知/重要提示/注意事项条目、「（共 30 题，参考时间：28 分钟）」、推广串 biguo368 等。这些绝不写进材料/题干/选项/解析；同一行里的题目正文必须保留。
4. 题干必须写 "题干：" 字段前缀，不要写成「题干原文：」；题干只写设问，不要重复材料内容。
5. 材料可以为空（写成「材料：」后留空）；若原文是图形推理等图片题，材料里写 "![图形材料](原文图片地址)" 保留图片引用，不要臆造图片内容或把图形描述成文字题干。
6. 题干、材料、选项里的序号符号（1.、2.、①、②、⑴ 等）必须原样保留，不要擅自改成 ABCD。四个选项各占一行、按原文顺序；优先用 A./B./C./D. 标记，若原文就是 ①/1. 等符号则保留该符号。原文没有的选项留空行。
7. 题型只能是「单选题」或「多选题」；模块只能是「政治理论」「常识」「言语理解」「数量关系」「判断推理」「资料分析」，不确定填「常识」。模块的判断优先于部分标题：若该题内容与所在部分标题不符（例如常识题出现在言语部分），必须把「模块：」改成正确模块，并把该题归入对应部分；不要为了贴合部分标题而错填模块。
8. 答案只按原文标注（如「答案：B」或末尾答案表）回填，写在选项之后；找不到就写「答案：」并留空。
9. 若输入不是试题（如纯讲义），输出空字符串。
10. 部分标题只能是「## 第X部分 模块名」或「## 模块名」（如「## 常识判断」「## 其他」），绝不能写成「## 其他（常识）」这种混合标题；模块名与字段「模块：」保持一致。
11. 每个题块只能有一个「#### 第 N 题」标题，题块正文里绝不能再出现任何「第 N 题」「## 标题」「### 第 N 页」字样；遇到下一道题或「一、图形推理」「二、定义判断」等题型小标题，必须结束当前题块并另起题块/部分标题。
12. 选项必须从 A. 开始各占一行；原文形如「FA.3 B.5A.3 B.5C.6 D.12」的粘连串要按语义拆成 A./B./C./D. 四行，不能整串塞进题干或单个选项。
13. 「第 X 页 共 Y 页」「第X部分结束，请继续做第Y部分」「※※※」「公考资料每日更新记录」等转场/页眉噪音必须整行丢弃，不能粘进题干、材料或答案。`

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
- page：数字，该题所在 "### 第 N 页" 的页码；没有页标记时填 1
- section：字符串，该题所在 "## 第X部分 模块名" 的部分名称；没有时填空字符串

要求：
1. 每个题号标题块恰好转一道题，不合并、不拆分，顺序保留。题号标题兼容 1~8 个 #、全角空格和「第4题」等人工写法，统一按题号识别，不要因为 # 数量不同而漏题。
2. 按部分标题与页标题归属，把 section / page 填入对应题目；同一页的题目 page 相同。
3. 「题型：」「模块：」「答案：」「材料：」「题干：」字段行按值填入；题干取「题干：」之后、选项行之前的正文；解析取「解析：」后的内容。
4. 选项行可能是 "A. xxx" "1. xxx" "① xxx" 等形式，按出现顺序依次放入 options 下标 0/1/2/3；不要带前缀。原文留空的选项保持空字符串。
5. 保留原文中的 ①②③、⑴、1. 等序号符号，不要规范化、不要臆造、不把上一题内容带进下一题。
6. 若 Markdown 中没有题块，questions 返回空数组。
7. section 与 module 不一致时以 module 为准纠正 section（常识→常识判断，言语理解→言语理解与表达，政治理论→政治理论/常识判断），并保留原部分序号前缀（如「第一部分 常识判断」）；人工写出的「## 其他（常识）」「## 常识」等非标准标题也要识别为部分标题，绝不能当作题干正文。
8. 若题块内混入「第 N 题」「## 标题」「### 第 N 页」等结构行，先剔除这些行再取字段；一题一题输出，不复述题号标题。`

/**
 * 模板结构行统一识别。
 * 人工校验时常把题号标题写成 ##### / ######，或在「第」与数字间敲出多个空格；
 * 这里统一容忍 1~8 个 #、全角空格及「第4题」写法，避免分页目录/题数统计漏题。
 */
export const QUESTION_HEADING_RE = /^[ \t]*#{1,8}[ \t]*第?[ \t\u3000]*(\d{1,3})[ \t\u3000]*题/
const SECTION_MODULE_NAMES = '常识判断|常识|政治理论|言语理解与表达|言语理解|数量关系|判断推理|图形推理|定义判断|类比推理|逻辑判断|资料分析|其他'
/** 部分标题：既认「第X部分 模块名」，也认人工/AI 常写的「## 常识判断」「## 其他（常识）」 */
export const SECTION_HEADING_RE = new RegExp(
  String.raw`^[ \t]*#{1,8}[ \t]*((?:第[一二三四五六七八九十百\d]+(?:部分|章|篇)[^\n]*|(?:${SECTION_MODULE_NAMES})(?:[（(][^）)]{0,16}[）)])?))$`,
  'i',
)
export const PAGE_HEADING_RE = /^[ \t]*#{1,8}[ \t]*第?[ \t\u3000]*(\d{1,3})[ \t\u3000]*页[ \t]*$|^<!--\s*PAGE\s*[:：]?\s*(\d{1,3})\s*-->/im
/** 试卷转场/页眉噪音：AI 常把这些行粘进题干或题块之间 */
export const TRANSITION_NOISE_RE = /^(?:第[一二三四五六七八九十百\d]+部分结束[^\n]*|第\s*[\d\s]+\s*页\s*共\s*[\d\s]+\s*页|※+[^\n]*|公考资料每日更新记录[^\n]*)$/i
const PAPER_HEADING_RE = /^[ \t]*#[ \t]+(?!#)(.+)$/
const INLINE_STRUCTURE_RE = new RegExp(
  String.raw`\s+(?=#{1,8}[ \t]+(?:第[一二三四五六七八九十百\d]+(?:部分|章|篇)|第[ \t\u3000]*\d+[ \t\u3000]*[题页]|(?:${SECTION_MODULE_NAMES})(?:[（(]|\s|$)))`,
  'i',
)

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

/** 内联拆出的标题先打标记，稍后上提到下一道题目之前，避免留在上一题选项中间 */
const INLINE_HEADING_MARK = '\u0001'

/** 把粘在正文末尾的「## 其他（常识）」等结构标记拆成独立行 */
function splitInlineStructure(line: string): string[] {
  if (!INLINE_STRUCTURE_RE.test(line)) return [line]
  const parts = line.split(INLINE_STRUCTURE_RE).map((part) => part.trim()).filter(Boolean)
  if (parts.length <= 1) return [line]
  return parts.map((part, index) => index === 0 ? part : `${INLINE_HEADING_MARK}${part}`)
}

/** 统一标题层级与空格，避免「##### 第5题」「## 其他（常识）」破坏目录与预览 */
function normalizeHeadingLine(line: string): string {
  const marked = line.startsWith(INLINE_HEADING_MARK)
  const clean = marked ? line.slice(INLINE_HEADING_MARK.length) : line
  const question = clean.match(QUESTION_HEADING_RE)
  let normalized = clean
  if (question) normalized = `#### 第 ${Number(question[1])} 题`
  else {
    const page = clean.match(PAGE_HEADING_RE)
    if (page) normalized = `### 第 ${Number(page[1] ?? page[2])} 页`
    else {
      const section = clean.match(SECTION_HEADING_RE)
      if (section) normalized = `## ${section[1].trim()}`
      else {
        const paper = clean.match(PAPER_HEADING_RE)
        if (paper) normalized = `# ${paper[1].trim()}`
      }
    }
  }
  return marked ? `${INLINE_HEADING_MARK}${normalized}` : normalized
}

/** 内联拆出的标题上提到下一道题目之前 */
function hoistInlineHeadings(lines: string[]): string[] {
  const out: string[] = []
  const pending: string[] = []
  for (const line of lines) {
    if (line.startsWith(INLINE_HEADING_MARK)) {
      pending.push(line.slice(INLINE_HEADING_MARK.length))
      continue
    }
    if (pending.length && QUESTION_HEADING_RE.test(line)) {
      out.push(...pending)
      pending.length = 0
    }
    out.push(line)
  }
  if (pending.length) {
    const lastQuestion = out.map((line) => QUESTION_HEADING_RE.test(line)).lastIndexOf(true)
    out.splice(lastQuestion >= 0 ? lastQuestion : out.length, 0, ...pending)
  }
  return out
}

/**
 * 同一套卷内题号重复时顺延补齐。
 * 题号可能按部分重置（如 42 → 2），因此只在「大幅回落且该号未出现过」时开启新段；
 * 完全相同的小号重复（5 → 5）一律视为 AI 误写，避免多道题被解析成同一题。
 */
function dedupeQuestionHeadings(lines: string[]): string[] {
  let scope = 'default'
  let lastNo = 0
  const seen = new Map<string, Set<number>>()
  const max = new Map<string, number>()
  return lines.map((line) => {
    if (PAPER_HEADING_RE.test(line)) { scope = `paper:${line.trim()}`; lastNo = 0; return line }
    const question = line.match(QUESTION_HEADING_RE)
    if (!question) return line
    let no = Number(question[1])
    const used = seen.get(scope) ?? new Set<number>()
    if (lastNo >= 20 && no <= 8 && !used.has(no)) { used.clear(); lastNo = 0 }
    if (used.has(no)) {
      no = Math.max(max.get(scope) ?? 0, no) + 1
      while (used.has(no)) no += 1
    }
    used.add(no)
    seen.set(scope, used)
    max.set(scope, Math.max(max.get(scope) ?? 0, no))
    lastNo = no
    return `#### 第 ${no} 题`
  })
}

/**
 * 修复 AI/人工编辑常见的排版错误：
 * 1. 拆开粘在题干末尾的标题标记；
 * 2. 统一套卷/部分/页/题标题层级；
 * 3. 丢弃页眉与转场噪音；
 * 4. 同一部分内重复题号顺延，避免多道题被当成同一题覆盖。
 */
export function repairMarkdownTemplate(md: string): string {
  const lines = hoistInlineHeadings(normalizeMarkdown(md).split('\n')
    .flatMap(splitInlineStructure)
    .map(normalizeHeadingLine))
    .filter((line) => !TRANSITION_NOISE_RE.test(line.trim()))
  return normalizeMarkdown(dedupeQuestionHeadings(lines).join('\n'))
}

/** 按「第 N 题」标题切块；容忍 1~8 个 #、多余空格与全角空格 */
export function splitMarkdownBlocks(md: string): MdBlock[] {
  const lines = normalizeMarkdown(md).split('\n')
  const blocks: { no: number; lines: string[] }[] = []
  let current: { no: number; lines: string[] } | null = null
  for (const line of lines) {
    const match = line.match(QUESTION_HEADING_RE)
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
    // 套卷模板的结构行（部分/页/题号标题）不能混入上一题题干
    // 套卷模板的结构行（套卷标题/部分/页/题号标题）不能混入上一题题干
    const structuralRe = new RegExp(
      `^[ \\t]*#{1,8}[ \\t]|${SECTION_HEADING_RE.source}|${PAGE_HEADING_RE.source}|${QUESTION_HEADING_RE.source}`,
      'i',
    )
    for (const line of lines) {
      if (structuralRe.test(line)) { inAnalysis = false; continue }
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

/** 单题 → 标准 Markdown 块（题号用原文编号，支持重置/跳号）；heading 可指定 ## / #### */
export function questionToBlock(question: QuizQuestion, no: number, heading = '##'): string {
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
    `${heading} 第 ${no} 题`,
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

const compactText = (text: string): string => String(text ?? '')
  .replace(/[\s\u3000]/g, '')
  .replace(/[，。、；：！？“”‘’（）()【】\[\]《》〈〉·—-]/g, '')

/**
 * 用规则切题结果校验 AI 生成的 Markdown：
 * 1. AI 漏掉的题号补回（题号重置、末题丢失）；
 * 2. AI 编造或错编的题号按题干锚点纠正/丢弃（如把原文第 11 题写成第 43 题）；
 * 3. 剥掉题块内误插入的标题行，以及原文中不存在的试卷标题/部分标题。
 */
export function mergeMarkdownWithRules(aiMarkdown: string, rawText: string): string {
  const answerKey = extractAnswerKey(rawText)
  const ruleBlocks = splitByQuestionNumbers(rawText)
  const ruleNos = new Set(ruleBlocks.map((block) => block.no))
  const ruleByNo = new Map(ruleBlocks.map((block) => [block.no, block]))

  const usedNos = new Set<number>()
  /** 按题干锚点回查原文题块；已占用的题号不再命中，避免重复题号反复回填同一道题 */
  const findRuleByStem = (stem: string) => {
    if (stem.length < 8) return undefined
    const candidates = ruleBlocks.filter((rule) => !usedNos.has(rule.no))
    return candidates.find((rule) => compactText(rule.text).includes(stem))
      ?? candidates.find((rule) => compactText(rule.text).includes(stem.slice(0, 12)))
  }

  const aligned = splitMarkdownBlocks(aiMarkdown).map((block): string | null => {
    let no = block.no
    const stem = compactText(readField(block.body, '题干')).slice(0, 30)
    const matched = findRuleByStem(stem)
    if (matched) no = matched.no
    else if (!ruleNos.has(no)) return null
    // 题号重复且题干无法回查时保留 AI 文本，由后续 repairMarkdownTemplate 顺延编号
    const keepAsIs = !matched && usedNos.has(no)
    usedNos.add(no)
    const ruleBlock = ruleByNo.get(no)
    const inRaw = Boolean(ruleBlock && stem.length >= 8 && compactText(ruleBlock.text).includes(stem))
    if (!keepAsIs && !inRaw && ruleBlock) {
      const question = ruleParseBlock(ruleBlock, answerKey)
      if (question) return questionToBlock(question, no, '####')
    }
    // 题块内误插的套卷标题/部分/页标题不能留在题干里
    const body = block.body.split('\n')
      .filter((line) => !/^[ \t]*#{1,8}[ \t]/.test(line) && !/<!--\s*PAGE/i.test(line))
      .join('\n').trim()
    return `#### 第 ${no} 题\n${body}`
  }).filter((block): block is string => Boolean(block))

  const compactRaw = compactText(rawText)
  const sanitized = aligned.join('\n\n').split('\n').filter((line) => {
    const heading = line.match(/^[ \t]*#{1,3}[ \t]+(.+)$/)
    if (!heading) return true
    const name = heading[1].trim()
    // 部分/页标题是模板结构行，保留；套卷名必须能在原文找到，避免模型臆造新试卷
    if (SECTION_HEADING_RE.test(`## ${name}`) || /^第[ \t]*\d+[ \t]*页$/.test(name)) return true
    return compactRaw.includes(compactText(name))
  }).join('\n')

  const aiNos = new Set(splitMarkdownBlocks(sanitized).map((block) => block.no))
  const missing = ruleBlocks
    .filter((block) => !aiNos.has(block.no))
    .map((block) => ({ no: block.no, question: ruleParseBlock(block, answerKey) }))
    .filter((item): item is { no: number; question: QuizQuestion } => Boolean(item.question))
  const extras = missing.map((item) => questionToBlock(item.question, item.no)).join('\n')
  return repairMarkdownTemplate([sanitized, extras].filter(Boolean).join('\n\n'))
}

/** 无 AI 时的阶段①兜底：用规则切题结果生成 Markdown */
export function ruleTextToMarkdown(text: string, title = ''): string {
  const questions = ruleParseAll(text)
  if (!questions.length) return ''
  return questionsToMarkdown(questions, title)
}
