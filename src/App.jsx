import { useEffect, useMemo, useRef, useState } from 'react'

const Icon = ({ children }) => <span className="icon" aria-hidden="true">{children}</span>
const post = (url, value) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
const shortPath = (path) => path?.replace(/^\/home\/[^/]+/, '~')

function ProjectDrawer({ project, onClose, onTerminal, notify }) {
  const [details, setDetails] = useState(null)
  const [tab, setTab] = useState('run')
  const logsRef = useRef(null)

  async function refresh() {
    const response = await fetch(`/api/project?path=${encodeURIComponent(project.path)}`)
    if (response.ok) setDetails(await response.json())
  }

  useEffect(() => {
    const poll = async () => {
      const response = await fetch(`/api/project?path=${encodeURIComponent(project.path)}`)
      if (response.ok) setDetails(await response.json())
    }
    poll()
    const timer = setInterval(poll, 1000)
    return () => clearInterval(timer)
  }, [project.path])

  useEffect(() => { if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight }, [details?.process?.logs])

  async function run(script) {
    const response = await post('/api/process/start', { path: project.path, script })
    const data = await response.json()
    if (!response.ok) notify(data.error || 'Could not start process')
    else { notify(`Started npm run ${script}`); refresh() }
  }

  async function stop() {
    await post('/api/process/stop', { path: project.path })
    notify('Stopping process…')
    refresh()
  }

  const process = details?.process
  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="drawer">
      <div className="drawer-head">
        <div className="repo-icon large">⌁</div>
        <div><p className="eyebrow">PROJECT WORKSPACE</p><h2>{project.name}</h2><span>{shortPath(project.path)}</span></div>
        <button className="drawer-close" onClick={onClose}>×</button>
      </div>
      <div className="drawer-actions">
        <button onClick={() => onTerminal(project)}>⌘ Terminal</button>
        <span className={`run-state ${process?.status || 'idle'}`}><i/>{process?.status || 'idle'}</span>
      </div>
      <div className="tabs">
        {['run', 'git', 'readme'].map((name) => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}
      </div>
      {!details && <div className="drawer-loading"><div className="loader"/>Inspecting project…</div>}
      {details && tab === 'run' && <div className="tab-content">
        <div className="panel-title"><div><strong>Package scripts</strong><span>Detected from package.json</span></div>{process?.status === 'running' && <button className="stop" onClick={stop}>■ Stop</button>}</div>
        <div className="scripts">
          {!details.scripts.length && <p className="muted">No runnable package scripts detected.</p>}
          {details.scripts.map((script) => <div key={script.name}><span className="script-name">npm run <strong>{script.name}</strong></span><code>{script.command}</code><button disabled={process?.status === 'running'} onClick={() => run(script.name)}>▶ Run</button></div>)}
        </div>
        {process && <div className="process-panel">
          <div className="process-meta"><span><i className={process.status}/> {process.script}</span><span>{process.pid ? `PID ${process.pid}` : ''}</span></div>
          {!!process.urls.length && <div className="urls">{process.urls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">↗ {url}</a>)}</div>}
          <pre ref={logsRef}>{process.logs.length ? process.logs.join('\n') : 'Waiting for output…'}</pre>
        </div>}
      </div>}
      {details && tab === 'git' && <div className="tab-content git-tab">
        <div className="panel-title"><div><strong>Working tree</strong><span>{details.changedFiles.length} changed files</span></div></div>
        <div className="files">{details.changedFiles.length ? details.changedFiles.map((item) => <div key={item.file}><b>{item.status}</b><span>{item.file}</span></div>) : <p className="muted">Working tree is clean.</p>}</div>
        <div className="panel-title commits-title"><div><strong>Recent commits</strong><span>Latest five</span></div></div>
        <div className="commits">{details.commits.length ? details.commits.map((commit) => <div key={commit.hash}><code>{commit.hash}</code><strong>{commit.message}</strong><span>{commit.relativeTime}</span></div>) : <p className="muted">No commits yet.</p>}</div>
      </div>}
      {details && tab === 'readme' && <div className="tab-content"><pre className="readme">{details.readme || 'No README found for this project.'}</pre></div>}
    </section>
  </div>
}

function App() {
  const [projects, setProjects] = useState([])
  const [root, setRoot] = useState('~/Work')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(0)
  const [activeProject, setActiveProject] = useState(null)
  const [toast, setToast] = useState('')
  const searchRef = useRef(null)

  async function load() {
    setLoading(true)
    try {
      const response = await fetch('/api/projects')
      const data = await response.json()
      setProjects(data.projects || [])
      setRoot(data.root || '~/Work')
    } catch { setToast('Could not reach the local service') }
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const handler = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus() }
      if (event.key === 'Escape') { activeProject ? setActiveProject(null) : setQuery(''); searchRef.current?.blur() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeProject])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 2200); return () => clearTimeout(id) }, [toast])

  const filtered = useMemo(() => projects
    .filter((project) => `${project.name} ${project.path} ${project.branch}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name)), [projects, query])

  async function pin(project) {
    const pinned = !project.pinned
    setProjects((all) => all.map((item) => item.path === project.path ? { ...item, pinned } : item))
    await post('/api/pins', { path: project.path, pinned })
  }

  async function open(project) {
    const response = await post('/api/open-terminal', { path: project.path })
    setToast(response.ok ? `Terminal opened in ${project.name}` : 'Could not open terminal')
  }

  function onSearchKey(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, filtered.length - 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)) }
    if (event.key === 'Enter' && filtered[selected]) setActiveProject(filtered[selected])
  }

  const dirty = projects.filter((project) => project.changes > 0).length
  const pinned = projects.filter((project) => project.pinned).length

  return <div className="shell">
    <aside>
      <div className="brand"><div className="mark">S</div><div><strong>Sloth's</strong><span>Dev CC</span></div></div>
      <nav><button className="active"><Icon>⌂</Icon>Overview</button><button onClick={() => searchRef.current?.focus()}><Icon>⌕</Icon>Projects <em>{projects.length}</em></button><button onClick={() => setQuery('')}><Icon>☆</Icon>Pinned <em>{pinned}</em></button></nav>
      <div className="sidebar-bottom"><div className="pulse"/><span>Local service online</span></div>
    </aside>
    <main>
      <header><div><p className="eyebrow">LOCAL WORKSPACE</p><h1>Good to see you.</h1><p className="sub">Your projects are quiet. Mostly.</p></div><button className="refresh" onClick={load} title="Refresh repositories">↻</button></header>
      <section className="stats"><article><span>Repositories</span><strong>{projects.length}</strong><small>in {shortPath(root)}</small></article><article><span>Clean trees</span><strong>{projects.length - dirty}</strong><small className="good">● Ready to build</small></article><article><span>Need attention</span><strong>{dirty}</strong><small className={dirty ? 'warm' : 'good'}>● {dirty ? 'Uncommitted work' : 'All clear'}</small></article></section>
      <section className="projects">
        <div className="section-head"><div><h2>Projects</h2><p>Git repositories discovered nearby</p></div><label className="search"><Icon>⌕</Icon><input ref={searchRef} value={query} onChange={(e) => { setQuery(e.target.value); setSelected(0) }} onKeyDown={onSearchKey} placeholder="Search projects…"/><kbd>⌘ K</kbd></label></div>
        <div className="list">
          {loading && <div className="empty"><div className="loader"/>Scanning your workspace…</div>}
          {!loading && !filtered.length && <div className="empty"><span>⌁</span><strong>No repositories found</strong><p>{query ? 'Try a different search.' : `Initialize a Git repository somewhere in ${root}.`}</p></div>}
          {filtered.map((project, index) => <article key={project.path} className={index === selected ? 'selected' : ''} onMouseEnter={() => setSelected(index)} onClick={() => setActiveProject(project)}>
            <button className={`star ${project.pinned ? 'pinned' : ''}`} onClick={(event) => { event.stopPropagation(); pin(project) }} aria-label="Pin project">{project.pinned ? '★' : '☆'}</button><div className="repo-icon">⌁</div><div className="repo-main"><strong>{project.name}</strong><span>{shortPath(project.path)}</span></div><div className="branch"><span>⑂</span>{project.branch}</div><div className="commit"><strong>{project.message}</strong><span>{project.hash} {project.relativeTime && `· ${project.relativeTime}`}</span></div><div className={`status ${project.changes ? 'dirty' : ''}`}><i/>{project.changes ? `${project.changes} change${project.changes === 1 ? '' : 's'}` : 'Clean'}</div><button className="open" onClick={(event) => { event.stopPropagation(); open(project) }}>Terminal <span>↗</span></button>
          </article>)}
        </div>
      </section>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> inspect project</span><span><kbd>esc</kbd> close / clear</span></footer>
    </main>
    {activeProject && <ProjectDrawer project={activeProject} onClose={() => setActiveProject(null)} onTerminal={open} notify={setToast}/>} {toast && <div className="toast">{toast}</div>}
  </div>
}

export default App
