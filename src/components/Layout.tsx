import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useGitHubSync } from '../lib/useGitHubSync'
import { FONT_CHANGE_EVENT, FONT_SIZES, cycleFontSize, initFontSize } from '../lib/fontSize'
import { GITHUB_DEFAULTS, tokenCreateUrl, type GitHubConfig } from '../lib/github'
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
  const [showHelp, setShowHelp] = useState(false)
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
      setError('请先粘贴访问令牌（github_pat_...）')
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
          <button className="btn btn-github" onClick={() => void submit()} disabled={busy}>
            <Icon name="github" size={15} /> {busy ? '连接中…' : '连接并同步'}
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        粘贴一个令牌即可。用户名识别、私有仓库创建、<code>data</code> 分支创建<strong>全自动完成，不用打开 GitHub 网页</strong>。之后手机和电脑粘贴同一个令牌即可看到同一份数据。
      </p>

      <div className="connect-step">
        <div className="connect-step-head"><span className="connect-step-no">1</span><strong>粘贴访问令牌</strong></div>
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
        <p className="small muted" style={{ marginBottom: 0 }}>用户名自动识别，私有仓库与 <code>data</code> 分支自动创建，无需手动建仓。</p>
      </div>

      <button className="link-btn" onClick={() => setShowHelp((v) => !v)}>
        {showHelp ? '收起「如何获取令牌」' : '还没有令牌？如何获取令牌'}
      </button>
      {showHelp && (
        <div className="notice" style={{ fontSize: 'calc(12px * var(--font-scale))', lineHeight: 1.8, marginTop: 8 }}>
          在你的账号下创建一个 Fine-grained token 即可，名称、有效期、权限都已预填好：
          <a href={tokenCreateUrl()} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 4 }}>
            <Icon name="github" size={13} /> 打开 GitHub 令牌创建页
          </a>
          <br />
          1. 如果当前设备打不开 github.com，可在手机浏览器或任意能访问 GitHub 的设备/网络打开该链接；
          <br />
          2. 确认 <b>Resource owner</b> 是你的账号、<b>Repository access</b> 选 <b>All repositories</b>；
          <br />
          3. 确认下方 <b>Repository permissions</b> 里 <b>Contents</b> 为 <b>Read and write</b>（只读会无法保存数据）；
          <br />
          4. 点 <b>Generate token</b>，复制生成的 <code>github_pat_...</code>，粘贴到上方输入框。
          <br />
          已生成过令牌的话，直接粘贴即可，无需重复创建。若提示「没有写入权限」，大多是这步的 Contents 选成了 Read-only，或 Repository access 没包含本仓库——按上面第 2、3 步改好后重新生成令牌。
        </div>
      )}

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

      <div className="notice" style={{ fontSize: 'calc(12px * var(--font-scale))', lineHeight: 1.7 }}>
        <strong>安全可靠：</strong>令牌只保存在本机浏览器、不会写进代码，仅申请 Contents（读写数据）与 Administration（自动建私有仓库）两项权限；只连接<strong>私有仓库</strong>，公开仓库会被拒绝。请勿在公用设备上使用。
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
        <span className="sync-avatar github"><Icon name="github" size={16} /></span>
        <span className="sync-user-name" title={config ? `${config.owner}/${config.repo}` : 'GitHub 存储'}>
          {configured ? `${config!.owner}/${config!.repo}` : 'GitHub 存储'}
        </span>
        <button className="icon-btn" title="GitHub 设置" onClick={openConfig}><Icon name="settings" size={14} /></button>
      </div>
      {configured ? (
        <>
          <button className="btn btn-github btn-sm" onClick={() => void sync(true)} disabled={syncing} style={{ width: '100%' }}>
            <Icon name="github" size={14} /> {syncing ? '同步中…' : '立即同步'}
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
          <button className="btn btn-github btn-sm" onClick={openConfig} style={{ width: '100%' }}>
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
  if (!ready) return <p className="small muted">正在检查登录状态…</p>
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
      </div>
      <button className="btn btn-sm" onClick={() => void sync(true)} disabled={syncing} style={{ width: '100%' }}>
        <Icon name="refresh" size={14} /> {syncing ? '同步中…' : '立即同步'}
      </button>
      {lastResult && <span className="sync-hint">{lastResult}</span>}
      <button className="btn btn-sm btn-danger" onClick={() => void signOut()} style={{ width: '100%' }}>
        <Icon name="back" size={14} /> 退出登录
      </button>
    </div>
  )
}

