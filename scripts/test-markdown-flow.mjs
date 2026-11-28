import {
  normalizeMarkdown, splitMarkdownBlocks, ruleMarkdownToQuestions, questionsToMarkdown,
  ruleTextToMarkdown, mergeMarkdownWithRules, parseOptionLine, extractMarkdownImages,
  repairMarkdownTemplate,
} from '../node_modules/.cache/markdown-flow.mjs'

const MD = `# 行测套题

## 第 42 题
题型：单选题
模块：言语理解
材料：知识和信息时代，孩子与家长选择性了解、碎片化阅读让知识结构变得碎片化。
题干：依次填入画横线部分最恰当的一项是：

A. 排山倒海 无从选择
B. 扑面而来 手足无措
C. 蜂拥而至 进退维谷
D. 铺天盖地 无从适从
答案：C

解析：语境强调信息大量涌来，故选 C。

## 第 2 题
题型：多选题
模块：常识判断
材料：
题干：关于经济基础和上层建筑，表述正确的有：

A. 经济基础决定上层建筑
B. 上层建筑反作用于经济基础
C. 二者毫无关联
D. 上层建筑的性质由经济基础决定
答案：ABD`

/** 用户真实样本的典型排版错误：内联标题 + 同部分重复题号 + 转场噪音 */
const FORMAT_SAMPLE = `#### 第 4 题
题型：单选题
模块：常识
材料：
题干：矛盾的同一性和斗争性相结合，下列表述错误的一项是： ## 其他（常识）

A. 甲
B. 乙
C. 丙
D. 丁
答案：D

第 2 3 页共 3 9 页
第四部分结束，请继续做第五部分! ※※※

#### 第 5 题
题型：单选题
模块：常识
材料：
题干：第一道第五题

#### 第 5 题
题型：单选题
模块：常识
材料：
题干：第二道第五题`

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
    name: '规则解析：题号/模块/材料/题干/选项/答案/解析落地',
    run: () => ruleMarkdownToQuestions(MD),
    expect: (qs) => qs.length === 2
      && qs[0].answer === 'C'
      && qs[0].options.filter(Boolean).length === 4
      && qs[0].title.includes('【共用材料】')
      && qs[0].title.includes('【题目】')
      && qs[0].title.includes('依次填入画横线部分')
      && qs[0].analysis.includes('语境强调')
      && qs[1].answer === 'ABD',
    detail: (g) => JSON.stringify(g.map((q) => ({ answer: q.answer, title: q.title.slice(0, 50), opts: q.options }))),
  },
  {
    name: '规则解析：材料为空不产生空标记，题干独立字段生效',
    run: () => ruleMarkdownToQuestions(MD)[1],
    expect: (q) => !q.title.includes('【共用材料】') && q.title.includes('关于经济基础和上层建筑'),
    detail: (q) => q.title,
  },
  {
    name: '题干字段兼容旧写法「题干原文：」',
    run: () => ruleMarkdownToQuestions('## 第 1 题\n题型：单选题\n模块：常识\n题干原文：下列说法正确的是：\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n答案：A')[0],
    expect: (q) => q.title.includes('下列说法正确的是') && !q.title.includes('题干原文'),
    detail: (q) => q.title,
  },
  {
    name: '符号选项：①②③④ 依次映射 A-D',
    run: () => ruleMarkdownToQuestions('## 第 7 题\n题型：单选题\n模块：判断推理\n题干：图形推理正确的是：\n① 第一项\n② 第二项\n③ 第三项\n④ 第四项\n答案：B'),
    expect: (q) => q[0].options.join('|') === '第一项|第二项|第三项|第四项' && q[0].answer === 'B',
    detail: (g) => JSON.stringify(g[0]?.options),
  },
  {
    name: '符号选项：（1）/1. 与纯函数解析',
    run: () => ({
      paren: parseOptionLine('（3）第三项'),
      digit: parseOptionLine('2. 第二项'),
      plain: parseOptionLine('这是题干不是选项'),
    }),
    expect: (g) => g.paren?.index === 2 && g.paren?.text === '第三项'
      && g.digit?.index === 1 && g.digit?.text === '第二项' && g.plain === null,
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '材料图片：Markdown 图片抽到 images，材料文本保留说明',
    run: () => ruleMarkdownToQuestions('## 第 8 题\n题型：单选题\n模块：判断推理\n材料：图形推理 ![图形材料](data:image/png;base64,AAA)\n题干：选择最符合规律的一项：\nA. 甲\nB. 乙\nC. 丙\nD. 丁')[0],
    expect: (q) => q.images?.length === 1 && q.images[0].includes('data:image/png')
      && q.title.includes('图形推理') && !q.title.includes('!['),
    detail: (q) => JSON.stringify({ title: q.title, images: q.images }),
  },
  {
    name: '序列化：字段顺序固定且题干显式写出、材料可为空',
    run: () => questionsToMarkdown(ruleMarkdownToQuestions(MD), '往返测试'),
    expect: (md) => {
      const block = splitMarkdownBlocks(md)[0].body
      const order = ['题型：', '模块：', '材料：', '题干：', 'A. ', '答案：'].map((key) => block.indexOf(key))
      return order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))
        && splitMarkdownBlocks(md)[1].body.includes('材料：\n')
    },
    detail: (md) => splitMarkdownBlocks(md)[0].body.slice(0, 200),
  },
  {
    name: '序列化 → 再解析往返：题数、答案、选项、图片保持一致',
    run: () => {
      const qs = ruleMarkdownToQuestions(MD)
      qs[0].images = ['data:image/png;base64,AAA']
      return ruleMarkdownToQuestions(questionsToMarkdown(qs, '往返测试'))
    },
    expect: (qs) => qs.length === 2 && qs[0].answer === 'C' && qs[1].answer === 'ABD'
      && qs[0].options.filter(Boolean).length === 4 && qs[0].images?.length === 1,
    detail: (g) => JSON.stringify(g.map((q) => ({ answer: q.answer, opts: q.options, images: q.images }))),
  },
  {
    name: '规则补全漏题：AI 漏掉题号重置的题，补回中间稿',
    run: () => {
      const raw = '42. 甲题：下列说法正确的是：A.甲 B.乙 C.丙 D.丁 答案：A\n43. 乙题：下列说法错误的是：A.甲 B.乙 C.丙 D.丁 答案：B\n2. 丙题：下列说法正确的是：A.甲 B.乙 C.丙 D.丁 答案：C'
      const ai = `## 第 42 题\n题型：单选题\n模块：常识判断\n材料：\n题干：甲题：下列说法正确的是：\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n答案：A\n\n## 第 43 题\n题型：单选题\n模块：常识判断\n材料：\n题干：乙题：下列说法错误的是：\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n答案：B`
      return splitMarkdownBlocks(mergeMarkdownWithRules(ai, raw)).map((b) => b.no)
    },
    expect: (nos) => nos.join(',') === '42,43,2',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: 'AI 错编题号与臆造试卷名：按原文题号锚点纠正',
    run: () => {
      const raw = '11. 2026年5月15日，国务院总理李强主持召开国务院常务会议，审议通过《城市更新“十五五”规划》。A.甲 B.乙 C.丙 D.丁 答案：A\n44. 当前，一系列科幻作品仍然______，零星几部的成功或失败。A.甲 B.乙 C.丙 D.丁 答案：B'
      const ai = `# 公务员考试（行测）
## 第一部分 言语理解与表达
### 第 1 页
#### 第 43 题
题型：单选题
模块：常识
材料：
题干：2026年5月15日，国务院总理李强主持召开国务院常务会议，审议通过《城市更新“十五五”规划》。
A. 甲
B. 乙
C. 丙
D. 丁
答案：A

#### 第 44 题
题型：单选题
模块：言语理解
材料：
题干：当前，一系列科幻作品仍然______，零星几部的成功或失败。
A. 甲
B. 乙
C. 丙
D. 丁
答案：B`
      const merged = mergeMarkdownWithRules(ai, raw)
      return { merged, nos: splitMarkdownBlocks(merged).map((b) => b.no) }
    },
    expect: (g) => g.nos.join(',') === '11,44'
      && !g.merged.includes('公务员考试（行测）')
      && g.merged.includes('第 11 题') && g.merged.includes('第 44 题'),
    detail: (g) => JSON.stringify({ nos: g.nos, head: g.merged.slice(0, 140) }),
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
    expect: (md) => md.includes('## 第 1 题') && md.includes('## 第 2 题')
      && md.includes('题干：') && md.includes('材料：') && md.includes('A. 甲'),
    detail: (md) => md.slice(0, 160),
  },
  {
    name: '纯函数：图片标记抽取不影响普通文本',
    run: () => extractMarkdownImages('普通材料文本'),
    expect: (g) => g.text === '普通材料文本' && g.images.length === 0,
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '用户样本：内联模块标题拆行并上提到下一题之前',
    run: () => repairMarkdownTemplate(FORMAT_SAMPLE),
    expect: (md) => !md.includes('的一项是： ##')
      && md.indexOf('## 其他（常识）') < md.indexOf('#### 第 5 题')
      && md.indexOf('## 其他（常识）') > md.lastIndexOf('答案：D'),
    detail: (md) => md.slice(0, 240),
  },
  {
    name: '用户样本：同部分重复题号顺延为第 5/6 题',
    run: () => splitMarkdownBlocks(repairMarkdownTemplate(FORMAT_SAMPLE)).map((b) => b.no),
    expect: (nos) => nos.join(',') === '4,5,6',
    detail: (nos) => nos.join(','),
  },
  {
    name: '用户样本：页眉与转场噪音整行剔除',
    run: () => repairMarkdownTemplate(FORMAT_SAMPLE),
    expect: (md) => !md.includes('第 2 3 页共 3 9 页') && !md.includes('第四部分结束'),
    detail: (md) => md.slice(0, 240),
  },
  {
    name: '用户样本：非标准标题不污染题干',
    run: () => ruleMarkdownToQuestions(repairMarkdownTemplate(FORMAT_SAMPLE)),
    expect: (qs) => qs.length === 3 && qs.every((q) => !q.title.includes('其他（常识）')),
    detail: (qs) => JSON.stringify(qs.map((q) => q.title)),
  },
  {
    name: '用户样本：重复题号按题干锚点分别回填原文题块',
    run: () => {
      const ai = `#### 第 1 题
题型：单选题
模块：常识
材料：
题干：甲题：下列说法正确的一项是：
A. 甲
B. 乙
C. 丙
D. 丁
答案：A

#### 第 1 题
题型：单选题
模块：常识
材料：
题干：乙题：下列说法正确的一项是：
A. 甲
B. 乙
C. 丙
D. 丁
答案：B`
      const raw = `1. 甲题：下列说法正确的一项是：
A.甲
B.乙
C.丙
D.丁
答案：A
2. 乙题：下列说法正确的一项是：
A.甲
B.乙
C.丙
D.丁
答案：B`
      return splitMarkdownBlocks(mergeMarkdownWithRules(ai, raw)).map((b) => ({ no: b.no, body: b.body }))
    },
    expect: (blocks) => blocks.length === 2 && blocks[0].no === 1 && blocks[1].no === 2
      && blocks[0].body.includes('甲题') && blocks[1].body.includes('乙题'),
    detail: (blocks) => JSON.stringify(blocks.map((b) => [b.no, b.body.slice(0, 24)])),
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
