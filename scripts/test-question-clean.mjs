import { refineAtomicQuestion, stripQuestionNumber, stripOptionLetter } from '../node_modules/.cache/question-clean.mjs'

const cases = [
  {
    name: '去题干题号与选项字母前缀',
    run: () => refineAtomicQuestion({
      stem: '1. 为何校园内外的体育锻炼氛围，有如此差别？关键在于理念不同。',
      options: ['A) 二者兴趣差异', 'B) “过程导向”和“结果导向”的差异', 'C) 哪项活动更有帮助', 'D) 校园活动单一性和校外活动多元化'],
      answer: 'D', analysis: '', type: '判断推理',
    }),
    expect: (g) => g.stem.startsWith('为何校园内外') && !g.stem.startsWith('1.')
      && g.options[0] === '二者兴趣差异' && g.options[3] === '校园活动单一性和校外活动多元化' && g.answer === 'D',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '选项挤在题干一行：行内抽取 + 答案回填',
    run: () => refineAtomicQuestion({
      stem: '2. 创业是就业之源。对上述文段主旨概括准确的是：A.创业带动就业 B.就业优先战略 C.放宽市场准入 D.健全社保政策 答案：A',
      options: [], answer: '', analysis: '', type: '言语理解',
    }),
    expect: (g) => g.stem === '创业是就业之源。对上述文段主旨概括准确的是：'
      && g.options[0] === '创业带动就业' && g.options[3] === '健全社保政策' && g.answer === 'A',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '答案在解析里回填并从题干清除',
    run: () => refineAtomicQuestion({
      stem: '3. 下列说法错误的是：', options: ['甲', '乙', '丙', '丁'], answer: '', analysis: '参考答案：B', type: '常识',
    }),
    expect: (g) => g.answer === 'B' && !g.analysis.includes('答案'),
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '纯函数：单工具函数行为',
    run: () => ({ q: stripQuestionNumber('第12题 下列说法正确的是：'), o: stripOptionLetter('（C）第三个选项') }),
    expect: (g) => g.q === '下列说法正确的是：' && g.o === '第三个选项',
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
