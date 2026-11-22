import { useCallback, useEffect, useState } from 'react'
import { listAll, type EntityMap, type StoreName } from './db'

/** 读取集合；调用 refresh() 重新从 IndexedDB 加载 */
export function useCollection<K extends StoreName>(store: K) {
  const [items, setItems] = useState<EntityMap[K][]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    listAll(store)
      .then((data) => {
        if (active) {
          setItems(data)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : '数据加载失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [store, tick])

  return { items, loading, error, refresh }
}
