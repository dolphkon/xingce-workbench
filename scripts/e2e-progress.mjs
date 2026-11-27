import { chromium } from 'playwright-core'
import JSZip from 'jszip'
import fs from 'node:fs'

const BASE = 'http://localhost:5183/'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// 构造一个含文本的 docx（zip 包）
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
const body = [
  q('1. 下列不属于普通话声母的是（  ）。'),
  q('A. b    B. p    C. r    D. ing'),
  q('2. 依次填入下列各句横线处的词语，最恰当的一组是（  ）。'),
  q('A. 必须 必需    B. 必需 必须    C. 必须 必须    D. 必需 必需'),
  q('3. 下列成语使用正确的是（  ）。'),
  q('A. 炙手可热    B. 首当其冲    C. 差强人意    D. 万人空巷'),
].join('')
zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
const buf = await zip.generateAsync({ type: 'nodebuffer' })
fs.writeFileSync('/tmp/e2e-test.docx', buf)

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(BASE + '#/online-practice')
await page.waitForSelector('.online-practice-page')

// 上传文件
const input = page.locator('input[type=file]').first()
await input.setInputFiles('/tmp/e2e-test.docx')

// 等待环形进度出现并截图
let progressSeen = false
let snapshot = null
for (let i = 0; i < 40; i++) {
  if (await page.locator('.cp-wrap').count() > 0) {
    progressSeen = true
    snapshot = await page.locator('.cp-wrap').evaluate((el) => ({
      percent: el.querySelector('.cp-percent')?.textContent,
      stage: el.querySelector('.cp-stage-label')?.textContent,
      message: el.querySelector('.cp-message')?.textContent,
      time: el.querySelector('.cp-time')?.textContent,
      steps: Array.from(el.querySelectorAll('.cp-step')).map((s) => ({ text: s.textContent, cls: s.className })),
      spinAnim: el.querySelector('.cp-spin') ? getComputedStyle(el.querySelector('.cp-spin')).animationName : null,
    }))
    await page.screenshot({ path: '/tmp/xingce-progress.png' })
    break
  }
  await page.waitForTimeout(120)
}
// 等待解析完成
await page.waitForSelector('.op-review', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(400)
const afterDone = {
  reviewVisible: await page.locator('.op-review').count() > 0,
  questionCount: await page.locator('.op-review-item').count(),
  progressGone: await page.locator('.cp-wrap').count() === 0,
}
console.log(JSON.stringify({ progressSeen, snapshot, afterDone, errors }, null, 2))
await browser.close()
