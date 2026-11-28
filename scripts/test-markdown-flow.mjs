import {
  normalizeMarkdown, splitMarkdownBlocks, ruleMarkdownToQuestions, questionsToMarkdown, ruleTextToMarkdown,
  mergeMarkdownWithRules,
} from '../node_modules/.cache/markdown-flow.mjs'

const MD = `# 行测套题

## 第 42 题
题型：单选题
模块：言语理解
答案：C
材料：知识和信息时代，孩子与家长选择性了解、碎片化阅读让知识结构变得碎片化。

依次填入画横线部分最恰当的一项是：

A. 排山倒海 无从选择
B. 扑面而来 手足无措
C. 蜂拥而至 进退维谷
D. 铺天盖地 无从适从

解析：语境强调信息大量涌来，故选 C。

## 第 2 题
题型：多选题
模块：常识判断

关于经济基础和上层建筑，表述正确的有：

A. 经济基础决定上层建筑
B. 上层建筑反作用于经济基础
C. 二者毫无关联
D. 上层建筑的性质由经济基础决定
答案：ABD`

const cases = [
  {
    name: '去掉代码块包裹并规整空行',
    run: () => normalizeMarkdown('```markdown\n## 第 1 题\nA. 甲\n\n\n\nB. 乙\n```'),
    expect: (s) => !s.includes('```') && !s.includes('\n\n\n') && s.startsWith('## 第 1 题'),
    detail: (s) => s,
  },
  {
    name: '按「## 第 N 题」切块，支持题号重置（42 → 2）',
    run: () => splitMarkdownBlocks(MD).map((b) => b.no),
    expect: (nos) => nos.join(',') === '42,2',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '题块外的 # 标题不混入题目',
    run: () => splitMarkdownBlocks(MD),
    expect: (blocks) => blocks.length === 2 && blocks.every((b) => !b.body.includes('行测套题')),
    detail: (g) => JSON.stringify(g.map((b) => b.body.slice(0, 20))),
  },
  {
    name: '规则解析：题号/模块/材料/选项/答案/解析落地',
    run: () => ruleMarkdownToQuestions(MD),
    expect: (qs) => qs.length === 2
      && qs[0].answer === 'C'
      && qs[0].options.filter(Boolean).length === 4
      && qs[0].title.includes('【共用材料】')
      && qs[0].title.includes('【题目】')
      && qs[0].analysis.includes('语境强调')
      && qs[1].answer === 'ABD',
    detail: (g) => JSON.stringify(g.map((q) => ({ answer: q.answer, title: q.title.slice(0, 40), opts: q.options.length, analysis: q.analysis }))),
  },
  {
    name: '规则解析：无材料题不产生空标记',
    run: () => ruleMarkdownToQuestions(MD)[1],
    expect: (q) => !q.title.includes('【共用材料】') && q.title.includes('关于经济基础'),
    detail: (q) => q.title,
  },
  {
    name: '序列化 → 再解析往返：题数、答案、选项保持一致',
    run: () => {
      const qs = ruleMarkdownToQuestions(MD)
      const md = questionsToMarkdown(qs, '往返测试')
      return ruleMarkdownToQuestions(md)
    },
    expect: (qs) => qs.length === 2 && qs[0].answer === 'C' && qs[1].answer === 'ABD'
      && qs[0].options.filter(Boolean).length === 4,
    detail: (g) => JSON.stringify(g.map((q) => ({ answer: q.answer, opts: q.options }))),
  },
  {
    name: '规则补全漏题：AI 漏掉题号重置的题，补回中间稿',
    run: () => {
      const raw = '42. 甲题：下列说法正确的是：A.甲 B.乙 C.丙 D.丁 答案：A\n43. 乙题：下列说法错误的是：A.甲 B.乙 C.丙 D.丁 答案：B\n2. 丙题：下列说法正确的是：A.甲 B.乙 C.丙 D.丁 答案：C'
      // 模拟 AI 只输出前两题，漏掉重置题号的第 2 题
      const ai = `## 第 42 题\n题型：单选题\n模块：常识判断\n答案：A\n\n甲题：下列说法正确的是：\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n\n## 第 43 题\n题型：单选题\n模块：常识判断\n答案：B\n\n乙题：下列说法错误的是：\nA. 甲\nB. 乙\nC. 丙\nD. 丁`
      return splitMarkdownBlocks(mergeMarkdownWithRules(ai, raw)).map((b) => b.no)
    },
    expect: (nos) => nos.join(',') === '42,43,2',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '无 AI 兜底：规则文本 → Markdown 中间稿',
    run: () => ruleTextToMarkdown(`1. 甲题：下列说法正确的一项是：
A.甲
B.乙
C.丙
D.丁
答案：A
2. 乙题：下列说法正确的是：
A.甲
B.乙
C.丙
D.丁
答案：B`),
    expect: (md) => md.includes('## 第 1 题') && md.includes('## 第 2 题') && md.includes('A. 甲'),
    detail: (md) => md.slice(0, 120),
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
