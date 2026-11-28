import { chromium } from 'playwright-core'
import JSZip from 'jszip'
import fs from 'node:fs'

const BASE = process.env.E2E_BASE || 'http://localhost:5173/'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// 含版式噪音 + 题号重置的试卷文本
const LINES = [
  'st8AoNGkAo 复制必究',
  '2026 下半年公考笔试·套题冲刺班一期',
  '※淡溪第 9 页 共 39 页第三部分 言语理解与表达',
  '42. 知识和信息时，孩子和家长反而，选择性了解、碎片化阅读又让当下孩子的知识结构变得碎片化，依次填入画横线部分最恰当的一项是：A.排山倒海无从选择 B.扑面而来手足无措 C.蜂拥而至进退维谷 D.铺天盖地无从适从 答案：C',
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
fs.writeFileSync('/tmp/e2e-markdown-flow.docx', await zip.generateAsync({ type: 'nodebuffer' }))

// 1×1 PNG，用于验证图片插入与原比例预览
fs.writeFileSync('/tmp/e2e-md-material.png', Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
))

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(BASE + '#/question-bank')
await page.getByRole('button', { name: '文档转在线刷题' }).click()
await page.waitForSelector('.document-to-paper-page')

// 阶段①：上传文档 → 结构化题槽（题号锚点定边界）
await page.locator('input[type=file]').first().setInputFiles('/tmp/e2e-markdown-flow.docx')
await page.waitForSelector('.te-page', { timeout: 40000 })
const initialCards = await page.locator('.te-question-card').count()
const stems = await page.locator('.te-question-card').evaluateAll((cards) =>
  cards.map((card) => card.querySelectorAll('textarea')[1]?.value ?? ''))
console.log('① 结构化题槽数:', initialCards)
console.log('① 噪音残留:', /复制必究|biguo368|共 39 页/.test(stems.join('\n')))
console.log('① 题号重置切题:', await page.locator('.te-no input').evaluateAll((els) => els.map((el) => el.value).join(',')))
const notice = await page.locator('.te-head p').textContent()
console.log('① 生成方式:', notice?.trim())

// 字段级图片插入：题槽图片 → 卷面预览等比显示
await page.locator('.te-question-card').first().getByRole('button', { name: '添加图片' }).click()
await page.locator('.te-page input[type=file][accept="image/*"]').setInputFiles('/tmp/e2e-md-material.png')
await page.locator('.te-image-thumb img').first().waitFor({ timeout: 5000 })
const imageCount = await page.locator('.te-preview-image').count()
const imgBox = await page.locator('.te-preview-image').first().boundingBox()
console.log('② 图片插入:', imageCount, '预览尺寸:', imgBox ? `${Math.round(imgBox.width)}x${Math.round(imgBox.height)}` : '(无)')
await page.screenshot({ path: '/tmp/xingce-markdown-editor.png', fullPage: true })

// 阶段②：文本视图导入人工校验后的规范模板，验证导入后字段编辑与生成
const edited = `# 人工校验版

## 第一部分 言语理解与表达
### 第 1 页
#### 第 1 题
题型：单选题
模块：言语理解
材料：图形推理材料
题干：以下对应表述正确的有：

① 第一项
② 第二项
③ 第三项
④ 第四项
答案：B

#### 第 2 题
题型：单选题
模块：常识判断
材料：
题干：下列说法正确的是：

A. 甲
B. 乙
C. 丙
D. 丁
答案：A`
await page.getByRole('button', { name: '文本视图' }).click()
await page.locator('.te-textarea').fill(edited)
await page.getByRole('button', { name: '应用文本' }).click()
await page.locator('.te-question-card').first().waitFor()
const firstOptions = await page.locator('.te-question-card').first().locator('.te-option input').evaluateAll((els) => els.map((el) => el.value))
const answer = await page.locator('.te-question-card').first().locator('.te-answer-input').inputValue()
console.log('③ 首题选项:', firstOptions.join(' | '))
console.log('③ 首题答案:', answer)
await page.getByRole('button', { name: '生成套卷' }).click()
await page.waitForSelector('.paper-review-page', { timeout: 20000 })
const items = await page.locator('.paper-q-card').count()
const firstStem = await page.locator('.paper-q-card .paper-q-stem').first().textContent()
const answerChip = await page.locator('.paper-q-card .chip-success').first().textContent()
console.log('④ 套卷题目数:', items)
console.log('④ 首题题干:', firstStem?.trim())
console.log('④ 首题答案:', answerChip?.trim())

await page.screenshot({ path: '/tmp/xingce-markdown-flow.png', fullPage: true })
console.log('JS 错误:', errors.length ? errors.join(' | ') : '无')
await browser.close()

const ok = initialCards >= 2 && !/复制必究|biguo368|共 39 页/.test(stems.join('\n'))
  && imageCount >= 1 && firstOptions.some((s) => /第二项|第2项/.test(s)) && answer === 'B'
  && items === 2 && (firstStem ?? '').includes('以下对应表述正确的有') && (answerChip ?? '').includes('B')
  && errors.length === 0
console.log(ok ? '\nE2E PASS' : '\nE2E FAIL')
process.exit(ok ? 0 : 1)
