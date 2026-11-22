import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Icon } from './ui'

const navItems = [
  { to: '/', label: '总览', icon: 'home', end: true },
  { to: '/mistakes', label: '错题库', icon: 'target', end: false },
  { to: '/knowledge', label: '知识库', icon: 'book', end: false },
  { to: '/mothers', label: '母题库', icon: 'layers', end: false },
  { to: '/plans', label: '学习计划', icon: 'calendar', end: false },
]

function SyncPanel() {
  const { available, user, ready, syncing, lastResult, signIn, signOut, sync } = useAuth()

  if (!available) {
    return <p>数据保存在本机浏览器 · 定期备份更安心</p>
  }
  if (!ready) {
    return <p>正在检查登录状态…</p>
  }
  if (!user) {
    return (
      <div className="sync-panel">
        <button className="btn btn-primary btn-sm" onClick={() => void signIn()} style={{ width: '100%' }}>
          <Icon name="refresh" size={14} /> 微信扫码登录
        </button>
        {lastResult && <span className="sync-hint">{lastResult}</span>}
        <p className="sync-note">登录后可在本机和手机间自动同步全部数据</p>
      </div>
    )
  }
  return (
    <div className="sync-panel">
      <div className="sync-user">
        <span className="sync-avatar">{user.name.slice(0, 1)}</span>
        <span className="sync-user-name" title={user.name}>{user.name}</span>
        <button className="icon-btn" title="退出登录" onClick={() => void signOut()}><Icon name="back" size={14} /></button>
      </div>
      <button className="btn btn-sm" onClick={() => void sync(true)} disabled={syncing} style={{ width: '100%' }}>
        <Icon name="refresh" size={14} /> {syncing ? '同步中…' : '立即同步'}
      </button>
      {lastResult && <span className="sync-hint">{lastResult}</span>}
      <p className="sync-note">已开启云同步 · 另一台设备登录同一微信即可看到</p>
    </div>
  )
}

function TopbarSync() {
  const { available, user, syncing, signIn, sync } = useAuth()
  if (!available) return null
  return (
    <button
      className={`topbar-sync${user ? ' signed' : ''}`}
      onClick={() => { if (user) void sync(true); else void signIn() }}
      disabled={syncing}
      title={user ? '立即同步' : '微信登录以同步数据'}
    >
      <Icon name={syncing ? 'refresh' : user ? 'check' : 'sparkle'} size={14} />
      <span>{syncing ? '同步中' : user ? '已同步' : '登录同步'}</span>
    </button>
  )
}

export default function Layout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-mark">行</span>
          <span className="sidebar-logo-text">
            行测工作台
            <span className="logo-sub">XINGCE WORKBENCH</span>
          </span>
        </div>
        <nav className="nav">
          <div className="nav-label">工作区</div>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              title={item.label}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <SyncPanel />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="topbar-title">行测备考 · 一体化工作台</span>
          <div className="topbar-right">
            <TopbarSync />
            <Icon name="clock" size={14} />
            <span className="topbar-date">{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
