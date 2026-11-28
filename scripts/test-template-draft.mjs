import {
  buildTemplateDraft, applyTemplateFill, splitTemplateQuestion, templateStats,
  draftToQuestions, draftToMarkdown, markdownToDraft, inferModule, moduleToSection,
  hasMergedQuestions,
} from '../node_modules/.cache/template-draft.mjs'

/** 用户样本的典型形态：多题被 AI 写进一个题块，但原文题号锚点完整 */
const MERGED_SAMPLE = `1. 小连将这些页码相加时，错把其中的一个页码加了两次，结果为1213，则第多少页被加了两次？
2. 把2个红色标牌和6个黄色标牌竖立在道路两侧，每边竖立9个标牌，问有多少种不同的竖立方法？
3. 书法、园艺和舞蹈三个兴趣小组，26位老人至少参加一个，其中参加书法组的有多少人？`

const RESET_SAMPLE = `42. 知识和信息时代，选择性了解让知识结构碎片化，依次填入画横线部分最恰当的一项是：A.甲 B.乙 C.丙 D.丁 答案：C
43. 史铁生无疑是一个生命的奇迹，时代变迁改变不了生命原始的芬芳，下列说法正确的是：A.甲 B.乙 C.丙 D.丁 答案：A
2. 下列说法正确的一项是：A.甲 B.乙 C.丙 D.丁 答案：B`

const build = (text, pageTexts = [text]) => buildTemplateDraft({
  text, pageTexts, title: '回归样本', fileName: 'sample.docx',
  fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  fileData: '', textMethod: 'Word 文本层', usedOcr: false,
})

const cases = [
  {
    name: '结构化题槽：原文题号锚点切出独立题块，不受 AI 粘连影响',
    run: () => build(MERGED_SAMPLE),
    expect: (d) => d.questions.length === 3
      && d.questions.map((q) => q.no).join(',') === '1,2,3'
      && d.questions.every((q) => q.id && q.stem && q.options.length === 4),
    detail: (d) => JSON.stringify(d.questions.map((q) => [q.no, q.stem.slice(0, 18)])),
  },
  {
    name: '结构化题槽：题号从 42 起手并按部分重置为 2',
    run: () => build(RESET_SAMPLE),
    expect: (d) => d.questions.length === 3 && d.questions.map((q) => q.no).join(',') === '42,43,2',
    detail: (d) => JSON.stringify(d.questions.map((q) => q.no)),
  },
  {
    name: 'AI 回填：按题号对齐字段且不新增题槽',
    run: () => {
      const draft = build(MERGED_SAMPLE)
      return applyTemplateFill(draft, [
        { no: 2, module: '数量关系', material: '道路标牌', stem: '有多少种竖立方法？', options: ['6', '12', '18', '24'], answer: 'C', analysis: '排列组合' },
      ])
    },
    expect: (d) => d.questions.length === 3 && d.usedLlm
      && d.questions[1].origin === 'ai' && d.questions[1].module === '数量关系'
      && d.questions[1].section === '数量关系' && d.questions[1].answer === 'C'
      && d.questions[1].analysis === '排列组合',
    detail: (d) => JSON.stringify(d.questions.map((q) => [q.no, q.module, q.answer, q.origin])),
  },
  {
    name: 'AI 回填：重复题号按出现顺序配对，模型粘连文本被拒绝',
    run: () => {
      const raw = `第一部分\n1. 甲题下列说法正确的是：A.甲 B.乙 C.丙 D.丁 答案：A\n第二部分\n1. 乙题下列说法正确的是：A.甲 B.乙 C.丙 D.丁 答案：B`
      const draft = build(raw)
      return applyTemplateFill(draft, [
        { no: 1, module: '常识', stem: '甲题下列说法正确的是：', options: ['甲', '乙', '丙', '丁'], answer: 'A' },
        { no: 1, module: '政治理论', stem: '1. 甲题下列说法正确的是： 2. 乙题下列说法正确的是：', options: ['甲', '乙', '丙', '丁'], answer: 'B' },
      ])
    },
    expect: (d) => d.questions.length === 2
      && d.questions[0].stem.includes('甲题') && d.questions[0].origin === 'ai'
      && d.questions[1].stem.includes('乙题') && d.questions[1].answer === 'B',
    detail: (d) => JSON.stringify(d.questions.map((q) => [q.stem.slice(0, 22), q.answer, q.origin])),
  },
  {
    name: '粘连检测：多题号文本不会被当作单题字段',
    run: () => hasMergedQuestions('1. 甲题下列说法正确的是： 2. 乙题下列说法正确的是：'),
    expect: (value) => value === true,
    detail: (value) => String(value),
  },
  {
    name: '人工拆分：把误粘题槽按原文题号重新拆开',
    run: () => {
      const draft = build(MERGED_SAMPLE)
      const single = {
        ...draft,
        questions: [{ ...draft.questions[0], source: MERGED_SAMPLE }],
      }
      return splitTemplateQuestion(single, single.questions[0].id)
    },
    expect: (d) => d.questions.length >= 3 && d.questions.every((q) => q.id),
    detail: (d) => JSON.stringify(d.questions.map((q) => [q.no, q.stem.slice(0, 16)])),
  },
  {
    name: '序列化往返：Markdown 导入保持题号/部分/页与题目数',
    run: () => {
      const draft = build(MERGED_SAMPLE)
      const round = markdownToDraft(draftToMarkdown(draft), { title: draft.title })
      return { round, stats: templateStats(round), questions: draftToQuestions(round) }
    },
    expect: (g) => g.stats.questions === 3 && g.stats.pages === 1
      && g.round.questions.map((q) => q.no).join(',') === '1,2,3'
      && g.questions.every((q) => q.section && q.page === 1),
    detail: (g) => JSON.stringify(g.round.questions.map((q) => [q.no, q.section, q.page])),
  },
  {
    name: '模块归一：行测六大模块映射到标准部分标题',
    run: () => ({ module: inferModule('第三部分 言语理解与表达'), section: moduleToSection('言语理解'), other: moduleToSection('') }),
    expect: (g) => g.module === '言语理解' && g.section === '言语理解与表达' && g.other === '其他',
    detail: (g) => JSON.stringify(g),
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
