/**
 * 试卷文本噪音清洗（PDF 文本层 / OCR 文本通用）。
 *
 * 背景：行测试卷首页通常含大量「非题目」文字——版权水印、复制必备/复制必究、
 * 密封线、条形码粘贴说明、考生须知/注意事项、页码等。它们出现在第一个题号之前，
 * 规则切题会把它们整段塞进第 1 题的「共用材料」，LLM 也会把它们当成题干背景。
 * 本模块在文本进入拆题引擎之前做确定性清洗，并在结果侧做二次兜底。
 *
 * 设计原则：宁可漏删一行，不可误删题干。清洗只针对「明确的试卷版式噪音」，
 * 用多组强特征联合判定，避免把正常材料（如片段阅读文段）误删。
 */

/** 试卷首页/页脚强特征：命中任一条即视为版式噪音行 */
const BOILERPLATE_LINE_PATTERNS: RegExp[] = [
  // 版权/水印/推广（截图中的 "sT8AoIGNGkAO 复制必究"、"四海公考版权所有"）
  /复制必备|复制必究|版权所有|盗版必究|侵权必究|内部资料|仅限个人|禁止转载|未经授权/i,
  /公众号|微信号|微信扫码|QQ群|扫码关注|添加微信|课程咨询|考前冲刺|题班|押题/i,
  // 课程推广水印与机构标识（截图："一手最全人考说题 | 岗信 biguo368"）
  /一手最全|最全.{0,12}说题|岗信\s*\w+|biguo\d{3,}|题题冲刺班|套题冲刺班/i,
  // 密封线/装订线相关（常见整行 "密封线内不要答题"、姓名/考号填写栏）
  /密封线|装订线|密封线内|不要答题|线内不要/,
  // 条形码/准考证粘贴说明
  /条形码|条码|粘贴.*处|贴.*条形码|请将此条码|指定位置\s*[Ww][Ee][Ff]/,
  // 试卷标题/机构标识行（"2026 下半年公考笔试·套题冲刺班一期"）
  /^\s*20\d{2}\s*(?:上半年|下半年)?\s*(?:公考|公务员|国考|省考).*(?:冲刺|题班|套题|模考|预测)/,
  /行政职业能力测验\s*[（(][一二三四五六七八九十\d]+[）)]\s*$/,
  /公务员考试.*(?:题班|冲刺|模考|预测)|行测.*(?:题班|冲刺|模考)/,
  // 考生须知区块标题与固定条目（"重要提示："、"注意事项：一、…"）
  /重[要點]提示\s*[:：]?\s*$|注意事项\s*[:：]?\s*$|考生须知\s*[:：]?\s*$|答题须知\s*[:：]?\s*$/,
  /为维护您的?个人权益|确保考试的?公平公正|请您协助我们监督|监考老师要向本考场|验封签字|开启试卷/,
  /此项测试分为|总时限\s*\d+\s*分钟|各部分不单独计时|参考时限|合理分配时间/,
  /请按照要求在答题卡上|涂写好?准考证号|严禁折叠答题卡|必须在答题卡上(?:答题|作答)|在题本上答题.*无效/,
  /宣布考试开始时.*方可答题|宣布考试结束时|草稿纸一律留在桌上|确认数量无误|允许离开后/,
  /不要在一道题上思考时间太久|遇到不会答的题目可先跳过去|没有时间完成后面的题目/,
  /此项测试.*可能有些试题较难|若有时间再去思考/,
  // 题量/参考时间说明（截图："（共 30 题，参考时间：28 分钟）"）
  /参考时间\s*[:：]?\s*\d+\s*分钟|共\s*\d+\s*题\s*[，,]?\s*参考时间/,
  // 分册标题（"第三部分 言语理解与表达"）——经行内页码剥离后会独立成行
  /^第[一二三四五六七八九十\d]+部分\s*[\u4e00-\u9fff]{2,12}\s*$/,
  // 装订线侧边的竖排填写栏
  /^\s*(?:准考证号|姓名|考号|座位号)\s*[:：]?\s*$/,
]