function TopbarSync() {
  const { configured, syncing, sync, openConfig } = useGitHubSync()
  if (configured) {
    return (
      <button
        className="topbar-sync github"
        onClick={() => void sync(true)}
        disabled={syncing}
        title={syncing ? '正在同步到 GitHub' : '立即同步到 GitHub'}
        aria-label={syncing ? '正在同步到 GitHub' : '立即同步到 GitHub'}
      >
        <Icon name="github" size={17} />
        <span>{syncing ? '同步中' : 'GitHub 同步'}</span>
      </button>
    )
  }
  return (
    <button
      className="topbar-sync github"
      onClick={openConfig}
      title="连接 GitHub 以跨设备同步数据"
      aria-label="连接 GitHub"
    >
      <Icon name="github" size={17} />
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

// 首帧即应用字号，避免页面先小后大的闪烁
const INITIAL_FONT_INDEX = initFontSize()

function FontSizeControl() {
  const [index, setIndex] = useState(INITIAL_FONT_INDEX)

  useEffect(() => {
    const onChange = (event: Event) => setIndex((event as CustomEvent<number>).detail)
    window.addEventListener(FONT_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(FONT_CHANGE_EVENT, onChange)
  }, [])

  const current = FONT_SIZES[index]
  return (
    <button
      className="font-size-btn"
      onClick={() => setIndex(cycleFontSize(index))}
      title={`当前字号：${current.label}（点击切换 标准 / 大 / 超大）`}
      aria-label={`切换字号，当前${current.label}`}
    >
      <b>Aa</b><small>{current.label}</small>
    </button>
  )
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="settings-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="settings-panel" role="dialog" aria-label="设置">
        <div className="settings-panel-head">
          <strong>设置</strong>
          <button className="icon-btn" onClick={onClose} title="关闭设置" aria-label="关闭设置"><Icon name="x" size={17} /></button>
        </div>
        <div className="settings-section">
          <div className="settings-section-title">账户</div>
          <WorkbuddySyncPanel />
        </div>
        <div className="settings-section">
          <div className="settings-section-title"><Icon name="github" size={15} /> GitHub 数据同步</div>
          <GithubSyncPanel />
        </div>
        <p className="settings-footnote">行测工作台 · 数据保存在本机与你的云端</p>
      </div>
    </>
  )
}

export default function Layout() {
  const location = useLocation()
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 导航切换后关闭设置面板
  useEffect(() => { setSettingsOpen(false) }, [location.pathname])

  // Esc 关闭设置面板
  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSettingsOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen])

  return (
    <div className="app-shell">
      <GlobalGithubConfigModal />
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="topbar-brand" title="行测工作台首页">
            <span className="logo-mark">行</span>
            <span className="topbar-brand-text">行测工作台<small>XINGCE WORKBENCH</small></span>
          </NavLink>
          <nav className="topnav" aria-label="工作区导航">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `topnav-item${isActive ? ' active' : ''}`}
                title={item.label}
              >
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <FontSizeControl />
            <TopbarSync />
            <button
              className={`topbar-settings${settingsOpen ? ' active' : ''}`}
              onClick={() => setSettingsOpen((value) => !value)}
              title="设置（账户与 GitHub）"
              aria-label="设置"
            >
              <Icon name="settings" size={18} />
            </button>
          </div>
        </div>
      </header>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <main className="page"><Outlet /></main>
    </div>
  )
}
