import type { WorkBuddyCloudClient } from '@tencent-ai/workbuddy-cloud-sdk'

/** 本站的云端配置来自 workbuddy_cloud_service 返回的 publicConfig（公开值，可随前端发布） */
const ENDPOINT = 'https://xingce-workbench-ai.app.workbuddy.host'
const OAUTH_RELAY = 'https://www.workbuddy.cn/v2/as/genie-baas/oauth'
const PUBLISHABLE_KEY = 'wbpk_6G3nteaUKurmlxHnjcgVk3_BV5PE2vtrQdfg0w8QGMoc8pGU0tkMwCX'

/** 云同步只在绑定的发布域名可用；其它域名（如 GitHub Pages）退回本地模式 */
export const CLOUD_AVAILABLE = (() => {
  try {
    return new URL(ENDPOINT).host === window.location.host
  } catch {
    return false
  }
})()

type CloudClient = WorkBuddyCloudClient
let cloudPromise: Promise<CloudClient> | null = null
let llmCloudPromise: Promise<CloudClient> | null = null

function createClient(): Promise<CloudClient> {
  return import('@tencent-ai/workbuddy-cloud-sdk')
    .then(({ createWorkBuddyCloud }) => createWorkBuddyCloud({
      endpoint: ENDPOINT,
      oauthRelayBaseUrl: OAUTH_RELAY,
      publishableKey: PUBLISHABLE_KEY,
    }))
}

/**
 * 同步用客户端：只在 WorkBuddy 发布域名加载。
 * GitHub Pages 等域名 CLOUD_AVAILABLE=false，首屏完全不会下载 SDK，显著加快加载。
 */
export function getCloud(): Promise<CloudClient> | null {
  if (!CLOUD_AVAILABLE) return null
  if (!cloudPromise) {
    cloudPromise = createClient().catch((err) => { cloudPromise = null; throw err })
  }
  return cloudPromise
}

/**
 * LLM 专用客户端：不受域名硬限制，按需惰性加载。
 * 服务端会校验 Origin 与 AI 能力开关，是否可用以实际调用结果为准（见 llm.ts 的探测）。
 * 仅在用户主动触发文档解析时调用，不影响首屏加载。
 */
export function getCloudForLlm(): Promise<CloudClient> {
  if (!llmCloudPromise) {
    llmCloudPromise = createClient().catch((err) => { llmCloudPromise = null; throw err })
  }
  return llmCloudPromise
}

export type SyncUser = { id: string; name: string }
