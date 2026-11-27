import { refineBankQuestion } from '../node_modules/.cache/qr.mjs'

const MATERIAL = '免密支付本质是技术进步对消费体验的重塑，但其健康发展必须建立在尊重消费者权利的基础之上。从多次跳转到“一键取消”，从信息隐蔽到公开透明，这不仅关乎每一位消费者的切身利益，更关系到市场健康与消费信心的可持续。只有构建起“事前告知—事中控制—事后补救”的全链条保障机制，才能使免密支付真正成为便利生活的工具，而非侵害权益的陷阱。'
const STEM = '对上述文段主旨概括准确的是：'
const OPTIONS = [
  '免密技术的主要风险是消费者信息不透明',
  '免密技术健康发展需要兼顾技术进步与用户权益',
  '一键取消功能是保障免密支付安全的核心',
  '健全的全链条保障机制决定了免密支付的成败',
]

const cases = [
  {
    name: '人工矫正题：模型把文段/设问/选项全塞进 stem',
    input: {
      category: '单选题', module: '常识', material: '', answer: '', analysis: '',
      stem: `${MATERIAL}${STEM} A.${OPTIONS[0]} B.${OPTIONS[1]} C.${OPTIONS[2]} D.${OPTIONS[3]} 答案：B`,
      options: [],
    },
    expect: { category: '单选题', module: '言语理解', material: MATERIAL, stem: STEM, options: OPTIONS, answer: 'B' },
  },
  {
    name: '人工矫正题：选项带字母前缀、答案在 analysis',
    input: {
      category: '单选题', module: '言语理解', material: MATERIAL, stem: STEM,
      options: OPTIONS.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`),
      answer: '', analysis: '参考答案：B',
    },
    expect: { category: '单选题', module: '言语理解', material: MATERIAL, stem: STEM, options: OPTIONS, answer: 'B' },
  },
  {
    name: '多选题：答案 AD 自动改类别',
    input: {
      category: '单选题', module: '判断推理', material: '', stem: '下列说法正确的有：',
      options: ['甲正确', '乙错误', '丙正确', '丁错误'], answer: 'AD', analysis: '',
    },
    expect: { category: '多选题', answer: 'AD' },
  },
  {
    name: '资料分析：数据材料 + 设问拆分',
    input: {
      category: '单选题', module: '常识', material: '', answer: '', analysis: '',
      stem: '2023年某市GDP为1200亿元，同比增长8.5%，其中第三产业占比62%。根据上述材料，第三产业增加值约为： A.624亿元 B.744亿元 C.812亿元 D.960亿元',
      options: [],
    },
    expect: { module: '资料分析', stem: '根据上述材料，第三产业增加值约为：', options: ['624亿元', '744亿元', '812亿元', '960亿元'], answer: '' },
  },
]

let failed = 0
for (const c of cases) {
  const got = refineBankQuestion(c.input)
  const errors = []
  for (const [k, v] of Object.entries(c.expect)) {
    const actual = got[k]
    const ok = Array.isArray(v) ? JSON.stringify(actual) === JSON.stringify(v) : actual === v
    if (!ok) errors.push(`  ${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`)
  }
  if (errors.length) { failed++; console.log(`FAIL ${c.name}\n${errors.join('\n')}`) }
  else console.log(`PASS ${c.name}`)
}
console.log(failed ? `\n${failed}/${cases.length} failed` : `\nAll ${cases.length} cases passed`)
process.exit(failed ? 1 : 0)
