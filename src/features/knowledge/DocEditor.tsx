/**
 * 兼容旧链接：知识库已改为单页工作台，这里只把旧的文档路由重定向过去。
 * /knowledge/:id?read=1  ->  /knowledge?doc=:id&read=1
 * /knowledge/new?folder=x ->  /knowledge?new=x
 */
import { useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

export default function DocEditor() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const query = params.toString()

  useEffect(() => {
    if (!id) { navigate('/knowledge', { replace: true }); return }
    if (id === 'new') {
      const folder = params.get('folder')
      navigate(`/knowledge${folder ? `?new=${encodeURIComponent(folder)}` : ''}`, { replace: true })
      return
    }
    const next = new URLSearchParams()
    next.set('doc', id)
    if (params.get('read') === '1') next.set('read', '1')
    navigate(`/knowledge?${next.toString()}`, { replace: true })
    // query 已覆盖全部用到的参数
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, query, navigate])

  return <div className="loading">正在打开文档…</div>
}
