import {
  findQuestionAnchors, splitByQuestionNumbers, extractAnswerKey, ruleParseAll,
} from '../node_modules/.cache/paper-split.mjs'

// 截图对应的真实 OCR 形态：扫描片段从 42 题起手，前面残留封面水印/标题
const SAMPLE = `st8AoNGkAo 复制必究
2026 下半年公考笔试·套题冲刺班一期
行政职业能力测验（一）
42. 知识和信息时，孩子和家长反而，选择性了解、碎片化阅读又让当下孩子的知识结构变得碎片化，因此依然需要一本权威的百科全书。依次填入画横线部分最恰当的一项是：A.排山倒海无从选择 B.扑面而来手足无措 C.蜂拥而至进退维谷 D.铺天盖地无从适从 答案：C
43. 史铁生无疑是一个生命的奇迹。时代变迁，改变不了生命原始的芬芳。他的一生如苦难的风，留给人们深深浅浅的遗民、敬畏和思考。
44. 当前，一系列科幻作品虽然层出不穷，零星几部的成功或失败，并不能直接作为衡量科幻文化的标尺。依次填入画横线部分最恰当的一项是：A.层出不穷欲拒还迎 B.遍地开花过犹不及 C.别具一格描苗助长 D.司空见惯露头目光`

// 题号按部分重置
const RESET = `41. 第四十一题：下列说法正确的一项是：A.甲 B.乙 C.丙 D.丁
42. 第四十二题：下列说法正确的一项是：A.甲 B.乙 C.丙 D.丁
2. 第二部分第一题：下列说法正确的一项是：A.甲 B.乙 C.丙 D.丁
3. 第二部分第二题：下列说法正确的一项是：A.甲 B.乙 C.丙 D.丁`

const cases = [
  {
    name: '真实样本：扫描片段从 42 题起手，锚点正确识别且不误认标题',
    run: () => findQuestionAnchors(SAMPLE).map((a) => a.no),
    expect: (nos) => nos.join(',') === '42,43,44',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '真实样本：切出 3 块且封面水印不混入第一题',
    run: () => splitByQuestionNumbers(SAMPLE),
    expect: (blocks) => blocks.length === 3
      && !blocks[0].text.includes('复制必究') && blocks[0].text.includes('知识和信息时'),
    detail: (g) => JSON.stringify(g.map((b) => ({ no: b.no, head: b.text.slice(0, 30) }))),
  },
  {
    name: '答案表按题号回填',
    run: () => extractAnswerKey('1. 甲题：A.甲 B.乙 C.丙 D.丁\n2. 乙题：A.甲 B.乙 C.丙 D.丁\n答案：1.D 2.B'),
    expect: (m) => m.get(1) === 'D' && m.get(2) === 'B',
    detail: (g) => JSON.stringify([...g.entries()]),
  },
  {
    name: '题号按部分重置（42 → 2）仍能切开',
    run: () => splitByQuestionNumbers(RESET).map((b) => b.no),
    expect: (nos) => nos.join(',') === '41,42,2,3',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '规则全流程：题号/选项/答案正确落地，选项不带答案标注',
    run: () => ruleParseAll(SAMPLE),
    expect: (qs) => qs.length === 3 && qs[0].answer === 'C'
      && qs[0].options.filter(Boolean).length === 4
      && !qs[0].title.includes('复制必究')
      && !qs[0].options.some((o) => o.includes('答案')),
    detail: (g) => JSON.stringify(g.map((q) => ({ answer: q.answer, options: q.options }))),
  },
]

let failed = 0
for (const c of cases) {
  const out = c.run()
  if (c.expect(out)) console.log(`PASS ${c.name}`)
  else { failed++; console.log(`FAIL ${c.name}\n  got: ${c.detail(out)}`) }
}
console.log(failed ? `\n${failed}/${cases.length} failed` : `\nAll ${cases.length} cases passed`)
process.exit(failed ? 1 : 0)
