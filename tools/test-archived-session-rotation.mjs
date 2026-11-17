// 归档会话自动换新（本地维护补丁）隔离测试。
// 跑法：node --experimental-vm-modules tools/test-archived-session-rotation.mjs
// 用 vm.SyntheticModule  stub 掉全部依赖，只验证 SessionManager 的归档轮换逻辑；
// 不触碰真实配置、图库或 QQ。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../vendor/dsh-qqbot/lib/session/session-manager.js', import.meta.url), 'utf8')
assert.ok(source.includes('本地维护：归档会话'), 'rotation patch present in vendor')

function buildWorld({ withRegistry = true } = {}) {
  const prefs = new Map()
  const disk = new Set()
  const live = new Map()
  const archived = new Set()
  const calls = { resume: [], create: [], cancelled: [], disposed: [], logs: [] }
  let mintCounter = 0
  const mintSessionId = () => `session-minted-${++mintCounter}`
  const makeAgent = (id) => ({
    session: { header: { id } },
    status: 'idle',
    cancel: () => { calls.cancelled.push(id) },
  })
  const makeHandle = (agent) => ({ agent, dispose: async () => { calls.disposed.push(agent.session.header.id) } })
  const agents = {
    get: (id) => live.get(id),
    resume: async ({ resumeSessionId }) => {
      calls.resume.push(resumeSessionId)
      if (!disk.has(resumeSessionId)) throw new Error(`session not found: ${resumeSessionId}`)
      const agent = makeAgent(resumeSessionId)
      live.set(resumeSessionId, agent)
      return makeHandle(agent)
    },
    create: async ({ sessionId }) => {
      calls.create.push(sessionId)
      disk.add(sessionId)
      const agent = makeAgent(sessionId)
      live.set(sessionId, agent)
      return makeHandle(agent)
    },
  }
  const ctx = {
    on: () => {},
    get: (name) => {
      if (name === 'workspaceRegistry') {
        if (!withRegistry) throw new Error('no workspaceRegistry')
        return { archivedSessionIds: [...archived] }
      }
      return undefined
    },
  }
  const logger = { info: (m) => calls.logs.push(m), warn: (m) => calls.logs.push(m), debug: () => {} }
  const config = { appId: 'app', sessionIdleTimeout: 1800000, groupPrompt: '', directPrompt: '' }
  const modelResolverStub = {
    getEffectiveRoute: () => undefined,
    getResumeRoute: () => undefined,
    getPreset: () => undefined,
    getSessionId: (k) => prefs.get(k),
    setSessionId: (k, v) => prefs.set(k, v),
    clearSessionId: (k) => prefs.delete(k),
    prefs: { sessionIds: prefs },
  }
  const hostStub = {
    capabilities: [],
    sessionHeader: async () => undefined,
    sessionExists: async (id) => disk.has(id),
    sessionEvents: () => [],
    buildForkSeed: async () => undefined,
    serviceFor: async () => undefined,
    globalService: () => undefined,
  }
  const modules = {
    './session-id.js': { legacyDerivedSessionId: (k) => `legacy-${k}`, mintSessionId },
    '@deepseek-ai/dsh-session': { SessionId: (s) => s },
    '../host/adapter.js': { createHostAdapter: () => hostStub },
    'node:fs': { mkdirSync: () => {} },
    '../shared/dirs.js': { resolveAgentCwd: () => 'D:/tmp-qqbot-ws' },
    '../model/model-resolver.js': { ModelResolver: class { constructor() { Object.assign(this, modelResolverStub) } } },
    './idle-evictor.js': { IdleEvictor: class { dispose() {} } },
  }
  const context = vm.createContext({ console })
  const root = new vm.SourceTextModule(source, { context })
  const link = async (spec) => {
    const names = modules[spec]
    if (!names) throw new Error('Unexpected import ' + spec)
    return new vm.SyntheticModule(Object.keys(names), function () {
      for (const [key, value] of Object.entries(names)) this.setExport(key, value)
    }, { context })
  }
  return { root, link, prefs, disk, live, archived, calls, agents, ctx, config, logger, mintSessionId }
}

async function makeManager(world) {
  await world.root.link(world.link)
  await world.root.evaluate()
  const { SessionManager } = world.root.namespace
  return new SessionManager(world.ctx, world.agents, world.config, world.logger)
}

const KEY = 'qqbot:app:group:peer'
let passed = 0
const ok = (name) => { passed += 1; console.log(`  ✓ ${name}`) }

// 1. 未归档：缓存命中直接复用，不 resume/create
{
  const w = buildWorld()
  const m = await makeManager(w)
  w.prefs.set(KEY, 's1'); w.disk.add('s1')
  const first = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  assert.equal(first.sessionId, 's1')
  assert.deepEqual(w.calls.resume, ['s1'])
  const second = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  assert.equal(second, first, 'cached record reused')
  assert.equal(w.calls.create.length, 0)
  ok('unarchived session reuses the cached record')
}

