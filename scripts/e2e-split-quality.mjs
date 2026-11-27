import { chromium } from 'playwright-core'
import JSZip from 'jszip'
import fs from 'node:fs'

const BASE = 'http://localhost:5183/'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// 截图中的真实 OCR 形态：封面水印 + 页眉页码 + 推广串 + 题号从 42 起手 + 题号重置为 2
const LINES = [
  'st8AoNGkAo 复制必究',
  '2026 下半年公考笔试·套题冲刺班一期',
  '行政职业能力测验（一）',
  '※淡溪第 9 页 共 39 页第三部分 言语理解与表达',
  '（共 30 题，参考时间：28 分钟）',
  '一手最全人考说题 | 岗信 biguo368',
  '42. 知识和信息时，孩子和家长反而，选择性了解、碎片化阅读又让当下孩子的知识结构变得碎片化，因此依然需要一本权威的百科全书。依次填入画横线部分最恰当的一项是：A.排山倒海无从选择 B.扑面而来手足无措 C.蜂拥而至进退维谷 D.铺天盖地无从适从 答案：C',
  '43. 史铁生无疑是一个生命的奇迹。时代变迁，改变不了生命原始的芬芳。',
  '2. 第二部分第一题：下列说法正确的一项是：A.甲正确 B.乙错误 C.丙正确 D.丁错误 答案：B',
]

const zip = new JSZip()
zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
const q = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`
zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${LINES.map(q).join('')}</w:body></w:document>`)
fs.writeFileSync('/tmp/e2e-split-quality.docx', await zip.generateAsync({ type: 'nodebuffer' }))

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(BASE + '#/online-practice')
await page.waitForSelector('.online-practice-page')
await page.locator('input[type=file]').first().setInputFiles('/tmp/e2e-split-quality.docx')
await page.waitForSelector('.op-review', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(400)

const text = await page.locator('.op-review').innerText().catch(() => '')
const questionCount = await page.locator('.op-review-item').count()
const banned = ['复制必究', 'biguo', '第 9 页', '参考时间', '言语理解与表达']
const noise = banned.filter((k) => text.includes(k))
// UI 会自动渲染 <b>1.</b> 序号，这里只检查原始大题号（42/43）是否漏进题干
const leakedNumber = /(?:^|\n)\s*(?:42|43)\s*\./.test(text)
await page.screenshot({ path: '/tmp/xingce-split-quality.png', fullPage: true })

console.log(JSON.stringify({
  questionCount,
  noise,
  leakedNumber,
  hasFirstAnswer: text.includes('正确答案') || text.includes('C'),
  errors,
  preview: text.slice(0, 500),
}, null, 2))
await browser.close()
process.exit(questionCount >= 3 && noise.length === 0 && !leakedNumber && errors.length === 0 ? 0 : 1)
