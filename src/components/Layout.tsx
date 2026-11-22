import { NavLink, Outlet } from 'react-router-dom'
import { Icon } from './ui'

const navItems = [
  { to: '/', label: '总览', icon: 'home', end: true },
  { to: '/mistakes', label: '错题库', icon: 'target', end: false },
  { to: '/knowledge', label: '知识库', icon: 'book', end: false },
  { to: '/mothers', label: '母题库', icon: 'layers', end: false },
]

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
          <p>数据保存在本机浏览器 · 记得定期备份</p>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="topbar-title">行测备考 · 一体化工作台</span>
          <div className="topbar-right">
            <Icon name="clock" size={14} />
            <span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
