import { chromium } from 'playwright-core'
import JSZip from 'jszip'
import fs from 'node:fs'

const BASE = 'http://localhost:5173/'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

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
await page.goto(BASE + '#/online-practice')
await page.waitForSelector('.online-practice-page')

// 阶段①：上传文档 → 生成 Markdown 中间稿
await page.locator('input[type=file]').first().setInputFiles('/tmp/e2e-markdown-flow.docx')
await page.waitForSelector('.md-review', { timeout: 40000 })
const mdText = await page.locator('.md-review-editor').inputValue()
const blocks = (mdText.match(/## 第 \d+ 题/g) || []).length
console.log('① Markdown 题块数:', blocks)
console.log('① 噪音残留:', /复制必究|biguo368|共 39 页/.test(mdText))
console.log('① 题干字段:', mdText.includes('题干：'), '材料字段:', mdText.includes('材料：'))
const notice = await page.locator('.md-review-head p').textContent()
console.log('① 生成方式:', notice?.trim())

// 人工插入符号：工具栏「符号」→ 带圈数字 ①
await page.locator('.md-review-actions button[title*="插入符号"]').click()
await page.locator('.symbol-panel button[title="插入 ①"]').click()
const afterSymbol = await page.locator('.md-review-editor').inputValue()
console.log('② 符号插入:', afterSymbol.includes('①'))

// 人工插入图片：上传截图 → DataURL + 原比例预览
await page.locator('input[type=file][accept="image/*"]').setInputFiles('/tmp/e2e-md-material.png')
await page.waitForTimeout(800)
const afterImage = await page.locator('.md-review-editor').inputValue()
console.log('② 图片插入调试:', afterImage.includes('![材料图]') ? '已写入' : '未写入', '错误提示:', await page.locator('.md-review .error-text').allTextContents())
console.log('② 编辑器前 120 字:', afterImage.slice(0, 120).replace(/\n/g, '\\n'))
await page.locator('.md-material-image').first().waitFor({ timeout: 5000 })
const imageCount = await page.locator('.md-material-image').count()
console.log('② 图片插入:', afterImage.includes('![材料图](data:image/png'), '预览数:', imageCount)
const imgBox = await page.locator('.md-material-image img').first().boundingBox()
console.log('② 图片预览尺寸:', imgBox ? `${Math.round(imgBox.width)}x${Math.round(imgBox.height)}` : '(无)')
await page.screenshot({ path: '/tmp/xingce-markdown-editor.png', fullPage: true })

// 阶段②：填入人工校验后的规范 Markdown（材料图片 + 符号选项），解析成题
const edited = `# 人工校验版

## 第 1 题
题型：单选题
模块：言语理解
材料：图形推理材料 ![图形材料](data:image/png;base64,AAA)
题干：以下对应表述正确的有：

① 第一项
② 第二项
③ 第三项
④ 第四项
答案：B

## 第 2 题
题型：单选题
模块：常识判断
材料：
题干：下列说法正确的是：

A. 甲
B. 乙
C. 丙
D. 丁
答案：A`
await page.locator('.md-review-editor').fill(edited)
await page.getByRole('button', { name: /解析为 \d+ 道题/ }).click()
await page.waitForSelector('.op-review', { timeout: 40000 })
const items = await page.locator('.op-review-item').count()
const firstStem = await page.locator('.op-review-item .op-review-q').first().textContent()
const answer = await page.locator('.op-review-item .op-review-answer').first().textContent()
const firstOptions = await page.locator('.op-review-item').first().locator('.op-review-opt').allTextContents()
console.log('③ 题目数:', items)
console.log('③ 首题题干:', firstStem?.trim())
console.log('③ 首题选项:', firstOptions.slice(0, 4).map((s) => s.trim()).join(' | '))
console.log('③ 首题答案:', answer?.trim())

await page.screenshot({ path: '/tmp/xingce-markdown-flow.png', fullPage: true })
console.log('JS 错误:', errors.length ? errors.join(' | ') : '无')
await browser.close()

const ok = blocks >= 2 && !/复制必究|biguo368|共 39 页/.test(mdText)
  && mdText.includes('题干：') && mdText.includes('材料：')
  && afterSymbol.includes('①') && afterImage.includes('![材料图](data:image/png') && imageCount >= 1
  && items === 2 && firstStem?.includes('以下对应表述正确的有') && answer?.includes('B')
  && firstOptions.some((s) => s.includes('第二项'))
  && errors.length === 0
console.log(ok ? '\nE2E PASS' : '\nE2E FAIL')
process.exit(ok ? 0 : 1)