// 2. 活跃会话被归档：静默退役 + 换新会话（cancel/dispose/新 id/不通知 QQ）
{
  const w = buildWorld()
  const m = await makeManager(w)
  w.prefs.set(KEY, 's1'); w.disk.add('s1')
  const first = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  w.archived.add('s1')
  const second = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  assert.notEqual(second.sessionId, 's1', 'rotated to a fresh session')
  assert.notEqual(second, first)
  assert.ok(w.calls.cancelled.includes('s1'), 'old agent cancelled')
  assert.ok(w.calls.disposed.includes('s1'), 'old handle disposed')
  assert.ok(w.calls.create.includes(second.sessionId), 'fresh session created')
  assert.equal(w.prefs.get(KEY), second.sessionId, 'prefs point at the fresh session')
  assert.ok(!w.archived.has(second.sessionId))
  assert.ok(w.calls.logs.some((l) => l.includes('archived, rotating')), 'rotation logged')
  ok('archived live session rotates silently to a fresh session')
}

// 3. 重启后 prefs 指向归档会话：openSession 拦截，不 resume 归档 id，直接新建
{
  const w = buildWorld()
  const m = await makeManager(w)
  w.prefs.set(KEY, 's2'); w.disk.add('s2'); w.archived.add('s2')
  const record = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  assert.notEqual(record.sessionId, 's2')
  assert.ok(!w.calls.resume.includes('s2'), 'never resumes the archived id')
  assert.ok(w.calls.create.includes(record.sessionId))
  assert.equal(w.prefs.get(KEY), record.sessionId)
  ok('archived candidate on open mints a fresh id without resuming it')
}

// 4. 宿主没有 workspaceRegistry：按未归档处理（fail-open，行为同上游）
{
  const w = buildWorld({ withRegistry: false })
  const m = await makeManager(w)
  w.prefs.set(KEY, 's1'); w.disk.add('s1'); w.archived.add('s1')
  const first = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  const second = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  assert.equal(second, first, 'no registry → reuse as upstream')
  assert.equal(w.calls.create.length, 0)
  ok('missing workspaceRegistry degrades to upstream behavior')
}

// 5. 回归：未归档且盘上缺失 → 沿用 prefs id 新建（不误铸造）
{
  const w = buildWorld()
  const m = await makeManager(w)
  w.prefs.set(KEY, 's3')
  const record = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  assert.equal(record.sessionId, 's3', 'prefs id kept when session merely missing')
  assert.ok(w.calls.create.includes('s3'))
  ok('missing unarchived session still recreates under the same prefs id')
}

// 6. 回归：/new（remove）仍铸造新 id 并退役旧会话
{
  const w = buildWorld()
  const m = await makeManager(w)
  w.prefs.set(KEY, 's1'); w.disk.add('s1')
  await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  await m.remove('group', 'peer')
  assert.notEqual(w.prefs.get(KEY), 's1')
  assert.equal(m.size, 0)
  assert.ok(w.calls.cancelled.includes('s1'))
  ok('/new remove() still mints and retires')
}

// 7. 归档轮换后再次归档：连续轮换不泄漏、不卡死
{
  const w = buildWorld()
  const m = await makeManager(w)
  w.prefs.set(KEY, 's1'); w.disk.add('s1')
  const a = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  w.archived.add(a.sessionId)
  const b = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  w.archived.add(b.sessionId)
  const c = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  assert.notEqual(c.sessionId, b.sessionId)
  assert.notEqual(c.sessionId, a.sessionId)
  assert.equal(m.size, 1, 'only one live record per key')
  ok('repeated archival keeps rotating without leaking records')
}

// 8. removeByKey：活跃记录退役 + 铸造新 prefs id + 清待答/待批
{
  const w = buildWorld()
  const m = await makeManager(w)
  const cleared = []
  m.questionChannel = { cancelPending: (k) => cleared.push(['q', k]) }
  m.approvalChannel = { cancelPending: (k) => cleared.push(['a', k]) }
  w.prefs.set(KEY, 's1'); w.disk.add('s1')
  await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  await m.removeByKey(KEY)
  assert.notEqual(w.prefs.get(KEY), 's1')
  assert.equal(m.size, 0)
  assert.ok(w.calls.cancelled.includes('s1'))
  assert.ok(w.calls.disposed.includes('s1'))
  assert.deepEqual(cleared, [['q', KEY], ['a', KEY]])
  ok('removeByKey retires the active record and clears pending channels')
}

// 9. removeByKey：无活跃记录只改 prefs（存量会话下次消息新建）
{
  const w = buildWorld()
  const m = await makeManager(w)
  w.prefs.set(KEY, 's-old'); w.disk.add('s-old')
  await m.removeByKey(KEY)
  assert.notEqual(w.prefs.get(KEY), 's-old')
  assert.equal(w.calls.cancelled.length, 0)
  const record = await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  assert.notEqual(record.sessionId, 's-old', 'next message opens a fresh session')
  ok('removeByKey without a live record only rewrites prefs')
}

// 10. knownSessionKeys：活跃 + prefs 存量并集
{
  const w = buildWorld()
  const m = await makeManager(w)
  w.prefs.set(KEY, 's1'); w.disk.add('s1')
  w.prefs.set('qqbot:app:c2c:other', 's2')
  await m.getOrCreate('group', 'peer', 'sender', { targetId: 'peer' })
  const keys = m.knownSessionKeys()
  assert.ok(keys.includes(KEY))
  assert.ok(keys.includes('qqbot:app:c2c:other'))
  assert.equal(new Set(keys).size, keys.length, 'no duplicates')
  ok('knownSessionKeys unions active and stored keys')
}

console.log(`${passed} isolated checks passed (archived-session rotation; no real config/library/QQ touched)`)