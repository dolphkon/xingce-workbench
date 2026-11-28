import {
  parseExamTemplate, pageEditorBody, updateTemplatePage, attachTemplateContext,
  renderExamTemplate, formatExamTemplate, pageTextsToTemplate, templateStats,
} from '../node_modules/.cache/exam-template.mjs'
import { ruleMarkdownToQuestions } from '../node_modules/.cache/markdown-flow.mjs'

const TEMPLATE = `# 2026 行测套题

## 第一部分 言语理解与表达
### 第 1 页
#### 第 1 题
题型：单选题
模块：言语理解
材料：
题干：依次填入画横线部分最恰当的一项是：

A. 甲
B. 乙
C. 丙
D. 丁
答案：A

#### 第 2 题
题型：单选题
模块：言语理解
材料：
题干：下列说法正确的一项是：

A. 甲
B. 乙
C. 丙
D. 丁
答案：B

### 第 2 页
#### 第 3 题
题型：单选题
模块：言语理解
材料：
题干：第二页的题目：

A. 甲
B. 乙
C. 丙
D. 丁
答案：C

## 第二部分 数量关系
### 第 3 页
#### 第 4 题
题型：单选题
模块：数量关系
材料：
题干：计算题：

A. 1
B. 2
C. 3
D. 4
答案：D`

const cases = [
  {
    name: '解析套卷模板：部分/页/题层级正确',
    run: () => parseExamTemplate(TEMPLATE),
    expect: (t) => t.title === '2026 行测套题'
      && t.sections.join('|') === '第一部分 言语理解与表达|第二部分 数量关系'
      && t.pages.map((p) => `${p.no}:${p.questionIndexes.length}`).join(',') === '1:2,2:1,3:1'
      && t.pages[2].section === '第二部分 数量关系',
    detail: (t) => JSON.stringify({ title: t.title, sections: t.sections, pages: t.pages.map((p) => [p.no, p.questionIndexes.length, p.section]) }),
  },
  {
    name: '统计套卷规模：部分/页/题数',
    run: () => templateStats(TEMPLATE),
    expect: (s) => s.sections === 2 && s.pages === 3 && s.questions === 4,
    detail: (s) => JSON.stringify(s),
  },
  {
    name: '旧格式（无部分/页标题）视为第 1 页，题目不丢',
    run: () => parseExamTemplate('## 第 42 题\n题型：单选题\n模块：常识\n材料：\n题干：甲题：\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n答案：A\n\n## 第 43 题\n题型：单选题\n模块：常识\n材料：\n题干：乙题：\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n答案：B'),
    expect: (t) => t.paged === false && t.pages.length === 1 && t.pages[0].questionIndexes.length === 2
      && t.pages[0].body.includes('第 43 题'),
    detail: (t) => JSON.stringify({ paged: t.paged, pages: t.pages.map((p) => [p.no, p.questionIndexes.length]) }),
  },
  {
    name: '分页编辑器正文不含页标题，题块完整',
    run: () => pageEditorBody(parseExamTemplate(TEMPLATE).pages[1]),
    expect: (body) => !body.includes('### 第 2 页') && body.includes('#### 第 3 题') && body.includes('第二页的题目'),
    detail: (body) => body.slice(0, 100),
  },
  {
    name: '单页回写：只改目标页，其他页原样保留',
    run: () => {
      const next = updateTemplatePage(TEMPLATE, 2, '#### 第 3 题\n题型：单选题\n模块：言语理解\n材料：\n题干：人工改过的题：\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n答案：B')
      return { next, t: parseExamTemplate(next) }
    },
    expect: (g) => g.next.includes('人工改过的题') && !g.next.includes('第二页的题目')
      && g.next.includes('第 1 页') && g.next.includes('第 3 页')
      && g.t.pages.length === 3 && g.t.pages[0].body.includes('依次填入画横线部分'),
    detail: (g) => JSON.stringify(g.t.pages.map((p) => [p.no, p.body.length])),
  },
  {
    name: '规则解析不把部分/页标题混入题干',
    run: () => ruleMarkdownToQuestions(TEMPLATE),
    expect: (qs) => qs.length === 4
      && qs.every((q) => !q.title.includes('第一部分') && !q.title.includes('第 2 页'))
      && qs[0].answer === 'A' && qs[3].answer === 'D',
    detail: (qs) => JSON.stringify(qs.map((q) => q.title.slice(0, 30))),
  },
  {
    name: '模板上下文附着：题号顺序映射到部分与页',
    run: () => attachTemplateContext(ruleMarkdownToQuestions(TEMPLATE), TEMPLATE),
    expect: (qs) => qs.map((q) => `${q.page}:${q.section}`).join('|')
      === '1:第一部分 言语理解与表达|1:第一部分 言语理解与表达|2:第一部分 言语理解与表达|3:第二部分 数量关系',
    detail: (qs) => JSON.stringify(qs.map((q) => [q.page, q.section])),
  },
  {
    name: '自动排版：字段顺序固定且保留分页与答案',
    run: () => formatExamTemplate(TEMPLATE),
    expect: (md) => {
      const t = parseExamTemplate(md)
      const qs = ruleMarkdownToQuestions(md)
      return t.pages.length === 3 && qs.length === 4 && qs[3].answer === 'D'
        && /#### 第 1 题[\s\S]*题型：[\s\S]*模块：[\s\S]*材料：[\s\S]*题干：/.test(md)
    },
    detail: (md) => md.slice(0, 240),
  },
  {
    name: '逐页 OCR 文本 → 套卷模板（第 1/2 页题目各自成页）',
    run: () => pageTextsToTemplate([
      '1. 甲题：A.甲 B.乙 C.丙 D.丁 答案：A',
      '2. 乙题：A.甲 B.乙 C.丙 D.丁 答案：B',
    ], 'OCR 卷'),
    expect: (md) => parseExamTemplate(md).pages.length === 2
      && ruleMarkdownToQuestions(md).length === 2
      && md.includes('### 第 1 页') && md.includes('### 第 2 页'),
    detail: (md) => md.slice(0, 200),
  },
  {
    name: '序列化：按模板上下文输出部分与页标题',
    run: () => {
      const qs = ruleMarkdownToQuestions(TEMPLATE)
      const context = new Map([[0, { page: 1, section: '第一部分 言语理解与表达' }], [1, { page: 2, section: '第二部分 数量关系' }]])
      return renderExamTemplate([qs[0], qs[3]], '组合卷', context)
    },
    expect: (md) => md.includes('## 第一部分 言语理解与表达') && md.includes('## 第二部分 数量关系')
      && md.includes('### 第 1 页') && md.includes('### 第 2 页')
      && ruleMarkdownToQuestions(md).length === 2,
    detail: (md) => md.slice(0, 180),
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
