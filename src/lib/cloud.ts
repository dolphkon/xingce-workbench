import type { WorkBuddyCloudClient } from '@tencent-ai/workbuddy-cloud-sdk'

/** 本站的云端配置来自 workbuddy_cloud_service 返回的 publicConfig（公开值，可随前端发布） */
const ENDPOINT = 'https://xingce-workbench-53921.app.workbuddy.host'
const OAUTH_RELAY = 'https://www.workbuddy.cn/v2/as/genie-baas/oauth'
const PUBLISHABLE_KEY = 'wbpk_jw6026ZNcqYFzU3nV4V2iA_cNgN30Q5QinX1jRs6QYmwi6mjLE2kcuA'

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

/**
 * 惰性加载云 SDK：SDK 体积较大，且只在 WorkBuddy 发布域名下使用。
 * GitHub Pages 等域名 CLOUD_AVAILABLE=false，首屏完全不会下载 SDK，显著加快加载。
 */
export function getCloud(): Promise<CloudClient> | null {
  if (!CLOUD_AVAILABLE) return null
  if (!cloudPromise) {
    cloudPromise = import('@tencent-ai/workbuddy-cloud-sdk')
      .then(({ createWorkBuddyCloud }) => createWorkBuddyCloud({
        endpoint: ENDPOINT,
        oauthRelayBaseUrl: OAUTH_RELAY,
        publishableKey: PUBLISHABLE_KEY,
      }))
      .catch((err) => {
        cloudPromise = null
        throw err
      })
  }
  return cloudPromise
}

export type SyncUser = { id: string; name: string }
