import { createServer } from 'node:http'
import { readdir, readFile, stat, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'

const exec = promisify(execFile)
const port = Number(process.env.PORT || 4174)
const projectsRoot = resolve(process.env.PROJECTS_ROOT || join(homedir(), 'Work'))
const dataDir = join(import.meta.dirname, '.data')
await mkdir(dataDir, { recursive: true })
const db = new DatabaseSync(join(dataDir, 'cockpit.db'))
db.exec('CREATE TABLE IF NOT EXISTS pins (path TEXT PRIMARY KEY, pinned_at INTEGER NOT NULL)')
const processes = new Map()
const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function validProjectPath(path) {
  if (!path) return false
  const candidate = resolve(path)
  return candidate === projectsRoot || candidate.startsWith(`${projectsRoot}/`)
}

async function packageScripts(path) {
  try {
    const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
    return Object.entries(pkg.scripts || {}).map(([name, command]) => ({ name, command, runner: 'npm' }))
  } catch { return [] }
}

function processView(path) {
  const current = processes.get(path)
  if (!current) return null
  return { script: current.script, status: current.status, pid: current.pid, startedAt: current.startedAt, exitCode: current.exitCode, logs: current.logs, urls: [...current.urls] }
}

async function projectDetails(path) {
  const [scripts, changedRaw, commitsRaw] = await Promise.all([
    packageScripts(path),
    git(path, ['status', '--short']),
    git(path, ['log', '-5', '--format=%h%x00%s%x00%cr']),
  ])
  let readme = ''
  for (const name of ['README.md', 'readme.md', 'README']) {
    try { readme = (await readFile(join(path, name), 'utf8')).slice(0, 6000); break } catch { /* try next */ }
  }
  return {
    scripts,
    changedFiles: changedRaw ? changedRaw.split('\n').map((line) => ({ status: line.slice(0, 2).trim() || '?', file: line.slice(3) })) : [],
    commits: commitsRaw ? commitsRaw.split('\n').map((line) => { const [hash, message, relativeTime] = line.split('\0'); return { hash, message, relativeTime } }) : [],
    readme,
    process: processView(path),
  }
}

async function startProcess(path, script) {
  const scripts = await packageScripts(path)
  if (!scripts.some((item) => item.name === script)) throw new Error('Unknown package script')
  const existing = processes.get(path)
  if (existing?.status === 'running') throw new Error('A process is already running for this project')
  const child = spawn('npm', ['run', script], { cwd: path, detached: true, env: { ...process.env, FORCE_COLOR: '0' } })
  const record = { child, pid: child.pid, script, status: 'running', startedAt: Date.now(), exitCode: null, logs: [], urls: new Set() }
  processes.set(path, record)
  const capture = (chunk) => {
    const text = chunk.toString().replaceAll(ansiEscape, '')
    record.logs.push(...text.split(/\r?\n/).filter(Boolean))
    record.logs = record.logs.slice(-300)
    for (const match of text.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+(?:\/\S*)?/g)) record.urls.add(match[0].replace('0.0.0.0', 'localhost'))
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  child.on('error', (error) => { capture(error.message); record.status = 'crashed' })
  child.on('exit', (code, signal) => { record.exitCode = code; record.status = signal === 'SIGTERM' ? 'stopped' : code === 0 ? 'completed' : 'crashed' })
  return processView(path)
}

function stopProcess(path) {
  const record = processes.get(path)
  if (!record || record.status !== 'running') return false
  try { process.kill(-record.pid, 'SIGTERM'); return true } catch { return false }
}

async function git(cwd, args) {
  try {
    const { stdout } = await exec('git', ['-C', cwd, ...args], { timeout: 2500 })
    return stdout.trim()
  } catch { return '' }
}

async function findRepos(root, depth = 2) {
  const repos = []
  async function walk(dir, level) {
    if (existsSync(join(dir, '.git'))) { repos.push(dir); return }
    if (level >= depth) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    await Promise.all(entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => walk(join(dir, e.name), level + 1)))
  }
  await walk(root, 0)
  return repos
}

async function getProjects() {
  const pinned = new Set(db.prepare('SELECT path FROM pins').all().map((row) => row.path))
  const dirs = await findRepos(projectsRoot)
  return Promise.all(dirs.map(async (path) => {
    const [branch, porcelain, latest] = await Promise.all([
      git(path, ['branch', '--show-current']),
      git(path, ['status', '--porcelain']),
      git(path, ['log', '-1', '--format=%h%x00%s%x00%cr']),
    ])
    const [hash = '', message = 'No commits yet', relativeTime = ''] = latest.split('\0')
    const changes = porcelain ? porcelain.split('\n').length : 0
    return { name: path.split('/').at(-1), path, branch: branch || 'detached', changes, hash, message, relativeTime, pinned: pinned.has(path) }
  }))
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

async function body(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString() || '{}')
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/projects') return json(res, 200, { root: projectsRoot, projects: await getProjects() })
  if (req.method === 'GET' && url.pathname === '/api/project') {
    const path = url.searchParams.get('path')
    if (!validProjectPath(path)) return json(res, 400, { error: 'Invalid project path' })
    return json(res, 200, await projectDetails(resolve(path)))
  }
  if (req.method === 'POST' && url.pathname === '/api/pins') {
    const { path, pinned } = await body(req)
    if (!validProjectPath(path)) return json(res, 400, { error: 'Invalid project path' })
    if (pinned) db.prepare('INSERT OR REPLACE INTO pins VALUES (?, ?)').run(path, Date.now())
    else db.prepare('DELETE FROM pins WHERE path = ?').run(path)
    return json(res, 200, { ok: true })
  }
  if (req.method === 'POST' && url.pathname === '/api/process/start') {
    const { path, script } = await body(req)
    if (!validProjectPath(path)) return json(res, 400, { error: 'Invalid project path' })
    try { return json(res, 201, await startProcess(resolve(path), script)) }
    catch (error) { return json(res, 400, { error: error.message }) }
  }
  if (req.method === 'POST' && url.pathname === '/api/process/stop') {
    const { path } = await body(req)
    if (!validProjectPath(path)) return json(res, 400, { error: 'Invalid project path' })
    return json(res, stopProcess(resolve(path)) ? 200 : 409, { ok: true })
  }
  if (req.method === 'POST' && url.pathname === '/api/open-terminal') {
    const { path } = await body(req)
    if (!validProjectPath(path)) return json(res, 400, { error: 'Invalid project path' })
    try {
      const child = spawn('xdg-terminal-exec', [`--dir=${resolve(path)}`], { detached: true, stdio: 'ignore' })
      await new Promise((resolveSpawn, rejectSpawn) => {
        child.once('spawn', resolveSpawn)
        child.once('error', rejectSpawn)
      })
      child.unref()
      return json(res, 200, { ok: true })
    } catch (error) { return json(res, 500, { error: `Could not open terminal: ${error.message}` }) }
  }
  return json(res, 404, { error: 'Not found' })
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (url.pathname.startsWith('/api/')) return await api(req, res, url)
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const file = join(import.meta.dirname, 'dist', requested)
    const target = existsSync(file) && (await stat(file)).isFile() ? file : join(import.meta.dirname, 'dist', 'index.html')
    res.writeHead(200, { 'content-type': mime[extname(target)] || 'application/octet-stream' })
    res.end(await readFile(target))
  } catch (error) { json(res, 500, { error: error.message }) }
}).listen(port, () => console.log(`Sloth's Dev CC API → http://localhost:${port}`))
