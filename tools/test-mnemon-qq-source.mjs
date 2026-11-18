import assert from 'node:assert/strict'
import { createQqMemoryContribution } from '../dsh-qqbot-ext/lib/mnemon-qq-source.js'

const states = new Map()
let writable = true
let failRead = false
const key = peer => `qqbot:app:group:${peer}`
const initial = peer => ({ revision: 0, peerRevision: 0, block: { revision: 0, members: {}, facts: [{ text: `${peer}-secret`, updated: 1 }] } })
const stateFor = peer => {
  if (!states.has(peer)) states.set(peer, initial(peer))
  return states.get(peer)
}
const store = {
  async readPeer(peer) {
    if (failRead) throw new Error('read failed')
    return structuredClone(stateFor(peer))
  },
  async mutatePeer(peer, fn, options) {
    const state = stateFor(peer)
    if (options.expectedPeerRevision !== state.peerRevision) throw new Error('revision conflict')
    const candidate = structuredClone(state.block)
    const result = await fn(candidate)
    const changed = JSON.stringify(candidate) !== JSON.stringify(state.block)
    if (changed) { state.block = candidate; state.revision++; state.peerRevision++ }
    return { ...structuredClone(state), changed, result, receipt: { persisted: changed } }
  },
}
const contribution = createQqMemoryContribution({
  store,
  resolveScope: async scope => ['one', 'two'].includes(scope.sessionId) ? key(scope.sessionId) : undefined,
  canWrite: () => writable,
})
const runtime = contribution.sources[0].create({ sourceInstanceKey: 'source:qq' })
const extension = contribution.strategyExtensions[0]
const scope = sessionId => ({ storage: 'global', sessionId })
const requestFor = async sessionId => {
  const operationScope = scope(sessionId)
  const facts = await runtime.facts({ scope: operationScope })
  const projection = await runtime.project({ scope: operationScope, expectedRevision: facts.revision, includeProjection: true, mode: 'eager', maxCharacters: 6000 })
  return { facts, projection, view: { id: `view-${sessionId}`, scope: operationScope } }
}
const one = await requestFor('one')
const two = await requestFor('two')
assert.match(one.projection.fragments[0].text, /one-secret/)
assert.doesNotMatch(one.projection.fragments[0].text, /two-secret/)
const globals = [{ sourceInstanceKey: 'source:runtime', sourceTypeId: 'runtime', role: 'working-context', availability: 'ready' }, { sourceInstanceKey: 'source:spaces', sourceTypeId: 'memory-spaces', role: 'durable-evidence', availability: 'ready' }]
assert.deepEqual(extension.contribute({ scope: scope('one') }, [one.facts, ...globals]).sourceKeys, ['source:qq'])
const webFacts = await runtime.facts({ scope: scope('web') })
assert.equal(webFacts.availability, 'unavailable')
assert.deepEqual(extension.contribute({ scope: scope('web') }, [webFacts, ...globals]).sourceKeys, globals.map(item => item.sourceInstanceKey))
assert.throws(() => extension.contribute({ scope: scope('one') }, globals), /refusing global/)
const query = { view: one.view, grant: one.projection.readGrant, route: { id: 'route', sourceRouteId: 'search', maxResults: 30, maxCharacters: 6000 }, input: {} }
assert.equal((await runtime.query(query)).items.length, 1)
await assert.rejects(runtime.query({ ...query, view: two.view }), /outside.*scope/)
const mutation = { view: one.view, grant: one.projection.readGrant, offer: { id: 'offer', sourceActionId: 'manage-peer' }, input: { operation: 'add-fact', text: 'new-fact' } }
writable = false
const readonly = await runtime.facts({ scope: scope('one') })
assert.equal(readonly.capabilities.includes('write'), false)
assert.deepEqual(readonly.actionIds, [])
await assert.rejects(runtime.mutate(mutation), /disabled/)
await assert.rejects(runtime.manage({ scope: scope('one'), sourceInstanceKey: 'source:qq', mode: 'mutate', operation: 'manage-peer', input: mutation.input, expectedRevision: readonly.revision, confirmed: true }), /disabled/)
writable = true
const committed = await runtime.mutate(mutation)
assert.equal(committed.completion, 'committed')
assert.ok(committed.committedAt)
await assert.rejects(runtime.mutate(mutation), /revision conflict/)
const refreshed = await requestFor('one')
const noop = await runtime.mutate({ ...mutation, grant: refreshed.projection.readGrant, input: { operation: 'remove-fact', text: 'absent-fact' } })
assert.equal(noop.completion, 'accepted')
assert.equal(noop.committedAt, undefined)
// Read evidence remains pinned even after a successful write.
assert.equal((await runtime.query(query)).items.length, 1)
failRead = true
await assert.rejects(runtime.facts({ scope: scope('one') }), /read failed/)
assert.throws(() => extension.contribute({ scope: scope('one') }, globals), /refusing global/)
runtime.dispose()
console.log('PASS QQ isolation, non-QQ selection, exact snapshots, failure closed, write gate, receipt truth and CAS')
