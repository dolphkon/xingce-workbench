/**
 * 免密钥大模型调用封装。
 *
 * 设计要点：
 * - 是否可用以「运行时实际探测」为准，不再用域名硬编码判断：
 *   服务端会校验 Origin 白名单 + 应用的 AI 能力开关，只有真实调用成功才算可用。
 * - 探测结果给出明确原因（能力未开通 / 域名不允许 / 网络异常等），供 UI 精确提示。
 * - 长文按段落分批拆题，降低单次输出被截断的概率。
 */
import type { PublicLLMModel } from '@tencent-ai/workbuddy-cloud-sdk'
import { getCloudForLlm } from './cloud'
import { refineBankQuestion } from './questionRefine'

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
3. 每道题**必须**用这些字段名（切勿用 question/id/ans 等别名）：no(题号数字)、stem(题干文本)、options(长度恰好为4的字符串数组，依次对应A/B/C/D，只填选项正文不带"A."前缀；没有该选项则为空字符串)、answer(正确答案字母，如"A"、"AB"；找不到答案则为空字符串)、analysis(解析文本，没有则空字符串)、type(模块，如"言语理解""判断推理""数量关系""资料分析""常识判断"，不确定填"其他")。
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

/** 单批调用超时（毫秒）：超时即视为该批失败，由上层降级，避免进度条永久卡住 */
const CHUNK_TIMEOUT_MS = 45000

