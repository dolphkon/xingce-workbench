// 统一 E2E 入口：自动启动/关闭 Vite，依次运行全部浏览器用例，任一失败即整体失败。
// 用法：npm run test:e2e；可用 E2E_PORT / CHROME_PATH 覆盖端口与浏览器路径。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.E2E_PORT) || 5173
const BASE = `http://localhost:${PORT}/`
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SCRIPTS = [
  'e2e-workbench.mjs',
  'e2e-progress.mjs',
  'e2e-split-quality.mjs',
  'e2e-markdown-flow.mjs',
  'e2e-exam-template.mjs',
]

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // 服务尚未就绪，继续等待
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Vite 未在 ${timeoutMs}ms 内就绪：${url}`)
}

function runScript(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', name)], {
      cwd: ROOT,
      env: { ...process.env, E2E_BASE: BASE, CHROME_PATH: CHROME },
      stdio: 'inherit',
    })
    child.on('error', () => resolve(1))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

const server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout?.on('data', (chunk) => { serverLog += String(chunk) })
server.stderr?.on('data', (chunk) => { serverLog += String(chunk) })

let stopped = false
const stopServer = () => {
  if (stopped || server.exitCode !== null) return
  stopped = true
  server.kill('SIGTERM')
}
process.on('exit', stopServer)
process.on('SIGINT', () => { stopServer(); process.exit(130) })

try {
  await waitForServer(BASE)
  console.log(`E2E 服务就绪：${BASE}`)
} catch (err) {
  console.error(String(err))
  console.error(serverLog.slice(-2000))
  stopServer()
  process.exit(1)
}

const failed = []
for (const name of SCRIPTS) {
  console.log(`\n===== E2E: ${name} =====`)
  const code = await runScript(name)
  if (code !== 0) failed.push(name)
}
stopServer()

if (failed.length) {
  console.error(`\nE2E FAIL（${failed.length}/${SCRIPTS.length}）：${failed.join(', ')}`)
  process.exit(1)
}
console.log(`\nE2E PASS（${SCRIPTS.length}/${SCRIPTS.length}）`)
process.exit(0)
