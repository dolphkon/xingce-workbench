import { chromium } from 'playwright-core'
import JSZip from 'jszip'
import fs from 'node:fs'

const BASE = process.env.E2E_BASE || 'http://localhost:5173/'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const LINES = [
  '1. 甲题：A.甲 B.乙 C.丙 D.丁 答案：A',
  '2. 乙题：A.甲 B.乙 C.丙 D.丁 答案：B',
  '3. 丙题：A.甲 B.乙 C.丙 D.丁 答案：C',
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
fs.writeFileSync('/tmp/e2e-exam-template.docx', await zip.generateAsync({ type: 'nodebuffer' }))

const TEMPLATE = `# E2E套卷

## 第一部分 言语理解与表达
### 第 1 页
#### 第 1 题
题型：单选题
模块：言语理解
材料：
题干：第一题设问：

A. 甲
B. 乙
C. 丙
D. 丁
答案：A

#### 第 2 题
题型：单选题
模块：言语理解
材料：
题干：第二题设问：

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

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(BASE + '#/question-bank')
await page.getByRole('button', { name: '文档转在线刷题' }).click()
await page.waitForSelector('.document-to-paper-page')

await page.locator('input[type=file]').first().setInputFiles('/tmp/e2e-exam-template.docx')
await page.waitForSelector('.te-page', { timeout: 40000 })
console.log('① 结构化模版:', (await page.locator('.te-head p').textContent())?.trim())

// 固定模板通过文本视图导入，验证结构化题槽与按页目录
await page.getByRole('button', { name: '文本视图' }).click()
await page.locator('.te-textarea').fill(TEMPLATE)
await page.getByRole('button', { name: '应用文本' }).click()
await page.locator('.te-page-tab').first().waitFor()
const tabs = await page.locator('.te-page-tab').count()
const previewQs = await page.locator('.te-preview-question').count()
const headerText = await page.locator('.te-head p').textContent()
const totalCards = Number(headerText?.match(/(\d+) 题/)?.[1] ?? 0)
console.log('② 按页目录:', tabs, '页 · 当前页', previewQs, '题 · 总题槽', totalCards)
await page.screenshot({ path: '/tmp/xingce-exam-template-page.png', fullPage: true })

// 切到第 2 页并逐字段编辑
await page.locator('.te-page-tab', { hasText: '第 2 页' }).click()
await page.waitForTimeout(150)
console.log('③ 选中页签:', await page.locator('.te-page-tab.active').allTextContents())
const stemField = page.locator('.te-question-card').first().locator('textarea').nth(1)
const page2Before = await stemField.inputValue()
console.log('③ 当前卡片题干:', page2Before)
await stemField.fill('人工修正后的第二页题目：')
const previewText = await page.locator('.te-preview-stem').first().textContent()
console.log('③ 字段编辑即时预览:', previewText?.includes('人工修正后的第二页题目'))
await page.screenshot({ path: '/tmp/xingce-exam-template.png', fullPage: true })

// 修改模块后目录自动重新分组
await page.locator('.te-question-card').first().locator('.te-select').selectOption('数量关系')
const sectionNames = await page.locator('.te-section-name').allTextContents()
const page2Preview = await page.locator('.te-preview-question').count()
console.log('④ 模块归属变更后部分:', sectionNames.join(' | '), '· 第2页预览', page2Preview, '题')

// 结构化题槽直接生成套卷
await page.getByRole('button', { name: '生成套卷' }).click()
await page.waitForSelector('.paper-review-page', { timeout: 20000 })
const items = await page.locator('.paper-q-card').count()
console.log('⑤ 套卷题目数:', items)

// 人工推送到在线刷题，并检查题目携带部分/页
await page.getByRole('button', { name: '推送到在线刷题' }).click()
await page.locator('.op-confirm-summary').waitFor()
await page.getByRole('button', { name: '确认推送' }).last().click()
await page.waitForSelector('.online-practice-page', { timeout: 10000 })
const chips = await page.locator('.paper-q-card .chip').allTextContents()
console.log('⑥ 试卷题目标签:', chips.slice(0, 6).join(' | '))

console.log('JS 错误:', errors.length ? errors.join(' | ') : '无')
await browser.close()

const ok = tabs === 3 && previewQs === 2 && totalCards === 4 && page2Before.includes('第二页的题目')
  && (previewText ?? '').includes('人工修正后的第二页题目') && page2Preview === 1
  && sectionNames.includes('数量关系') && items === 4
  && chips.some((s) => s.includes('第 1 页')) && chips.some((s) => s.includes('数量关系'))
  && errors.length === 0
console.log(ok ? '\nE2E PASS' : '\nE2E FAIL')
process.exit(ok ? 0 : 1)
