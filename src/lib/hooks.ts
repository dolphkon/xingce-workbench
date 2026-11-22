import { useCallback, useEffect, useState } from 'react'
import { listAll, readCachedAll, type EntityMap, type StoreName } from './db'

/**
 * 集合读取：首帧直接用本地缓存渲染，IndexedDB 在后台刷新。
 * 因此切换页面不再出现「加载中」，保存后调用 refresh() 也会立即更新列表。
 */
export function useCollection<K extends StoreName>(store: K) {
  const [items, setItems] = useState<EntityMap[K][]>(() => readCachedAll(store))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => {
    setItems(readCachedAll(store)) // 同步生效，不等数据库
    setTick((value) => value + 1)
  }, [store])

  useEffect(() => {
    let active = true
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
