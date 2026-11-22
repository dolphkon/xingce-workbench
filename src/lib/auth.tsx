import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { CLOUD_AVAILABLE, cloud } from './cloud'
import { restoreAuth, signInWithWechat, signOut as cloudSignOut, syncNow, SYNC_EVENT } from './sync'
import type { SyncUser } from './cloud'

interface AuthState {
  available: boolean
  user: SyncUser | null
  ready: boolean
  syncing: boolean
  lastResult: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  sync: (manual?: boolean) => Promise<void>
  subscribeApplied: (fn: () => void) => () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SyncUser | null>(null)
  const [ready, setReady] = useState(!CLOUD_AVAILABLE)
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const appliedListeners = useRef(new Set<() => void>())
  const syncingRef = useRef(false)

  const sync = useCallback(async (manual = false) => {
    if (!CLOUD_AVAILABLE || syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    try {
      const result = await syncNow()
      if (manual || !result.ok) setLastResult(result.message)
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    const onApplied = () => appliedListeners.current.forEach((fn) => fn())
    window.addEventListener(SYNC_EVENT, onApplied)
    return () => window.removeEventListener(SYNC_EVENT, onApplied)
  }, [])

  useEffect(() => {
    if (!CLOUD_AVAILABLE) return
    let active = true
    void restoreAuth().then(async (restored) => {
      if (!active) return
      setUser(restored)
      setReady(true)
      if (restored) {
        syncingRef.current = true
        setSyncing(true)
        try {
          const result = await syncNow()
          setLastResult(result.message)
        } finally {
          syncingRef.current = false
          setSyncing(false)
        }
      }
    })

    const off = cloud.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      const id = session?.user?.id ?? null
      setUser(id ? { id, name: session?.user?.name || '用户' } : null)
    })

    const timer = window.setInterval(() => {
      void cloud.auth.getSession().then(({ data }) => { if (data) void sync() })
    }, 30_000)

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void cloud.auth.getSession().then(({ data }) => { if (data) void sync() })
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      active = false
      off()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sync])

  const signIn = useCallback(async () => {
    const error = await signInWithWechat()
    if (error) setLastResult(error)
  }, [])

  const signOut = useCallback(async () => {
    await cloudSignOut()
    setUser(null)
    setLastResult('已退出登录')
  }, [])

  const subscribeApplied = useCallback((fn: () => void) => {
    appliedListeners.current.add(fn)
    return () => { appliedListeners.current.delete(fn) }
  }, [])

  return (
    <AuthContext.Provider value={{ available: CLOUD_AVAILABLE, user, ready, syncing, lastResult, signIn, signOut, sync, subscribeApplied }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
