/**
 * 免密钥大模型调用封装。
 *
 * 设计要点：
 * - 是否可用以「运行时实际探测」为准，不再用域名硬编码判断：
 *   服务端会校验 Origin 白名单 + 应用的 AI 能力开关，只有真实调用成功才算可用。
 * - 探测结果给出明确原因（能力未开通 / 域名不允许 / 网络异常等），供 UI 精确提示。
 * - 长文按段落分批拆题，降低单次输出被截断的概率。
 */
import { getCloudForLlm } from './cloud'

export interface LlmQuestion {
  no?: number
  stem: string
  options: string[]
  answer: string
  analysis: string
  type: string
}

/** 探测失败的可归类原因，用于给用户精确指引 */
export type LlmBlockReason =
  | 'ok'             // 能力可用
  | 'disabled'       // 应用未开通 AI 能力（服务端 capability_disabled）
  | 'origin'         // 当前域名不在白名单（GitHub Pages 等）
  | 'no_model'       // 无可用模型
  | 'network'        // 网络 / SDK 加载失败
  | 'quota'          // 额度不足
  | 'invalid'        // 返回内容无法解析
  | 'unknown'

export interface LlmProbe {
  available: boolean
  reason: LlmBlockReason
  message: string
}

const SYSTEM_PROMPT = `你是公务员考试（行测）试卷解析助手。用户会给你一段从 PDF/Word 文档中提取的试卷文本，请你把它拆分成一道道独立题目，并以严格的 JSON 输出。
要求：
1. 只输出 JSON，不要输出任何解释文字或 Markdown 代码块标记。
2. JSON 顶层结构为 {"questions":[{...}]}。
3. 每道题字段：no(题号数字)、stem(题干文本)、options(长度为4的字符串数组，依次对应A/B/C/D；没有该选项则为空字符串)、answer(正确答案字母，如"A"、"AB"；找不到答案则为空字符串)、analysis(解析文本，没有则空字符串)、type(模块，如"言语理解""判断推理""数量关系""资料分析""常识判断"，不确定填"其他")。
4. 完整保留题干与选项原文，不要臆造内容；无法确定的字段留空字符串。
5. 题号可能挤在句中（如「127.2020年…128.2020年…」），请按题号正确切分；末尾答案表（如「答案：127.D 128.B」）请回填到对应题目。
6. 若文本不是试题（如纯讲义），questions 返回空数组。`

let probeCache: LlmProbe | null = null

function classifyError(err: unknown): { reason: LlmBlockReason; message: string } {
  const obj = (err ?? {}) as Record<string, unknown>
  const code = String(obj.code ?? obj.error_code ?? '')
  const msg = String(obj.message ?? (err instanceof Error ? err.message : '') ?? '')
  const combined = `${code} ${msg}`.toLowerCase()

  if (combined.includes('capability_disabled') || combined.includes('未开通 ai') || combined.includes('开通 ai 能力')) {
    return { reason: 'disabled', message: '当前应用尚未开通 AI 能力。请在 WorkBuddy 应用中打开本工具使用智能拆题，或联系官方开通。' }
  }
  if (combined.includes('origin') || combined.includes('allowlist') || combined.includes('not allowed') || combined.includes('auth_')) {
    return { reason: 'origin', message: '当前访问域名未启用智能拆题。请在 WorkBuddy 应用中打开本工具后使用。' }
  }
  // 浏览器里跨域被拒通常表现为 Failed to fetch / Network error（服务端校验 Origin 白名单）
  if (combined.includes('failed to fetch') || combined.includes('network error') || combined.includes('load failed') || combined.includes('networkrequestfailed')) {
    return { reason: 'origin', message: '当前访问域名未启用智能拆题。请在 WorkBuddy 应用中打开本工具以启用 AI 拆题。' }
  }
  if (combined.includes('quota') || combined.includes('额度') || combined.includes('insufficient')) {
    return { reason: 'quota', message: '模型可用额度不足，本次已自动改用规则拆题。' }
  }
  if (combined.includes('no available model') || combined.includes('暂无可用模型') || combined.includes('model')) {
    return { reason: 'no_model', message: '暂无可用模型，本次已自动改用规则拆题。' }
  }
  return { reason: 'unknown', message: msg ? `智能拆题暂不可用（${msg}），已自动改用规则拆题。` : '智能拆题暂不可用，已自动改用规则拆题。' }
}

