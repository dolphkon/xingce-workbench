/**
 * 题库后台图片识别拆题引擎。
 *
 * 流程：图片 → 本地 OCR 提取文字 → 大模型结构化拆题（category/module/material/stem/options）
 *      → 能力不可用时自动降级为规则拆题（题号切分 + parseQuestionText）。
 * 输出：每题带唯一 ID 的 BankQuestion JSON，可直接入库。
 */
import { BANK_MODULES, type BankCategory, type BankQuestion } from '../types'
import { recognizeImage } from './ocr'
import { formatQuestionText, uid } from './utils'
import { probeLlm, structureQuestionsForBank, type LlmBankQuestion, type LlmProgress } from './llm'

export interface BankParseProgress {
  percent: number
  stage: string
}

export interface BankParseResult {
  questions: BankQuestion[]
  usedLlm: boolean
  method: string
  message: string
}

interface SourceImage { stored: string; ocr: string }

/** 依据题干关键词猜测所属模块（规则兜底用） */
function guessModule(text: string): string {
  const t = text
  if (/增长率|增长量|比重|平均数|倍数|同比|环比|统计|亿元|万人/.test(t)) return '资料分析'
  if (/削弱|加强|论证|推理|定义判断|类比|图形|空间重构|逻辑/.test(t)) return '判断推理'
  if (/工程|行程|排列组合|概率|利润|容斥|浓度|年龄|方程|数字推理/.test(t)) return '数量关系'
  if (/主旨|意图|细节|标题|语句排序|逻辑填空|词语|文段|这段文字/.test(t)) return '言语理解'
  if (/党|政治|马列|毛泽东|邓小平|习近平|二十大|党史|马克思主义/.test(t)) return '政治理论'
  return '常识'
}

/** 从每行开头的题号切分整段文字（兼容题号挤在句中） */
function splitByQuestionNo(text: string): string[] {
  const clean = text.replace(/\r/g, '').trim()
  const re = /(?:^|\n)\s*(?:第\s*)?(\d{1,3})\s*[.．、]\s*/
  const matches = Array.from(clean.matchAll(new RegExp(re.source, 'g')))
  if (matches.length < 2) return clean ? [clean] : []
  const parts: string[] = []
  for (let i = 0; i < matches.length; i += 1) {
    const start = (matches[i].index ?? 0) + (matches[i][0].startsWith('\n') ? 1 : 0)
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? clean.length) : clean.length
    const block = clean.slice(start, end).trim()
    if (block) parts.push(block)
  }
  return parts
}

/** 规则降级：按题号切块，逐块拆题干/选项/答案 */
function ruleParse(text: string, images: string[]): BankQuestion[] {
  const blocks = splitByQuestionNo(text)
  const now = Date.now()
  const out: BankQuestion[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue
    // 去掉行首题号
    lines[0] = lines[0].replace(/^(?:第\s*)?\d{1,3}\s*[.．、]\s*/, '')
    const stemLines: string[] = []
    const options = ['', '', '', '']
    let answer = ''
    const answerLineRe = /(?:正确|参考|标准)?\s*答案\s*(?:是|为)?\s*[:：]?\s*([A-Da-dＡ-Ｄ][A-Da-dＡ-Ｄ、,，\s]*)/i
    for (const line of lines) {
      const am = line.match(answerLineRe)
      if (am) { answer = am[1].replace(/[^A-Da-d]/gi, '').toUpperCase(); continue }
      const om = line.match(new RegExp(`^([A-Da-dＡ-Ｄ])\\s*[.．、:：)）]\\s*(.*)$`))
      if (om) {
        const idx = om[1].toUpperCase().charCodeAt(0) - 65
        if (idx >= 0 && idx < 4) { options[idx] = formatQuestionText(om[2]); continue }
      }
      stemLines.push(line)
    }
    const stem = formatQuestionText(stemLines.join('\n'))
    if (!stem && !options.some(Boolean)) continue
    const category: BankCategory = answer.length > 1 ? '多选题' : '单选题'
    out.push({
      id: uid(),
      category,
      module: guessModule(stem),
      material: '',
      stem,
      options,
      answer,
      analysis: '',
      images,
      createdAt: now,
      updatedAt: now,
    })
  }
  return out
}

/** 把大模型结构化结果转为题库题目（每题唯一 ID） */
function toBankQuestions(items: LlmBankQuestion[], images: string[]): BankQuestion[] {
  const now = Date.now()
  return items
    .filter((q) => q.stem || q.options.some(Boolean))
    .map((q) => ({
      id: uid(),
      category: q.category,
      module: BANK_MODULES.includes(q.module as (typeof BANK_MODULES)[number]) ? q.module : '常识',
      material: formatQuestionText(q.material),
      stem: formatQuestionText(q.stem),
      options: q.options.map((o) => formatQuestionText(o)),
      answer: q.answer,
      analysis: formatQuestionText(q.analysis),
      images,
      createdAt: now,
      updatedAt: now,
    }))
}

/**
 * 从一组图片识别并拆出题库题目。
 * @param images 已读取的图片（stored 为压缩存储图，ocr 为原始清晰图）
 * @param onProgress 进度回调（0~100）
 * @param signal 取消信号
 */
export async function parseImagesToBank(
  images: SourceImage[],
  onProgress?: (p: BankParseProgress) => void,
  signal?: AbortSignal,
): Promise<BankParseResult> {
  if (!images.length) throw new Error('请先上传题目图片')

  // 阶段一：本地 OCR 逐张提取文字（0~35%）
  const texts: string[] = []
  for (let i = 0; i < images.length; i += 1) {
    if (signal?.aborted) throw new Error('已取消')
    onProgress?.({ percent: Math.round((i / images.length) * 35), stage: `正在识别第 ${i + 1}/${images.length} 张图片…` })
    const text = await recognizeImage(images[i].ocr, (p, stage) => {
      const base = (i / images.length) * 35
      onProgress?.({ percent: Math.min(35, Math.round(base + p * (35 / images.length))), stage: stage || `正在识别第 ${i + 1} 张…` })
    })
    if (text.trim()) texts.push(text.trim())
  }
  if (!texts.length) throw new Error('未识别出文字，请换用更清晰的图片')

  const combined = texts.join('\n\n')
  const storedImages = images.map((i) => i.stored)

  // 阶段二：优先大模型结构化（35~92%）
  const probe = await probeLlm()
  if (probe.available) {
    try {
      const items = await structureQuestionsForBank(combined, signal, (p: LlmProgress) => {
        onProgress?.({ percent: Math.round(35 + p.fraction * 57), stage: p.message })
      })
      const questions = toBankQuestions(items, storedImages)
      if (questions.length) {
        onProgress?.({ percent: 100, stage: '识别完成' })
        return { questions, usedLlm: true, method: '大模型智能拆题', message: probe.message }
      }
    } catch {
      // 落到规则拆题
    }
  }

  // 阶段三：规则降级（92~100%）
  onProgress?.({ percent: 92, stage: '智能拆题不可用，正在用规则拆题…' })
  const questions = ruleParse(combined, storedImages)
  if (!questions.length) throw new Error('未能从图片中识别出题目，请检查图片内容或手动录入')
  onProgress?.({ percent: 100, stage: '识别完成' })
  return {
    questions,
    usedLlm: false,
    method: 'OCR 规则拆题',
    message: probe.available ? '智能拆题未返回有效结果，已自动改用规则拆题' : probe.message,
  }
}
