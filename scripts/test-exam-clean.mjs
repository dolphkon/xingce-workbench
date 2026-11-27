import { cleanExamText, sanitizeSharedMaterial, stripResidualBoilerplate } from '../node_modules/.cache/exam-clean.mjs'

// 截图中的真实试卷封面噪音（OCR 输出形态）
const COVER = `sT8AoIGNGkAO 复制必备
(及四海公考版权所有
2026 下半年公务员考试题班《行测》重要提示：
为维护您的个人权益，确保考试的公平公正，请您协助我们监督考试实施情况。
本场考试规定：监考老师要向本考场全体考生展示题本密封情况，并邀请 2 名考生代表验封签字后，方能开启试卷。
请将此条形码揭下，贴在答题卡指定位置 WEF
注意事项：一、此项测试分为六个部分，总时限 120 分钟，各部分不单独计时，但都给出参考时限，供答题时合理分配时间。
二、请按照要求在答题卡上填写好自己的姓名，涂写好准考证号，严禁折叠答题卡。
三、必须在答题卡上答题；在题本上答题，一律无效。
四、监考人员宣布考试开始时，方可答题，宣布考试结束时，应立即停止答题。题本、答题卡、草稿纸一律留在桌上，待监考人员确认数量无误、允许离开后，方可离开考场。
五、在这项测试中，可能有些试题较难，因此你不要在一道题上思考时间太久，遇到不会答的题目可先跳过去，如果有时间再去思考，否则，你可能没有时间完成后面的题目。
第 1 页 共 20 页`

const REAL_QUESTION = `1. 免密支付本质是技术进步对消费体验的重塑。对上述文段主旨概括准确的是：A.风险是信息不透明 B.需兼顾技术进步与用户权益 C.一键取消是核心 D.全链条机制决定成败 答案：B
2. 2023年某市GDP为1200亿元，同比增长8.5%。根据上述材料，第三产业增加值约为：A.624亿元 B.744亿元 C.812亿元 D.960亿元 答案：B`

const cases = [
  {
    name: '试卷封面水印/密封线/注意事项整体清除，题目保留',
    run: () => cleanExamText(`${COVER}\n\n${REAL_QUESTION}`),
    expect: (out) => {
      const banned = ['复制必备', '版权所有', '密封', '条形码', '监考', '注意事项', '总时限', '第 1 页']
      const missing = banned.filter((k) => out.includes(k))
      return missing.length === 0 && out.includes('对上述文段主旨概括准确的是') && out.includes('根据上述材料，第三产业增加值约为')
    },
    detail: (out) => out.slice(0, 120),
  },
  {
    name: '共用材料判定：封面说明整段丢弃',
    run: () => sanitizeSharedMaterial(COVER),
    expect: (out) => out === '',
    detail: (out) => JSON.stringify(out.slice(0, 120)),
  },
  {
    name: '共用材料判定：真实片段阅读文段保留',
    run: () => sanitizeSharedMaterial('免密支付本质是技术进步对消费体验的重塑，但其健康发展必须建立在尊重消费者权利的基础之上。从多次跳转到一键取消，这不仅关乎消费者切身利益，更关系到市场健康与消费信心的可持续。'),
    expect: (out) => out.includes('免密支付本质') && out.length > 50,
    detail: (out) => out.slice(0, 60),
  },
  {
    name: '结果兜底：清掉共用材料里的水印行',
    run: () => stripResidualBoilerplate('【共用材料】\nsT8AoIGNGkAO 复制必备\n免密支付本质是技术进步对消费体验的重塑。\n\n【题目】对上述文段主旨概括准确的是：'),
    expect: (out) => !out.includes('复制必备') && out.includes('免密支付本质') && out.includes('对上述文段'),
    detail: (out) => out.slice(0, 120),
  },
  {
    name: '安全兜底：清洗后内容过短则保留原文',
    run: () => cleanExamText('复制必备\n答案：B'),
    expect: (out) => out.includes('答案：B'),
    detail: (out) => out,
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