/** 运行时探测大模型能力（结果缓存，成功或失败均缓存；失败可强制重探） */
export async function probeLlm(force = false): Promise<LlmProbe> {
  if (probeCache && !force) return probeCache
  let result: LlmProbe
  try {
    const cloud = await getCloudForLlm()
    const models = await cloud.llm.models.list()
    const usable = models.filter((model) => model.enabled !== false && model.disabled !== true)
    result = usable.length
      ? { available: true, reason: 'ok', message: '大模型智能拆题已就绪' }
      : { available: false, reason: 'no_model', message: '暂无可用模型，已自动改用规则拆题。' }
  } catch (err) {
    const { reason, message } = classifyError(err)
    result = { available: false, reason, message }
  }
  probeCache = result
  return result
}

/** 取缓存的探测结果（未探测时返回 null） */
export function getProbe(): LlmProbe | null {
  return probeCache
}

/** 把长文本按题号/空行切成适合单次模型调用的批次 */
function chunkText(text: string, maxChars = 12000): string[] {
  const clean = text.replace(/\r/g, '').trim()
  if (clean.length <= maxChars) return [clean]
  // 优先在题号处切分，保持题目完整
  const parts = clean.split(/(?=(?:^|\n)\s*(?:第\s*)?\d{1,3}\s*[.．、])/)
  const chunks: string[] = []
  let buf = ''
  for (const part of parts) {
    if (buf && buf.length + part.length > maxChars) {
      chunks.push(buf.trim())
      buf = ''
    }
    buf += part
  }
  if (buf.trim()) chunks.push(buf.trim())
  // 若单段仍超长（如整篇无题号），按长度硬切
  const final: string[] = []
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) { final.push(chunk); continue }
    for (let i = 0; i < chunk.length; i += maxChars) final.push(chunk.slice(i, i + maxChars))
  }
  return final.filter(Boolean)
}

/** 调用模型把单批文本结构化为题目 JSON */
async function structureChunk(
  cloud: Awaited<ReturnType<typeof getCloudForLlm>>,
  modelId: string,
  text: string,
  signal?: AbortSignal,
): Promise<LlmQuestion[]> {
  const stream = cloud.llm.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
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
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(cleaned) as { questions?: unknown }
  if (!parsed || !Array.isArray(parsed.questions)) return []
  return parsed.questions.map(normalizeQuestion)
}

/**
 * 智能拆题主入口：先探测能力，可用则分批调用模型拆题。
 * 不可用或失败时抛出带 reason 的错误，由上层降级并展示提示。
 */
export async function structureQuestions(text: string, signal?: AbortSignal): Promise<LlmQuestion[]> {
  const probe = await probeLlm()
  if (!probe.available) {
    const err = new Error(probe.message) as Error & { reason?: LlmBlockReason }
    err.reason = probe.reason
    throw err
  }

  const cloud = await getCloudForLlm()
  const models = await cloud.llm.models.list(signal)
  const usable = models.filter((model) => model.enabled !== false && model.disabled !== true)
  const model = usable.find((item) => item.isDefault) ?? usable[0]
  if (!model) throw new Error('暂无可用模型')

  const chunks = chunkText(text)
  const all: LlmQuestion[] = []
  for (let i = 0; i < chunks.length; i += 1) {
    if (signal?.aborted) throw new Error('已取消')
    const items = await structureChunk(cloud, model.id, chunks[i], signal)
    // 跨批次题号去重（以 no 为准，无 no 时按题干去重）
    for (const item of items) {
      const dup = all.some((prev) => item.no !== undefined && prev.no === item.no)
        || all.some((prev) => prev.stem === item.stem)
      if (!dup && item.stem) all.push(item)
    }
  }
  if (!all.length) {
    const err = new Error('模型未从文档中识别出题目') as Error & { reason?: LlmBlockReason }
    err.reason = 'invalid'
    throw err
  }
  return all
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
