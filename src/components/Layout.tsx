import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useGitHubSync } from '../lib/useGitHubSync'
import { GITHUB_DEFAULTS, repoCreateUrl, tokenCreateUrl, type GitHubConfig } from '../lib/github'
import { Icon, Modal } from './ui'

const navItems = [
  { to: '/', label: '总览', icon: 'home', end: true },
  { to: '/mistakes', label: '错题库', icon: 'target', end: false },
  { to: '/knowledge', label: '知识库', icon: 'book', end: false },
  { to: '/mothers', label: '母题库', icon: 'layers', end: false },
  { to: '/plans', label: '学习计划', icon: 'calendar', end: false },
]

function defaultConfig(): GitHubConfig {
  return {
    owner: '',
    repo: GITHUB_DEFAULTS.repo,
    branch: GITHUB_DEFAULTS.branch,
    path: GITHUB_DEFAULTS.path,
    token: '',
  }
}

function GithubConfigModal({ initial, onClose, onSave, onConnect }: {
  initial: GitHubConfig
  onClose: () => void
  onSave: (config: GitHubConfig, mode: 'merge' | 'push') => Promise<{ ok: boolean; message: string }>
  onConnect: (token: string, mode: 'merge' | 'push') => Promise<{ ok: boolean; message: string }>
}) {
  const [token, setToken] = useState(initial.token)
  const [mode, setMode] = useState<'merge' | 'push'>('merge')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [form, setForm] = useState<GitHubConfig>({
    owner: initial.owner || '',
    repo: initial.repo || GITHUB_DEFAULTS.repo,
    branch: initial.branch || GITHUB_DEFAULTS.branch,
    path: initial.path || GITHUB_DEFAULTS.path,
    token: '',
  })

  const update = (key: keyof GitHubConfig, value: string) => setForm((prev) => ({ ...prev, [key]: value }))

  const submit = async () => {
    const clean = token.trim()
    if (!clean) {
      setError('请先粘贴访问令牌（第 2 步生成的 github_pat_...）')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = advanced
        ? await onSave({ ...form, token: clean }, mode)
        : await onConnect(clean, mode)
      if (result.ok) onClose()
      else setError(result.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="连接 GitHub 数据存储"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            <Icon name="github" size={15} /> {busy ? '连接中…' : '连接并同步'}
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        只需 3 步，之后手机和电脑粘贴同一个令牌即可看到同一份数据。数据存在<strong>私有仓库</strong>的独立 <code>data</code> 分支，不公开、不触发网站重新部署。
      </p>

      <div className="connect-step">
        <div className="connect-step-head"><span className="connect-step-no">1</span><strong>创建私有数据仓库</strong></div>
        <p className="small muted">点开后仓库名与「Private」已自动填好，点底部绿色 <b>Create repository</b> 即可（已有仓库可跳过）。</p>
        <a className="btn btn-sm" href={repoCreateUrl()} target="_blank" rel="noopener noreferrer">
          <Icon name="github" size={14} /> 打开 GitHub 创建私有仓库
        </a>
        <p className="small muted" style={{ marginBottom: 0 }}>仓库名：<code>{GITHUB_DEFAULTS.repo}</code></p>
      </div>

      <div className="connect-step">
        <div className="connect-step-head"><span className="connect-step-no">2</span><strong>创建访问令牌</strong></div>
        <p className="small muted">点开后名称、有效期、权限都已预填（仅 Contents 读写）。确认 <b>Repository access</b> 选中刚建的仓库，点 <b>Generate token</b> 后复制。</p>
        <a className="btn btn-sm" href={tokenCreateUrl()} target="_blank" rel="noopener noreferrer">
          <Icon name="github" size={14} /> 打开 GitHub 创建令牌
        </a>
      </div>

      <div className="connect-step">
        <div className="connect-step-head"><span className="connect-step-no">3</span><strong>粘贴令牌并连接</strong></div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="input"
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_..."
            style={{ flex: 1 }}
          />
          <button className="btn btn-sm" onClick={() => setShowToken((v) => !v)}>{showToken ? '隐藏' : '显示'}</button>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>用户名、仓库、分支会自动识别，无需填写。</p>
      </div>

      <div className="form-field">
        <label className="form-label">首次连接的数据处理</label>
        <div className="segmented">
          <button className={mode === 'merge' ? 'active' : ''} onClick={() => setMode('merge')}>智能合并（推荐）</button>
          <button className={mode === 'push' ? 'active' : ''} onClick={() => setMode('push')}>用本机数据覆盖云端</button>
        </div>
      </div>

      <button className="link-btn" onClick={() => setAdvanced((v) => !v)}>{advanced ? '收起高级设置' : '高级设置（自定义仓库/分支）'}</button>
      {advanced && (
        <div style={{ marginTop: 8 }}>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">仓库所有者</label>
              <input className="input" value={form.owner} onChange={(e) => update('owner', e.target.value)} placeholder="自动识别，可留空" />
            </div>
            <div className="form-field">
              <label className="form-label">仓库名</label>
              <input className="input" value={form.repo} onChange={(e) => update('repo', e.target.value)} placeholder={GITHUB_DEFAULTS.repo} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">分支</label>
              <input className="input" value={form.branch} onChange={(e) => update('branch', e.target.value)} placeholder={GITHUB_DEFAULTS.branch} />
            </div>
            <div className="form-field">
              <label className="form-label">数据文件路径</label>
              <input className="input" value={form.path} onChange={(e) => update('path', e.target.value)} placeholder={GITHUB_DEFAULTS.path} />
            </div>
          </div>
        </div>
      )}

      <div className="notice" style={{ fontSize: 12, lineHeight: 1.7 }}>
        <strong>安全可靠：</strong>令牌只保存在本机浏览器、不会写进代码，且仅申请 Contents 单一权限；只连接<strong>私有仓库</strong>，公开仓库会被拒绝。请勿在公用设备上使用。
      </div>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  )
}

function GithubSyncPanel() {
  const { configured, config, syncing, lastResult, sync, pushAll, pullAll, disconnect, openConfig } = useGitHubSync()
  const [confirmPull, setConfirmPull] = useState(false)

  return (
    <div className="sync-panel">
      <div className="sync-user">
        <span className="sync-avatar" style={{ background: '#24292f' }}><Icon name="github" size={15} /></span>
        <span className="sync-user-name" title={config ? `${config.owner}/${config.repo}` : 'GitHub 存储'}>
          {configured ? `${config!.repo}` : 'GitHub 存储'}
        </span>
        <button className="icon-btn" title="设置" onClick={openConfig}><Icon name="edit" size={14} /></button>
      </div>
      {configured ? (
        <>
          <button className="btn btn-sm" onClick={() => void sync(true)} disabled={syncing} style={{ width: '100%' }}>
            <Icon name="refresh" size={14} /> {syncing ? '同步中…' : '立即同步'}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" onClick={() => void pushAll()} disabled={syncing} style={{ flex: 1 }} title="用本机数据覆盖云端">
              <Icon name="upload" size={13} /> 上传
            </button>
            <button className="btn btn-sm" onClick={() => setConfirmPull(true)} disabled={syncing} style={{ flex: 1 }} title="用云端数据覆盖本机">
              <Icon name="download" size={13} /> 恢复
            </button>
          </div>
          {lastResult && <span className="sync-hint">{lastResult}</span>}
          <p className="sync-note">数据保存在 GitHub · 另一台设备连接同一仓库即可同步</p>
          <button className="btn btn-sm" onClick={disconnect} style={{ width: '100%' }}>断开连接</button>
        </>
      ) : (
        <>
          <button className="btn btn-sm" onClick={openConfig} style={{ width: '100%' }}>
            <Icon name="github" size={14} /> 连接 GitHub 同步
          </button>
          <p className="sync-note">跨设备访问数据（含 GitHub Pages 站点）</p>
        </>
      )}
      {confirmPull && (
        <Modal
          title="确认恢复数据"
          onClose={() => setConfirmPull(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmPull(false)}>取消</button>
              <button className="btn btn-danger" onClick={() => { setConfirmPull(false); void pullAll() }}>确认恢复</button>
            </>
          }
        >
          <p className="small">将用 GitHub 云端数据覆盖本机全部数据，本机原有的改动会丢失。确定继续吗？</p>
        </Modal>
      )}
    </div>
  )
}

function WorkbuddySyncPanel() {
  const { available, user, ready, syncing, lastResult, signIn, signOut, sync } = useAuth()
  if (!available) return null
  if (!ready) return <p>正在检查登录状态…</p>
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
      <p className="sync-note">微信云同步已开启</p>
    </div>
  )
}

function TopbarSync() {
  const { configured, syncing, sync, openConfig } = useGitHubSync()
  // GitHub 存储优先：所有域名可用，未配置时也提供入口（移动端侧栏隐藏时的唯一入口）
  if (configured) {
    return (
      <button
        className="topbar-sync signed"
        onClick={() => void sync(true)}
        disabled={syncing}
        title="立即同步到 GitHub"
      >
        <Icon name={syncing ? 'refresh' : 'github'} size={14} />
        <span>{syncing ? '同步中' : 'GitHub 已同步'}</span>
      </button>
    )
  }
  return (
    <button
      className="topbar-sync"
      onClick={openConfig}
      title="连接 GitHub 以跨设备同步数据"
    >
      <Icon name="github" size={14} />
      <span>连接 GitHub</span>
    </button>
  )
}

function GlobalGithubConfigModal() {
  const { config, configOpen, closeConfig, saveConfig, connect } = useGitHubSync()
  if (!configOpen) return null
  return (
    <GithubConfigModal
      initial={config ?? defaultConfig()}
      onClose={closeConfig}
      onSave={saveConfig}
      onConnect={connect}
    />
  )
}

export default function Layout() {
  return (
    <div className="app-shell">
      <GlobalGithubConfigModal />
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
          <GithubSyncPanel />
          <WorkbuddySyncPanel />
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
        <main className="page"><Outlet /></main>
      </div>
    </div>
  )
}
