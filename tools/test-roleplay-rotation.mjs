// 人设切换自动轮换会话：affectedRoleplayKeys 单元 + /qqbot-ext/roleplay 路由集成。
// 跑法：node tools/test-roleplay-rotation.mjs
// 用临时 store 文件与假 rotator/webServer，不触碰真实配置、图库或 QQ。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { affectedRoleplayKeys, createRoleplayStore, roleplayRevision } from '../dsh-qqbot-ext/lib/roleplay.js'
import { register } from '../dsh-qqbot-ext/features/routes/05-roleplay.js'

let passed = 0
const ok = (name) => { passed += 1; console.log(`  ✓ ${name}`) }
const K1 = 'qqbot:app:group:g1'
const K2 = 'qqbot:app:group:g2'
const K3 = 'qqbot:app:c2c:u3'
const card = (id) => ({ id, name: id.toUpperCase(), content: `persona ${id}` })
const base = { enabled: true, defaultCardId: 'a', cards: [card('a'), card('b')], bindings: [] }

// ── affectedRoleplayKeys 单元 ──
{
  const off = { ...base, enabled: false }
  assert.deepEqual(affectedRoleplayKeys(off, base, [K1, K2]), [K1, K2], 'off→on rotates default-card keys')
  assert.deepEqual(affectedRoleplayKeys(base, off, [K1, K2]), [K1, K2], 'on→off rotates persona keys')
  ok('master switch toggle affects keys with a resolved persona')
}
{
  const bound = { ...base, bindings: [{ conversationKey: K2, cardId: 'b' }, { conversationKey: K3, cardId: '' }] }
  const switched = { ...bound, defaultCardId: 'b' }
  assert.deepEqual(affectedRoleplayKeys(bound, switched, [K1, K2, K3]), [K1], 'default switch skips explicit bindings and disabled keys')
  const rebound = { ...bound, bindings: [{ conversationKey: K2, cardId: 'a' }, { conversationKey: K3, cardId: '' }] }
  assert.deepEqual(affectedRoleplayKeys(bound, rebound, [K1, K2, K3]), [K2], 'binding switch rotates only that key')
  ok('default/binding card switches rotate exactly the changed keys')
}
{
  const edited = { ...base, cards: [card('a'), { ...card('b'), content: 'edited' }] }
  assert.deepEqual(affectedRoleplayKeys(base, edited, [K1, K2]), [], 'content edit (same id) does not rotate')
  const none = { ...base, enabled: false }
  assert.deepEqual(affectedRoleplayKeys(none, { ...none, defaultCardId: 'b' }, [K1]), [], 'disabled→disabled never rotates')
  assert.deepEqual(affectedRoleplayKeys(base, base, []), [], 'no keys, no rotation')
  ok('content edits and disabled configs do not rotate')
}

// ── 路由集成 ──
const dir = await mkdtemp(join(tmpdir(), 'qbe-roleplay-rot-'))
const store = createRoleplayStore(join(dir, 'roleplay.json'))
function makeCtx(rotator) {
  const routes = {}
  return {
    routes,
    webServer: { register: (route) => { routes[route.path] = route.handler } },
    get: (name) => {
      if (name === 'qqbotExtSessionRotator') {
        if (!rotator) throw new Error('service not available')
        return rotator
      }
      return undefined
    },
  }
}
function makeReq(payload, method = 'POST') {
  return { method, headers: {}, text: async () => JSON.stringify(payload) }
}
function makeRes() {
  return { status: 0, body: '', writeHead(status) { this.status = status }, end(body) { this.body = body } }
}
async function post(ctx, payload) {
  const res = makeRes()
  await ctx.routes['/qqbot-ext/roleplay'](makeReq(payload), res)
  return { status: res.status, body: JSON.parse(res.body) }
}
async function seed(config) {
  await store.write(config, undefined)
  return roleplayRevision(await store.read())
}

{
  const rotated = []
  const ctx = makeCtx({ knownKeys: () => [K1, K2, K3], rotate: async (k) => { rotated.push(k) } })
  register(ctx, store)
  const revision = await seed({ ...base, enabled: false, bindings: [{ conversationKey: K2, cardId: 'b' }, { conversationKey: K3, cardId: '' }] })
  const result = await post(ctx, { config: { ...base, bindings: [{ conversationKey: K2, cardId: 'b' }, { conversationKey: K3, cardId: '' }] }, revision })
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.deepEqual(rotated, [K1, K2], 'default and bound keys rotate; explicitly disabled key does not')
  assert.equal(result.body.rotated, 2)
  assert.match(result.body.message, /自动换新/)
  ok('save rotates affected sessions and reports the count')
}
{
  const rotated = []
  const ctx = makeCtx({ knownKeys: () => [K1, K2], rotate: async (k) => { rotated.push(k) } })
  register(ctx, store)
  const revision = await seed(base)
  const result = await post(ctx, { config: { ...base, enabled: false }, revision })
  assert.equal(result.body.rotated, 2)
  assert.deepEqual(rotated, [K1, K2])
  ok('master switch off rotates every persona session')
}
{
  const rotated = []
  const ctx = makeCtx({ knownKeys: () => [K1], rotate: async (k) => { rotated.push(k) } })
  register(ctx, store)
  const revision = await seed(base)
  const result = await post(ctx, { action: 'import', content: '{"name":"X","content":"y"}' })
  assert.equal(result.body.ok, true)
  assert.deepEqual(rotated, [], 'import never rotates')
  ok('card import does not rotate sessions')
}
{
  const ctx = makeCtx(null) // 网关未启动：无 rotator 服务
  register(ctx, store)
  const revision = await seed(base)
  const result = await post(ctx, { config: { ...base, enabled: false }, revision })
  assert.equal(result.body.ok, true)
  assert.equal(result.body.rotated, 0)
  ok('missing rotator degrades to save-only')
}
{
  const ctx = makeCtx({ knownKeys: () => [K1], rotate: async () => { throw new Error('rotate boom') } })
  register(ctx, store)
  const revision = await seed(base)
  const result = await post(ctx, { config: { ...base, enabled: false }, revision })
  assert.equal(result.body.ok, true, 'rotation failure must not fail the save')
  assert.equal((await store.read()).enabled, false)
  ok('rotation failure keeps the save successful')
}
{
  const rotated = []
  const ctx = makeCtx({ knownKeys: () => [K1], rotate: async (k) => { rotated.push(k) } })
  register(ctx, store)
  await seed(base)
  const result = await post(ctx, { config: { ...base, enabled: false }, revision: 'stale-revision' })
  assert.equal(result.status, 409)
  assert.deepEqual(rotated, [], 'conflict writes nothing and rotates nothing')
  ok('revision conflict rotates nothing')
}

await rm(dir, { recursive: true, force: true })
console.log(`${passed} isolated checks passed (roleplay session rotation; no real config/library/QQ touched)`)