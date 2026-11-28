import {
  parseAnswerText, applyAnswerImport, exportAnswerText,
} from '../node_modules/.cache/answer-batch.mjs'

const targets = [
  { id: 'q1', no: 1, title: '第一题题干', answer: '' },
  { id: 'q2', no: 2, title: '第二题题干', answer: 'B' },
  { id: 'q3', no: 3, title: '第三题题干', answer: '' },
]

const cases = [
  {
    name: '解析：1A 2B 3C 空格分隔',
    run: () => parseAnswerText('1A 2B 3C'),
    expect: (g) => g.pairs.length === 3 && g.pairs.map((p) => p.answer).join('') === 'ABC',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '解析：1.A 2.B 3、C 多种分隔符',
    run: () => parseAnswerText('1.A 2.B 3、C'),
    expect: (g) => g.pairs.length === 3 && g.pairs[2].answer === 'C',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '解析：1A2B3C 无空格粘连串',
    run: () => parseAnswerText('1A2B3C'),
    expect: (g) => g.pairs.length === 3 && g.pairs.map((p) => p.no).join(',') === '1,2,3',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '解析：纯字母串按顺序编号',
    run: () => parseAnswerText('ABCD'),
    expect: (g) => g.pairs.length === 4 && g.pairs[3].no === 4,
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '解析：多行格式',
    run: () => parseAnswerText('1. A\n2. B\n3. C'),
    expect: (g) => g.pairs.length === 3 && g.pairs[1].answer === 'B',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '解析：多选题 AB 不丢字母',
    run: () => parseAnswerText('1AB 2D'),
    expect: (g) => g.pairs.length === 2 && g.pairs[0].answer === 'AB',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '解析：完全无法识别时回显原文',
    run: () => parseAnswerText('都不是答案的内容'),
    expect: (g) => g.pairs.length === 0 && g.invalid.length === 1,
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '解析：重复题号原样保留，交由匹配层决策',
    run: () => parseAnswerText('1A 1B 2C'),
    expect: (g) => g.pairs.length === 3 && g.pairs.map((p) => p.answer).join('') === 'ABC',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '匹配：按原文题号回填非连续题号',
    run: () => applyAnswerImport(
      [
        { id: 'a', no: 11, title: '十一', answer: '' },
        { id: 'b', no: 12, title: '十二', answer: '' },
        { id: 'c', no: 13, title: '十三', answer: '' },
      ],
      '13C 11A', 'no',
    ),
    expect: (g) => g.matched.length === 2 && g.answers.a === 'A' && g.answers.c === 'C' && !g.answers.b,
    detail: (g) => JSON.stringify(g.answers),
  },
  {
    name: '匹配：题号按部分重置时同号题依次分配',
    run: () => applyAnswerImport(
      [
        { id: 'p1-1', no: 1, title: '第一部分第1题', answer: '' },
        { id: 'p1-2', no: 2, title: '第一部分第2题', answer: '' },
        { id: 'p2-1', no: 1, title: '第二部分第1题', answer: '' },
        { id: 'p2-2', no: 2, title: '第二部分第2题', answer: '' },
      ],
      '1A 2B 1C 2D', 'no',
    ),
    expect: (g) => g.matched.length === 4 && g.answers['p1-1'] === 'A'
      && g.answers['p2-1'] === 'C' && g.answers['p2-2'] === 'D',
    detail: (g) => JSON.stringify(g.answers),
  },
  {
    name: '匹配：题号唯一时重复答案取最后一次',
    run: () => applyAnswerImport(
      [
        { id: 'q1', no: 1, title: '第一题', answer: '' },
        { id: 'q2', no: 2, title: '第二题', answer: '' },
      ],
      '1A 1B 2C', 'no',
    ),
    expect: (g) => g.matched.length === 2 && g.answers.q1 === 'B' && g.answers.q2 === 'C',
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '匹配：切换到列表序号时按位置回填',
    run: () => applyAnswerImport(targets, '1C 2A 3D', 'index'),
    expect: (g) => g.answers.q1 === 'C' && g.answers.q2 === 'A' && g.answers.q3 === 'D',
    detail: (g) => JSON.stringify(g.answers),
  },
  {
    name: '匹配：未匹配的题号单独列出且不覆盖已有答案',
    run: () => applyAnswerImport(targets, '1A 99B', 'no'),
    expect: (g) => g.matched.length === 1 && g.unmatched.length === 1 && g.answers.q2 === undefined,
    detail: (g) => JSON.stringify(g),
  },
  {
    name: '导出：题号+答案格式，缺失题号用序号',
    run: () => exportAnswerText([{ no: 1, answer: 'A' }, { no: 5, answer: 'AB' }, { answer: 'C' }]),
    expect: (g) => g === '1A 5AB 3C',
    detail: (g) => g,
  },
  {
    name: '闭环：批量导入只改命中题，其他题保持原答案',
    run: () => {
      const result = applyAnswerImport(targets, '3B', 'no')
      return { ...result, unchanged: targets[1].answer }
    },
    expect: (g) => g.answers.q3 === 'B' && g.answers.q1 === undefined && g.unchanged === 'B',
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
