import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog, Icon } from '../../components/ui'
import { clearAll, exportAll, importAll } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { clearPlans, loadPlans, readCachedPlans, savePlans } from '../../lib/plans'
import { SYNC_EVENT } from '../../lib/sync'
import { useAuth } from '../../lib/auth'
import { pluralDays } from '../../lib/utils'
import type { BackupData, StudyPlan } from '../../types'

export default function Dashboard() {
  const mistakes = useCollection('mistakes')
  const docs = useCollection('docs')
  const mothers = useCollection('mothers')
  const [plans, setPlans] = useState<StudyPlan[]>(() => readCachedPlans())
  const fileRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const { sync } = useAuth()

  useEffect(() => { void loadPlans().then(setPlans) }, [])

  useEffect(() => {
    const onApplied = () => setPlans(readCachedPlans())
    window.addEventListener(SYNC_EVENT, onApplied)
    return () => window.removeEventListener(SYNC_EVENT, onApplied)
  }, [])

  const recent = [...mistakes.items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5)
  const weekCount = mistakes.items.filter((item) => Date.now() - item.createdAt < 7 * 86_400_000).length

  const refreshAll = () => {
    mistakes.refresh()
    docs.refresh()
    mothers.refresh()
    void loadPlans().then(setPlans)
  }

  const handleExport = async () => {
    try {
      const data = await exportAll()
      data.plans = await loadPlans()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `行测工作台备份-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setNotice('备份文件已下载')
    } catch (err) {
      setNotice(`导出失败：${err instanceof Error ? err.message : '未知错误'}`)
    }
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as BackupData
      await importAll(parsed)
      if (Array.isArray(parsed.plans)) await savePlans(parsed.plans)
      refreshAll()
      void sync(true)
      setNotice(`导入成功：错题 ${parsed.mistakes?.length ?? 0} / 文档 ${parsed.docs?.length ?? 0} / 母题 ${parsed.mothers?.length ?? 0} / 计划 ${parsed.plans?.length ?? 0}`)
    } catch (err) {
      setNotice(`导入失败：${err instanceof Error ? err.message : '文件格式不正确'}`)
    }
    event.target.value = ''
  }

  const handleClear = async () => {
    await clearAll()
    await clearPlans()
    setConfirmClear(false)
    refreshAll()
    void sync(true)
    setNotice('所有数据已清空')
  }

  const stats = [
    { label: '错题总数', value: mistakes.items.length, icon: 'target', bg: '#eef2ff', color: '#4f46e5' },
    { label: '近 7 天新增', value: weekCount, icon: 'bolt', bg: '#fef3c7', color: '#d97706' },
    { label: '知识文档', value: docs.items.length, icon: 'book', bg: '#dcfce7', color: '#16a34a' },
    { label: '母题条目', value: mothers.items.length, icon: 'layers', bg: '#e0f2fe', color: '#0284c7' },
    { label: '学习计划', value: plans.length, icon: 'calendar', bg: '#fef3c7', color: '#d97706' },
  ]

  const modules = [
    {
      to: '/mistakes',
      title: '错题库',
      desc: '图片 OCR 或手动录入错题，按时间与题型进行专项刷题',
      icon: 'target',
      bg: '#eef2ff',
      color: '#4f46e5',
    },
    {
      to: '/knowledge',
      title: '知识库',
      desc: '用 Markdown 书写知识点，分类归档并支持全文检索',
      icon: 'book',
      bg: '#dcfce7',
      color: '#16a34a',
    },
    {
      to: '/mothers',
      title: '母题库',
      desc: '沉淀高频母题与解题模型，与错题建立关联',
      icon: 'layers',
      bg: '#e0f2fe',
      color: '#0284c7',
    },
    {
      to: '/plans',
      title: '学习计划',
      desc: '按言语、判断、资料等模块规划任务，专注与刷题计时统计',
      icon: 'calendar',
      bg: '#fef3c7',
      color: '#d97706',
    },
  ]

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">工作台总览</h1>
          <p className="page-subtitle">集中管理错题、知识与母题，让每一次练习都有迹可循</p>
        </div>
        <div className="header-actions">
          <Link className="btn btn-primary" to="/mistakes/practice">
            <Icon name="play" size={16} /> 开始专项刷题
          </Link>
        </div>
      </div>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)} style={{ cursor: 'pointer' }}>
          {notice} · 点击关闭
        </div>
      )}

      <div className="stats-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <span className="stat-icon" style={{ background: stat.bg, color: stat.color }}>
              <Icon name={stat.icon} size={21} />
            </span>
            <div>
              <div className="stat-value">{stat.value}</div>
              <div className="stat-label">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="module-grid">
        {modules.map((module) => (
          <Link className="module-card" to={module.to} key={module.title}>
            <span className="module-icon" style={{ background: module.bg, color: module.color }}>
              <Icon name={module.icon} size={20} />
            </span>
            <h3>{module.title}</h3>
            <p>{module.desc}</p>
            <span className="module-link">
              进入模块 <Icon name="chevron" size={14} />
            </span>
          </Link>
        ))}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h2 className="card-title">最近录入的错题</h2>
          <Link to="/mistakes" className="small" style={{ color: 'var(--primary)', fontWeight: 600 }}>
            查看全部 →
          </Link>
        </div>
        <div className="card-body tight">
          {recent.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-icon"><Icon name="target" size={22} /></div>
              <h3>还没有错题</h3>
              <p>从错题库上传图片或手动录入第一道题吧</p>
              <Link className="btn btn-primary btn-sm" to="/mistakes">
                <Icon name="plus" size={14} /> 录入错题
              </Link>
            </div>
          ) : (
            <div className="list">
              {recent.map((item) => (
                <Link className="list-item" to={`/mistakes/${item.id}`} key={item.id}>
                  <div className="list-item-main">
                    <div className="item-title">{item.title}</div>
                    <div className="item-meta">
                      <span className="chip chip-primary">{item.type}</span>
                      <span className="small light">{pluralDays(item.createdAt)}</span>
                      {item.tags.slice(0, 2).map((tag) => <span className="chip" key={tag}>#{tag}</span>)}
                    </div>
                  </div>
                  <Icon name="chevron" size={16} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">数据管理</h2>
          <span className="small muted">数据仅存于本机浏览器，请勿清理站点数据</span>
        </div>
        <div className="card-body">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={handleExport}>
              <Icon name="download" size={16} /> 导出备份
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={16} /> 导入备份
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImport}
              style={{ display: 'none' }}
            />
            <span className="spacer" />
            <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setConfirmClear(true)}>
              <Icon name="trash" size={16} /> 清空全部数据
            </button>
          </div>
        </div>
      </div>

      {confirmClear && (
        <ConfirmDialog
          message="将永久删除所有错题、知识文档、母题和学习计划，此操作不可撤销。建议先导出备份。"
          onCancel={() => setConfirmClear(false)}
          onConfirm={handleClear}
        />
      )}
    </>
  )
}