/** 调用模型把单批文本结构化为题目 JSON（泛型：由 normalize 决定输出结构） */
async function structureChunk<T>(
  cloud: Awaited<ReturnType<typeof getCloudForLlm>>,
  modelId: string,
  text: string,
  systemPrompt: string,
  normalize: (item: unknown) => T,
  signal?: AbortSignal,
  onToken?: (chars: number) => void,
): Promise<T[]> {
  // 组合外部取消信号与单批超时信号
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CHUNK_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  let timedOut = false
  const origReason = () => (signal?.aborted ? '已取消' : null)
  try {
    const stream = cloud.llm.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      stream: true,
      temperature: 0.1,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
      signal: controller.signal,
    })

    let raw = ''
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) { raw += delta; onToken?.(delta.length) }
    }
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as { questions?: unknown }
    if (!parsed || !Array.isArray(parsed.questions)) return []
    return parsed.questions.map(normalize)
  } catch (err) {
    if (!signal?.aborted && !timedOut) timedOut = true
    const reason = origReason()
    if (reason) throw new Error(reason)
    throw err
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 挑选适合「结构化拆题」的模型：优先非推理、输出稳定的 chat 模型。
 * 推理模型（auto / onlyReasoning）在此任务上慢且易超时，不作为首选。
 */
function pickFastModel(models: PublicLLMModel[]): PublicLLMModel | undefined {
  const usable = models.filter((m) => m.enabled !== false && m.disabled !== true)
  // 排除图像/视频生成类非文本模型
  const textModels = usable.filter((m) => m.id && !/(image|video|edit)/i.test(m.id))
  const isFast = (m: PublicLLMModel) => m.onlyReasoning !== true && m.id !== 'auto'
  return (
    textModels.find((m) => m.id === 'hunyuan-chat')
    ?? textModels.find((m) => isFast(m) && (m.maxOutputTokens ?? 0) >= 8000)
    ?? textModels.find(isFast)
    ?? textModels[0]
  )
}

/** 智能拆题进度回调：fraction 为 0~1 的连续进度（单调递增，供进度条使用） */
export interface LlmProgress { done: number; total: number; fraction: number; message: string }

/** 题库后台拆题所需的结构化字段 */
export interface LlmBankQuestion {
  category: '单选题' | '多选题'
  module: string
  material: string
  stem: string
  options: string[]
  answer: string
  analysis: string
}

const BANK_SYSTEM_PROMPT = `你是公务员考试题库录入助手。用户会给你从图片 OCR 识别出的试题文字，请拆分成一道道独立题目，并以严格 JSON 输出。
要求：
1. 只输出 JSON，不要输出任何解释文字或 Markdown 代码块标记。
2. JSON 顶层结构为 {"questions":[{...}]}。
3. 每道题**必须**用这些字段名（切勿用别名）：category、module、material、stem、options、answer、analysis。
   - category：只能是"单选题"或"多选题"（答案含两个及以上字母即为多选题）。
   - module：只能是这六个之一——"政治理论""常识""言语理解""数量关系""判断推理""资料分析"，不确定填"常识"。
   - material：设问句之前的背景材料原文。言语理解「片段阅读」题中，"对上述文段主旨概括准确的是："之前的整段文段必须放 material；资料分析的数据段落、判断推理的题干背景同理。没有材料才填空字符串。
   - stem：**只填设问句本身**（例如"对上述文段主旨概括准确的是："），绝不能把 material 的内容重复写进 stem。
   - options：长度恰好为4的字符串数组，依次对应 A/B/C/D，只填选项正文不带"A."前缀。OCR 常把四个选项挤在同一行（如"A.xx B.xx C.xx D.xx"），必须拆成4条，不能合并成一条。
   - answer：只根据原文标注（如"答案：B"或末尾答案表）回填，不要凭选项内容自行推断；找不到就填空字符串。
   - analysis：解析文本，没有则空字符串。
4. 完整保留原文，不要臆造、不要概括或缩写；无法确定的字段留空字符串。
5. 题号可能挤在句中，请按题号正确切分；末尾答案表请回填到对应题目。
6. 若文字不是试题，questions 返回空数组。
7. 以下是已人工校正的标准示例，务必严格照此结构输出（注意 material/stem 的边界和4个独立选项）：
输入：免密支付本质是技术进步对消费体验的重塑，但其健康发展必须建立在尊重消费者权利的基础之上。从多次跳转到“一键取消”，从信息隐蔽到公开透明，这不仅关乎每一位消费者的切身利益，更关系到市场健康与消费信心的可持续。只有构建起“事前告知—事中控制—事后补救”的全链条保障机制，才能使免密支付真正成为便利生活的工具，而非侵害权益的陷阱。对上述文段主旨概括准确的是：A.免密技术的主要风险是消费者信息不透明 B.免密技术健康发展需要兼顾技术进步与用户权益 C.一键取消功能是保障免密支付安全的核心 D.健全的全链条保障机制决定了免密支付的成败 答案：B
输出：{"questions":[{"category":"单选题","module":"言语理解","material":"免密支付本质是技术进步对消费体验的重塑，但其健康发展必须建立在尊重消费者权利的基础之上。从多次跳转到“一键取消”，从信息隐蔽到公开透明，这不仅关乎每一位消费者的切身利益，更关系到市场健康与消费信心的可持续。只有构建起“事前告知—事中控制—事后补救”的全链条保障机制，才能使免密支付真正成为便利生活的工具，而非侵害权益的陷阱。","stem":"对上述文段主旨概括准确的是：","options":["免密技术的主要风险是消费者信息不透明","免密技术健康发展需要兼顾技术进步与用户权益","一键取消功能是保障免密支付安全的核心","健全的全链条保障机制决定了免密支付的成败"],"answer":"B","analysis":""}]}`

function normalizeBankQuestion(item: unknown): LlmBankQuestion {
  const obj = (item ?? {}) as Record<string, unknown>
  const rawOptions = obj.options
  const byLetter: Record<string, string> = {}
  if (Array.isArray(rawOptions)) {
    rawOptions.forEach((v, i) => {
      const s = String(v ?? '').trim()
      const m = s.match(/^([A-Da-d])[.．、:：\s]\s*(.*)$/)
      if (m) byLetter[m[1].toUpperCase()] = m[2].trim()
      else byLetter[String.fromCharCode(65 + i)] = s
    })
  } else if (rawOptions && typeof rawOptions === 'object') {
    Object.entries(rawOptions as Record<string, unknown>).forEach(([k, v]) => {
      const letter = k.toUpperCase().replace(/[^A-D]/g, '')
      if (letter) byLetter[letter] = String(v ?? '').trim()
    })
  }
  const answer = String(obj.answer ?? obj.ans ?? '').replace(/[^A-Da-d]/g, '').toUpperCase()
  const rawCategory = String(obj.category ?? '').trim()
  const category: '单选题' | '多选题' = rawCategory.includes('多') || answer.length > 1 ? '多选题' : '单选题'
  const rawModule = String(obj.module ?? obj.type ?? '').trim()
  const MODULES = ['政治理论', '常识', '言语理解', '数量关系', '判断推理', '资料分析']
  // 模型输出统一经过确定性后处理：拆分文段/设问、切分单行选项、回填答案
  return refineBankQuestion({
    category,
    module: MODULES.includes(rawModule) ? rawModule : '常识',
    material: String(obj.material ?? '').trim(),
    stem: String(obj.stem ?? obj.question ?? obj.title ?? '').trim(),
    options: ['A', 'B', 'C', 'D'].map((L) => byLetter[L] ?? ''),
    answer,
    analysis: String(obj.analysis ?? obj.explanation ?? '').trim(),
  })
}

/** 通用拆题流程：探测→分批并行→去重。normalize 与 systemPrompt 由具体场景提供。 */
async function runStructure<T>(
  text: string,
  systemPrompt: string,
  normalize: (item: unknown) => T,
  dedupKey: (item: T) => string,
  signal?: AbortSignal,
  onProgress?: (p: LlmProgress) => void,
): Promise<T[]> {
  const probe = await probeLlm()
  if (!probe.available) {
    const err = new Error(probe.message) as Error & { reason?: LlmBlockReason }
    err.reason = probe.reason
    throw err
  }

  const cloud = await getCloudForLlm()
  const models = await cloud.llm.models.list(signal)
  const model = pickFastModel(models)
  if (!model) throw new Error('暂无可用模型')

  const chunks = chunkText(text, 8000)
  const total = chunks.length
  let doneCount = 0
  let charCount = 0
  let maxFraction = 0
  const estTotalChars = Math.max(1, Math.round(text.length * 0.6))
  const report = (fraction: number, message: string) => {
    maxFraction = Math.max(maxFraction, Math.min(0.99, fraction))
    onProgress?.({ done: doneCount, total, fraction: maxFraction, message })
  }
  report(0, `正在解析，共 ${total} 批…`)

  const CONCURRENCY = 3
  const results: T[][] = new Array(total)
  let cursor = 0
  const worker = async () => {
    while (cursor < total && !signal?.aborted) {
      const idx = cursor++
      try {
        results[idx] = await structureChunk(cloud, model.id, chunks[idx], systemPrompt, normalize, signal, (n) => {
          charCount += n
          report(charCount / estTotalChars, `正在生成题目… ${Math.round(maxFraction * 100)}%`)
        })
      } catch {
        results[idx] = []
      }
      doneCount += 1
      report(doneCount / total, `已解析 ${doneCount}/${total} 批…`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker))
  if (signal?.aborted) throw new Error('已取消')

  const all: T[] = []
  const seen = new Set<string>()
  for (const items of results) {
    for (const item of items ?? []) {
      const key = dedupKey(item)
      if (key && !seen.has(key)) { seen.add(key); all.push(item) }
    }
  }
  if (!all.length) {
    const err = new Error('模型未从文档中识别出题目') as Error & { reason?: LlmBlockReason }
    err.reason = 'invalid'
    throw err
  }
  return all
}

/**
 * 智能拆题主入口：先探测能力，可用则分批并行调用模型拆题。
 * 不可用或失败时抛出带 reason 的错误，由上层降级并展示提示。
 * @param onProgress 分批进度回调，用于让用户看到实时进展、避免误以为卡死
 */
export async function structureQuestions(
  text: string,
  signal?: AbortSignal,
  onProgress?: (p: LlmProgress) => void,
): Promise<LlmQuestion[]> {
  const items = await runStructure<LlmQuestion>(
    text, SYSTEM_PROMPT, normalizeQuestion,
    (item) => item.stem || (item.no !== undefined ? `no-${item.no}` : ''),
    signal, onProgress,
  )
  // 保留按题号去重的语义：题号相同只留第一条（runStructure 已按题干去重）
  const seenNo = new Set<number>()
  return items.filter((item) => {
    if (item.no === undefined) return true
    if (seenNo.has(item.no)) return false
    seenNo.add(item.no)
    return true
  })
}

/**
 * 题库后台拆题入口：输出带 category/module/material 等字段的题库结构。
 * 能力不可用或失败时抛出带 reason 的错误，由上层降级为规则拆题。
 */
export async function structureQuestionsForBank(
  text: string,
  signal?: AbortSignal,
  onProgress?: (p: LlmProgress) => void,
): Promise<LlmBankQuestion[]> {
  return runStructure<LlmBankQuestion>(
    text, BANK_SYSTEM_PROMPT, normalizeBankQuestion,
    // 矫正后 stem 只剩设问句（如「下列说法正确的是：」），不能单独作为去重键，
    // 否则多道同设问题会被误删；用材料 + 选项一起构成指纹。
    (item) => `${item.material.slice(0, 80)}|${item.stem}|${item.options.join('|').slice(0, 100)}`,
    signal, onProgress,
  )
}

function normalizeQuestion(item: unknown): LlmQuestion {
  const obj = (item ?? {}) as Record<string, unknown>
  // 题号：no / id / number / num
  const noRaw = obj.no ?? obj.id ?? obj.number ?? obj.num
  const no = typeof noRaw === 'number' ? noRaw : (noRaw !== undefined && /^\d+$/.test(String(noRaw).trim()) ? Number(noRaw) : undefined)
  // 题干：stem / question / title / content —— 兼容不同模型输出习惯
  let stem = String(obj.stem ?? obj.question ?? obj.title ?? obj.content ?? '').trim()

  // 选项兼容三种形态：①数组 ["A.xx","B.xx"] ②对象 {A:"xx",B:"xx"} ③字符串
  const rawOptions = obj.options
  const byLetter: Record<string, string> = {}
  if (Array.isArray(rawOptions)) {
    rawOptions.forEach((v, i) => {
      const s = String(v ?? '').trim()
      const m = s.match(/^([A-Da-d])[.．、:：\s]\s*(.*)$/)
      if (m) byLetter[m[1].toUpperCase()] = m[2].trim()
      else byLetter[String.fromCharCode(65 + i)] = s
    })
  } else if (rawOptions && typeof rawOptions === 'object') {
    Object.entries(rawOptions as Record<string, unknown>).forEach(([k, v]) => {
      const letter = k.toUpperCase().replace(/[^A-D]/g, '')
      if (letter) byLetter[letter] = String(v ?? '').trim()
    })
  } else if (typeof rawOptions === 'string' && rawOptions.trim()) {
    // 单个字符串里含 "A.xx B.xx"：按选项字母切分
    const parts = rawOptions.split(/(?=[A-Da-d][.．、:：])/g)
    parts.forEach((p) => {
      const m = p.trim().match(/^([A-Da-d])[.．、:：\s]\s*(.*)$/)
      if (m) byLetter[m[1].toUpperCase()] = m[2].trim()
    })
  }
  const options = ['A', 'B', 'C', 'D'].map((L) => byLetter[L] ?? '')
  // 若题干里带有 "A. ... C. ..." 形态且选项为空，尝试从题干补抽
  if (!options.some(Boolean)) {
    const inline = stem.match(/[（(]?\s*([A-Da-d][.．、][^A-Da-d]{1,120}){2,4}/g)
    if (inline) {
      inline.forEach((seg) => {
        seg.split(/(?=[A-Da-d][.．、])/).forEach((p) => {
          const m = p.trim().match(/^([A-Da-d])[.．、]\s*(.*)$/)
          if (m) byLetter[m[1].toUpperCase()] = m[2].trim().replace(/[）)]$/, '')
        })
        stem = stem.replace(seg, '').trim()
      })
      options.splice(0, 4, ...['A', 'B', 'C', 'D'].map((L) => byLetter[L] ?? ''))
    }
  }

  return {
    no,
    stem,
    options,
    answer: String(obj.answer ?? obj.ans ?? '').replace(/[^A-Da-d]/g, '').toUpperCase(),
    analysis: String(obj.analysis ?? obj.explanation ?? obj.parse ?? '').trim(),
    type: String(obj.type ?? obj.module ?? obj.category ?? '').trim() || '其他',
  }
}