/** 行首编号的注意事项条目："一、……" "（一）……" "1．请按照要求……" */
const NOTICE_ITEM_RE = /^\s*(?:[一二三四五六七八九十]+[、．.]|[（(][一二三四五六七八九十\d]+[）)])\s*(?:请|须|禁|严|考|答|监|本|在|不|监考|考生|将|此项|各部分|按照|必须|宣布|草稿|如遇|交卷|提前|考试)/

/** 纯页码行："第 3 页 共 12 页" / "- 3 -" / "3 / 12" */
const PAGE_NUMBER_RE = /^\s*(?:第\s*\d{1,3}\s*页\s*共\s*\d{1,3}\s*页|[-—–]\s*\d{1,3}\s*[-—–]|\d{1,3}\s*\/\s*\d{1,3})\s*$/

/** 短乱码行：大小写字母数字混杂、长度 6~40、且无中文（OCR 常见水印串） */
const GARBLED_LINE_RE = /^\s*[A-Za-z0-9?！?！*#@_~—-]{6,40}\s*$/

/** 题号锚点：与 paperSplit 的 findQuestionAnchors 同风格（标点后允许空格） */
const QUESTION_ANCHOR_RE = /(?:^|[^\d])(\d{1,3})\s*[.．、,，)）](?=\s*\S)/

/**
 * 行内噪音剥离：页码、推广水印常与题目挤在同一行，不能整行删除。
 * - "※淡溪第 9 页 共 39 页第三部分 言语理解与表达" → "第三部分 言语理解与表达"
 * - "……失衡第 11 页 共 39 页" → "……失衡"
 * - "一手最全人考说题 | 岗信 biguo368 依次填入……" → "依次填入……"
 */
