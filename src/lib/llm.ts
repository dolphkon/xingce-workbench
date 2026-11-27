/**
 * 免密钥大模型调用封装（仅在 WorkBuddy 发布域名可用）。
 * 用于把文档全文结构化为题目 JSON；其它域名返回不可用，由上层回退到规则解析。
 */
import { CLOUD_AVAILABLE, getCloud } from './cloud'

export const LLM_AVAILABLE = CLOUD_AVAILABLE

const SYSTEM_PROMPT = `你是公务员考试（行测）试卷解析助手。用户会给你一份从 PDF/Word 文档中提取的试卷文本，请你把它拆分成一道道独立题目，并以严格的 JSON 输出。
要求：
1. 只输出 JSON，不要输出任何解释文字或 Markdown 代码块标记。
2. JSON 顶层结构为 {"questions":[{...}]}。
3. 每道题字段：no(题号数字)、stem(题干文本)、options(长度为4的字符串数组，依次对应A/B/C/D；没有该选项则为空字符串)、answer(正确答案字母，如"A"、"AB"；找不到答案则为空字符串)、analysis(解析文本，没有则空字符串)、type(模块，如"言语理解""判断推理""数量关系""资料分析""常识判断"，不确定填"其他")。
4. 完整保留题干与选项原文，不要臆造内容；无法确定的字段留空字符串。
5. 若文本不是试题（如纯讲义），questions 返回空数组。`

export interface LlmQuestion {
  no?: number
  stem: string
  options: string[]
  answer: string
  analysis: string
  type: string
}

/** 调用模型把文本结构化为题目数组；不可用或失败时抛出错误由上层降级。 */
export async function structureQuestions(text: string, signal?: AbortSignal): Promise<LlmQuestion[]> {
  if (!CLOUD_AVAILABLE) throw new Error('当前域名不支持智能识别')
  const cloudPromise = getCloud()
  if (!cloudPromise) throw new Error('云端未就绪')
  const cloud = await cloudPromise
  const models = await cloud.llm.models.list(signal)
  const usable = models.filter((model) => model.enabled !== false)
  const model = usable.find((item) => item.isDefault) ?? usable[0] ?? models[0]
  if (!model) throw new Error('暂无可用模型')

  const stream = cloud.llm.chat.completions.create({
    model: model.id,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text.slice(0, 60000) },
    ],
    stream: true,
    temperature: 0.1,
    max_tokens: 8192,
    response_format: { type: 'json_object' },
    ...(signal ? { signal } : {}),
  })

  let raw = ''
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content
    if (delta) raw += delta
  }
  // 去除可能的代码块包裹
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(cleaned) as { questions?: unknown }
  if (!parsed || !Array.isArray(parsed.questions)) return []
  return parsed.questions.map((item) => normalizeQuestion(item))
}

function normalizeQuestion(item: unknown): LlmQuestion {
  const obj = (item ?? {}) as Record<string, unknown>
  const rawOptions = Array.isArray(obj.options) ? obj.options : []
  const options = Array.from({ length: 4 }, (_, i) => String(rawOptions[i] ?? '').trim())
  return {
    no: typeof obj.no === 'number' ? obj.no : undefined,
    stem: String(obj.stem ?? obj.title ?? '').trim(),
    options,
    answer: String(obj.answer ?? '').replace(/[^A-Da-d]/g, '').toUpperCase(),
    analysis: String(obj.analysis ?? '').trim(),
    type: String(obj.type ?? '').trim() || '其他',
  }
}
