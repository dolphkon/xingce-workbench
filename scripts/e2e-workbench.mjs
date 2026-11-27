import { chromium } from 'playwright-core'

const BASE = 'http://localhost:5183/'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const papers = [
  {
    id: 'paper-e2e-1', title: '国考组卷1', fileName: '国考真题.pdf', fileType: 'application/pdf',
    questionCount: 2, parseMethod: '大模型智能拆题',
    createdAt: Date.now() - 5000, updatedAt: Date.now() - 5000,
    questions: [
      { id: 'q-e2e-1', title: '【题目】翻开古代农书，依次填入画横线部分最恰当的一项是：', options: ['一脉相承 科学', '如一辙 固定', '别无二致 完整', '不谋而合 复杂'], answer: 'A', analysis: '解析示例', type: '言语理解' },
      { id: 'q-e2e-2', title: '【题目】下列哪一项不属于行政法的基本原则？', options: ['合法行政', '合理行政', '等价有偿', '程序正当'], answer: 'C', analysis: '', type: '常识判断' },
    ],
  },
  {
    id: 'paper-e2e-2', title: '联考组卷1', fileName: '联考真题.pdf', fileType: 'application/pdf',
    questionCount: 1, parseMethod: '规则拆题',
    createdAt: Date.now() - 3000, updatedAt: Date.now() - 3000,
    questions: [
      { id: 'q-e2e-3', title: '【题目】1+1 等于几？', options: ['1', '2', '3', '4'], answer: 'B', analysis: '', type: '数量关系' },
    ],
  },
]

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(BASE)
// 注入试卷到 localStorage 缓存 + IndexedDB
await page.evaluate((docs) => {
  localStorage.setItem('xingce-cache-v1-papers', JSON.stringify(docs))
}, papers)
await page.evaluate((docs) => {
  return new Promise((resolve) => {
    const req = indexedDB.open('xingce-workbench', 6)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('papers', 'readwrite')
      const store = tx.objectStore('papers')
      docs.forEach((d) => store.put(d))
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
    }
  })
}, papers)

// 进入在线刷题页
await page.goto(BASE + '#/online-practice')
await page.waitForSelector('.pw-workbench', { timeout: 8000 })
const results = {}
results.paperItems = await page.locator('.pw-paper-item').count()
results.detailTitle = await page.locator('.pw-detail-title').first().textContent()
results.questionsShown = await page.locator('.pw-question').count()
results.categoryChips = await page.locator('.pw-question .stem-category').count()

// 切换试卷
await page.locator('.pw-paper-item', { hasText: '联考组卷1' }).click()
await page.waitForTimeout(300)
results.switchedTitle = await page.locator('.pw-detail-title').first().textContent()
results.switchedQuestions = await page.locator('.pw-question').count()

// 收藏
await page.locator('.pw-question-head .icon-btn').first().click()
await page.waitForTimeout(200)
results.favorited = await page.locator('.pw-question.favorited').count()

// 编辑题目 -> 弹窗保存
await page.locator('.pw-question-head .icon-btn[title="校对编辑"]').first().click()
await page.waitForSelector('.modal')
await page.locator('.modal textarea').first().fill('【题目】编辑后的题干是否正确？')
await page.getByRole('button', { name: /确认无误并保存/ }).click()
await page.waitForTimeout(300)
results.editedStem = await page.locator('.pw-q-stem').first().textContent()

// 添加题目
await page.locator('.pw-add-question').click()
await page.waitForSelector('.modal')
await page.locator('.modal textarea').first().fill('【题目】新增的题目内容？')
await page.getByRole('button', { name: /确认无误并保存/ }).click()
await page.waitForTimeout(300)
results.afterAddQuestions = await page.locator('.pw-question').count()

// 截图
await page.screenshot({ path: '/tmp/xingce-workbench.png', fullPage: true })

console.log(JSON.stringify({ results, errors }, null, 2))
await browser.close()