function stripInlineNoise(line: string): string {
  let out = String(line ?? '')
  // 页眉：行首乱码 + 页码（连同页码前的装饰串一起丢弃）
  out = out.replace(/^.{0,24}?第\s*\d{1,3}\s*页\s*共\s*\d{1,3}\s*页\s*/, '')
  // 嵌在任意位置的页码（如选项末尾）
  out = out.replace(/第\s*\d{1,3}\s*页\s*共\s*\d{1,3}\s*页/g, '')
  // 推广水印：与题目同行时只剥离水印片段
  out = out.replace(/一手最全[^\s|｜]{0,24}说题\s*[|｜]?\s*岗信\s*[A-Za-z0-9]{3,}/gi, '')
  out = out.replace(/[|｜]\s*岗信\s*[A-Za-z0-9]{3,}/gi, '')
  out = out.replace(/\bbiguo\d{3,}/gi, '')
  // 残留的页眉装饰符
  out = out.replace(/^[\s※*#·]+/, '')
  return out.trim()
}

function isBoilerplateLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (PAGE_NUMBER_RE.test(trimmed)) return true
  if (BOILERPLATE_LINE_PATTERNS.some((re) => re.test(trimmed))) return true
  if (NOTICE_ITEM_RE.test(trimmed)) return true
  if (GARBLED_LINE_RE.test(trimmed) && /\d/.test(trimmed) && /[A-Za-z]/.test(trimmed)) return true
  return false
}

/** 归一化后用于判断两行是否实质重复（忽略标点/空白与轻微 OCR 差异） */
function normalizeForCompare(line: string): string {
  return line.replace(/[\s，,。．.、；;：:（）()【】\[\]"'"'《》〈〉!！?？|｜~～—–-]/g, '').toLowerCase()
}

/** 连续重复行判定：扫描版 PDF 相邻页重叠或 Tesseract 双次识别会产生重复行 */
function isRepeatLine(a: string, b: string): boolean {
  const na = normalizeForCompare(a)
  const nb = normalizeForCompare(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const min = Math.min(na.length, nb.length)
  const max = Math.max(na.length, nb.length)
  // 长度足够 + 只差少量尾部字符 + 互为前缀：判为同一行的重复识别
  return min >= 16 && max - min <= 4 && (na.includes(nb) || nb.includes(na))
}

/** 去掉连续重复的非空行（保留首次出现），避免选项/题干被重复塞入同一题 */
function dedupeConsecutiveLines(lines: string[]): string[] {
  const out: string[] = []
  let lastNonEmpty = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { out.push(line); continue }
    if (lastNonEmpty && isRepeatLine(trimmed, lastNonEmpty)) continue
    out.push(line)
    lastNonEmpty = trimmed
  }
  return out
}

/**
 * 清洗文本中的试卷版式噪音。
 *
 * 策略：
 * 1. 连续重复行去重（OCR 重叠/双次识别）；
 * 2. 行内剥离页码、推广水印，再逐行判定强特征 → 删除版权/密封线/须知条目/页码/乱码行；
 * 3. 「重要提示/注意事项/考生须知」到下一个题号之间的连续说明块整体删除；
 * 4. 合并多余空行，保留段落结构；
 * 5. 若清洗后正文过短（<20 字），返回原文本，避免误清洗导致数据丢失。
 */
export function cleanExamText(input: string): string {
  const raw = String(input ?? '').replace(/\r/g, '')
  if (!raw.trim()) return ''
  const lines = dedupeConsecutiveLines(raw.split('\n'))
  const kept: string[] = []
  let inNoticeBlock = false

  for (const originalLine of lines) {
    const line = stripInlineNoise(originalLine)
    const trimmed = line.trim()
    if (!trimmed) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('')
      continue
    }

    // 遇到题号即退出须知区块
    if (inNoticeBlock && QUESTION_ANCHOR_RE.test(trimmed)) inNoticeBlock = false

    // 须知区块标题：开启块标记并丢弃标题行
    if (/^\s*(?:重[要點]提示|注意事项|考生须知|答题须知)\s*[:：]?\s*$/.test(trimmed)) {
      inNoticeBlock = true
      continue
    }

    if (inNoticeBlock) continue
    if (isBoilerplateLine(line)) continue
    kept.push(line)
  }

  const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  // 安全兜底：清洗后几乎没内容，宁可保留原文交给人工校对
  return cleaned.length >= 20 ? cleaned : raw.trim()
}

/**
 * 对「第一个题号之前的文本」做共用材料判定。
 * 试卷封面说明清洗后若仍残留大量说明性文字，不应作为共用材料。
 */
export function sanitizeSharedMaterial(text: string): string {
  if (!text || !text.trim()) return ''
  // 封面强特征必须在 cleanExamText 的「短文本安全兜底」之前判定：
  // 整页都是噪音时清洗结果为空，兜底会把原文原样放回，反而污染共用材料。
  if (/(?:复制必究|复制必备|版权所有|盗版必究|密封线|条形码|注意事项|重要提示|考生须知|冲刺班|题班|行政职业能力测验|参考时间|biguo\d{3,})/i.test(text)) return ''
  const cleaned = cleanExamText(text)
  if (!cleaned) return ''
  // 清洗后仍含密集须知关键词，视为封面说明残留，整段丢弃
  const noticeHits = (cleaned.match(/提示|须知|注意|监考|答题卡|密封|条形码|考试规定|考场|参考时限/g) ?? []).length
  if (noticeHits >= 3) return ''
  // 过长且无标点的开头文本基本是 OCR 连排的版式噪音
  if (cleaned.length > 1200 && !/[。！？；\n]/.test(cleaned.slice(0, 400))) return ''
  return cleaned
}

/** 结果侧兜底：移除题干/材料里残留的单行噪音（不改动正常题目内容） */
export function stripResidualBoilerplate(text: string): string {
  if (!text) return ''
  return text
    .split('\n')
    .map((line) => stripInlineNoise(line))
    .filter((line) => !isBoilerplateLine(line))
    .join('\n')
    .replace(/【共用材料】\s*(?=【题目】)/, '')
    .trim()
}
