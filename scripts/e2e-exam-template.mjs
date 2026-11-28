import { chromium } from 'playwright-core'
import JSZip from 'jszip'
import fs from 'node:fs'

const BASE = 'http://localhost:5173/'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

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
await page.goto(BASE + '#/online-practice')
await page.waitForSelector('.online-practice-page')

await page.locator('input[type=file]').first().setInputFiles('/tmp/e2e-exam-template.docx')
await page.waitForSelector('.md-review', { timeout: 40000 })
console.log('① 中间稿生成:', (await page.locator('.md-review-head p').textContent())?.trim())

// 用固定模板替换中间稿，验证套卷编辑器行为
await page.getByRole('button', { name: '全文视图' }).click()
await page.locator('.md-review-editor').fill(TEMPLATE)
await page.getByRole('button', { name: '返回分页视图' }).click()
await page.locator('.mdt-page-tab').first().waitFor()

const tabs = await page.locator('.mdt-page-tab').count()
console.log('② 按页目录:', tabs, '页 ·', await page.locator('.mdt-section-title').allTextContents())
const previewQs = await page.locator('.mdt-paper-q').count()
console.log('② 当前页卷面预览:', previewQs, '题')
await page.screenshot({ path: '/tmp/xingce-exam-template-page.png', fullPage: true })

// 切到第 2 页并编辑
await page.locator('.mdt-page-tab', { hasText: '第 2 页' }).click()
await page.locator('.mdt-loading').waitFor({ state: 'hidden' }).catch(() => {})
const page2Before = await page.locator('.mdt-page-editor').inputValue()
console.log('③ 第 2 页正文:', page2Before.includes('第二页的题目') ? '加载正确' : '加载错误')
const editedPage2 = page2Before.replace('第二页的题目：', '人工修正后的第二页题目：')
await page.locator('.mdt-page-editor').fill(editedPage2)
await page.getByRole('button', { name: '全文视图' }).click()
const full = await page.locator('.md-review-editor').inputValue()
console.log('③ 分页回写:', full.includes('人工修正后的第二页题目') && full.includes('第一题设问') && full.includes('计算题') ? '仅目标页变更' : '回写异常')
await page.screenshot({ path: '/tmp/xingce-exam-template.png', fullPage: true })

// 自动排版后结构仍完整
await page.getByRole('button', { name: '自动排版' }).click()
await page.getByRole('button', { name: '返回分页视图' }).click()
const tabsAfter = await page.locator('.mdt-page-tab').count()
console.log('④ 自动排版后页数:', tabsAfter)

// 阶段②：按模板解析成套卷
await page.getByRole('button', { name: /解析为 \d+ 道题/ }).click()
await page.waitForSelector('.op-review', { timeout: 40000 })
const items = await page.locator('.op-review-item').count()
console.log('⑤ 解析题目数:', items)

// 组卷并检查题目携带部分/页
await page.getByRole('button', { name: '确认组卷' }).click()
await page.locator('.op-confirm-summary').waitFor()
await page.getByRole('button', { name: '确认组卷' }).last().click()
await page.locator('.pw-question').first().waitFor({ timeout: 10000 })
const chips = await page.locator('.pw-question .chip').allTextContents()
console.log('⑥ 试卷题目标签:', chips.slice(0, 6).join(' | '))

console.log('JS 错误:', errors.length ? errors.join(' | ') : '无')
await browser.close()

const ok = tabs === 3 && previewQs === 2 && page2Before.includes('第二页的题目')
  && full.includes('人工修正后的第二页题目') && full.includes('计算题')
  && tabsAfter === 3 && items === 4
  && chips.some((s) => s.includes('第 1 页')) && chips.some((s) => s.includes('第二部分'))
  && errors.length === 0
console.log(ok ? '\nE2E PASS' : '\nE2E FAIL')
process.exit(ok ? 0 : 1)
