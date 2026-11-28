import {
  parseExamTemplate, pageEditorBody, updateTemplatePage, attachTemplateContext,
  renderExamTemplate, formatExamTemplate, pageTextsToTemplate, templateStats,
} from '../node_modules/.cache/exam-template.mjs'
import { ruleMarkdownToQuestions, splitMarkdownBlocks } from '../node_modules/.cache/markdown-flow.mjs'

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

// 人工校验样本：题号标题多打了 # 和空格，模块被改成「常识」但部分标题仍是言语
const MANUAL_SAMPLE = `# 2026 行测套题

## 第一部分 言语理解与表达
### 第 1 页
##### 第  4  题
题型：单选题
模块：常识
材料：矛盾的同一性和斗争性相结合，构成了事物的矛盾运动，推动着事物的发展变化。
题干：关于矛盾的同一性，下列表述错误的一项是：

A．同一性是事物存在和发展的前提，一方的发展以另一方的发展为条件
B．同一性使矛盾双方互相吸取有利于自身的因素，在相互作用中得到各自发展
C．同一性规定着事物转化的可能和发展的趋势
D．同一性是一种矛盾统一体向另一种矛盾统一体过渡的决定性力量
答案：D
解析：

###### 第  5  题
题型：单选题
模块：常识
材料：
题干：下列关于矛盾的表述正确的是：

A．甲
B．乙
C．丙
D．丁
答案：A`

// 人工样本：同一 PDF 拼接多套卷，第二套卷页码从 1 重新开始
const MULTI_PAPER_SAMPLE = `# 26 行测套题（一）
## 第一部分 言语理解与表达
### 第 3 页
#### 第 43 题
题型：单选题
模块：常识
材料：
题干：2026年5月15日，国务院常务会议审议通过《城市更新"十五五"行动方案》。

A. 甲
B. 乙
C. 丙
D. 丁
答案：A

# 公务员考试（行测）
## 第一部分 言语理解与表达
### 第 1 页
#### 第 44 题
题型：单选题
模块：言语理解
材料：
题干：当前，一系列科幻作品仍然______。

A. 甲
B. 乙
C. 丙
D. 丁
答案：B`

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
  {
    name: '人工样本：5/6 个 # 与双空格题号都能识别，不漏题',
    run: () => splitMarkdownBlocks(MANUAL_SAMPLE),
    expect: (blocks) => blocks.length === 2 && blocks[0].no === 4 && blocks[1].no === 5
      && blocks[0].body.includes('矛盾的同一性'),
    detail: (blocks) => JSON.stringify(blocks.map((b) => [b.no, b.body.slice(0, 24)])),
  },
  {
    name: '人工样本：模块纠正后部分标题自动归入常识判断',
    run: () => parseExamTemplate(MANUAL_SAMPLE),
    expect: (t) => t.sections.join('|') === '第一部分 常识判断'
      && t.pages.length === 1 && t.pages[0].questionIndexes.length === 2
      && t.pages[0].section === '第一部分 常识判断',
    detail: (t) => JSON.stringify({ sections: t.sections, pages: t.pages.map((p) => [p.no, p.questionIndexes.length, p.section]) }),
  },
  {
    name: '人工样本：全角选项标点与答案仍可解析',
    run: () => ruleMarkdownToQuestions(MANUAL_SAMPLE),
    expect: (qs) => qs.length === 2 && qs[0].answer === 'D'
      && qs[0].options[0].includes('事物存在和发展的前提')
      && qs[0].type === '常识',
    detail: (qs) => JSON.stringify(qs.map((q) => [q.type, q.answer, q.options[0].slice(0, 12)])),
  },
  {
    name: '人工样本：自动排版统一为标准四级标题与纠正后的部分',
    run: () => formatExamTemplate(MANUAL_SAMPLE),
    expect: (md) => !/#####/.test(md) && !/######/.test(md)
      && md.includes('## 第一部分 常识判断') && md.includes('#### 第 4 题')
      && ruleMarkdownToQuestions(md).length === 2,
    detail: (md) => md.slice(0, 220),
  },
  {
    name: '人工样本：上下文附着按模块纠正 section',
    run: () => attachTemplateContext(ruleMarkdownToQuestions(MANUAL_SAMPLE), MANUAL_SAMPLE),
    expect: (qs) => qs.every((q) => q.page === 1 && q.section === '第一部分 常识判断'),
    detail: (qs) => JSON.stringify(qs.map((q) => [q.page, q.section])),
  },
  {
    name: '多套卷：第二套卷页码重置也不与第一套卷并页',
    run: () => parseExamTemplate(MULTI_PAPER_SAMPLE),
    expect: (t) => t.papers.length === 2
      && t.pages.map((p) => p.id).join('|') === '1:3|2:1'
      && t.pages[0].questionIndexes.length === 1 && t.pages[1].questionIndexes.length === 1
      && !t.pages[0].body.includes('公务员考试（行测）')
      && t.pages[1].body.includes('公务员考试（行测）'),
    detail: (t) => JSON.stringify({ papers: t.papers, pages: t.pages.map((p) => [p.id, p.questionIndexes.length, p.body.slice(0, 24)]) }),
  },
  {
    name: '多套卷：新套卷标题不污染上一题题干',
    run: () => {
      const t = parseExamTemplate(MULTI_PAPER_SAMPLE)
      return ruleMarkdownToQuestions(t.pages[0].body)
    },
    expect: (qs) => qs.length === 1
      && !qs[0].title.includes('公务员考试') && !qs[0].title.includes('言语理解与表达')
      && qs[0].answer === 'A',
    detail: (qs) => JSON.stringify(qs.map((q) => q.title.slice(0, 60))),
  },
  {
    name: '多套卷：自动排版保留两套卷标题与各自页码',
    run: () => formatExamTemplate(MULTI_PAPER_SAMPLE),
    expect: (md) => md.includes('# 26 行测套题（一）') && md.includes('# 公务员考试（行测）')
      && md.includes('### 第 3 页') && md.includes('### 第 1 页')
      && ruleMarkdownToQuestions(md).length === 2,
    detail: (md) => md.slice(0, 260),
  },
  {
    name: '多套卷：按 id 回写只改目标页',
    run: () => {
      const next = updateTemplatePage(MULTI_PAPER_SAMPLE, '2:1', '#### 第 44 题\n题型：单选题\n模块：言语理解\n材料：\n题干：人工改过的第二套卷题目：\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n答案：C')
      return { next, t: parseExamTemplate(next) }
    },
    expect: (g) => g.next.includes('人工改过的第二套卷题目')
      && g.next.includes('2026年5月15日') && !g.next.includes('科幻作品仍然')
      && g.t.pages.length === 2 && g.t.pages[0].questionIndexes.length === 1,
    detail: (g) => JSON.stringify(g.t.pages.map((p) => [p.id, p.body.length])),
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
