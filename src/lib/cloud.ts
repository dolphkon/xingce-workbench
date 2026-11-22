import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'

/** 本站的云端配置来自 workbuddy_cloud_service 返回的 publicConfig（公开值，可随前端发布） */
const ENDPOINT = 'https://xingce-workbench-53921.app.workbuddy.host'
const OAUTH_RELAY = 'https://www.workbuddy.cn/v2/as/genie-baas/oauth'
const PUBLISHABLE_KEY = 'wbpk_jw6026ZNcqYFzU3nV4V2iA_cNgN30Q5QinX1jRs6QYmwi6mjLE2kcuA'

export const cloud = createWorkBuddyCloud({
  endpoint: ENDPOINT,
  oauthRelayBaseUrl: OAUTH_RELAY,
  publishableKey: PUBLISHABLE_KEY,
})

/** 云同步只在绑定的发布域名可用；其它域名（如 GitHub Pages）退回本地模式 */
export const CLOUD_AVAILABLE = (() => {
  try {
    return new URL(ENDPOINT).host === window.location.host
  } catch {
    return false
  }
})()

export type SyncUser = { id: string; name: string }
