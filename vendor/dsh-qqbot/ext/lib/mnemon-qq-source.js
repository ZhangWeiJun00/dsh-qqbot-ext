// Public dsh-mnemon/v1 contribution shapes; no private Mnemon imports.
import { addFact, removeFact, setMember, removeMember, renderPeerMemory } from './memory-store.js'

const API = 'dsh-mnemon/v1'
const TYPE = 'qq-peer-memory'
const PACKAGE = 'dsh-qqbot-ext'
const SCHEMA = 'dsh-qqbot-ext/peer-memory/v1'
const ROLES = new Set(['working-context', 'narrative', 'durable-evidence'])
const PEER = /^qqbot:[A-Za-z0-9_-]{1,128}:(?:group|c2c):[A-Za-z0-9_-]{1,128}$/
const object = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('QQ memory input must be an object')
  return value
}
const text = (value, label, max = 500) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid QQ memory ${label}`)
  return value.trim()
}
const revision = snapshot => String(snapshot.peerRevision ?? snapshot.revision)
const clone = value => JSON.parse(JSON.stringify(value))
const inputSchema = {
  type: 'object', additionalProperties: false,
  properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 30 } },
}
const actionSchema = {
  type: 'object', additionalProperties: false, required: ['operation'],
  properties: {
    operation: { type: 'string', enum: ['add-fact', 'remove-fact', 'set-member', 'remove-member'] },
    text: { type: 'string', maxLength: 500 }, memberId: { type: 'string', maxLength: 128 },
    note: { type: 'string', maxLength: 500 },
  },
}

/**
 * Mount atomically via ctx.effect(() => ctx.mnemonMemory.installContributions(
 *   createQqMemoryContribution(options), { instanceId: stableLoaderEntryId })).
 * Owns the standard selection slot: an existing scoped selection conflicts and
 * Core rejects the composition. Never disable/overwrite that other contribution.
 * resolveScope MUST use trusted host session/agent identity, never message text.
 */
export function createQqMemoryContribution({ store, resolveScope, canWrite = () => true, onStatus = () => {} }) {
  if (typeof store?.readPeer !== 'function' || typeof store?.mutatePeer !== 'function' || typeof resolveScope !== 'function') {
    throw new Error('QQ Mnemon Source requires store.readPeer, store.mutatePeer and resolveScope')
  }
  const knownQqScopes = new Set()
  const scopeId = scope => JSON.stringify([scope?.agentId ?? null, scope?.sessionId ?? null, scope?.workspaceId ?? null])
  const resolve = async scope => {
    const key = await resolveScope(scope)
    if (key === undefined || key === null) return undefined
    if (typeof key !== 'string' || !PEER.test(key)) throw new Error('QQ Mnemon scope resolver returned an invalid peer key')
    knownQqScopes.add(scopeId(scope))
    return key
  }
  const sources = [{
    manifest: {
      apiVersion: API, kind: 'source', typeId: TYPE, packageName: PACKAGE,
      role: 'working-context', capabilities: ['status', 'project', 'search', 'write'],
      consistency: 'exact-snapshot',
      routes: [{ id: 'search', description: 'Read facts and member notes only from this QQ conversation.', capability: 'search', inputSchema, maxCalls: 3, maxResults: 30, maxCharacters: 6000 }],
      actions: [{ id: 'manage-peer', description: 'Persist one fact or member note change only in this QQ conversation.', capability: 'write', inputSchema: actionSchema }],
      management: { label: 'QQ conversation memory', description: 'Peer-isolated QQ facts and member notes; no access to other peers.' },
    },
    create(context) {
      // Immutable snapshots scoped by exact projection revision, never a shared current-peer variable.
      const snapshots = new Map()
      const read = async scope => {
        const key = await resolve(scope)
        if (!key) return undefined
        const snapshot = await store.readPeer(key)
        return { key, snapshot, revision: `${key}/${revision(snapshot)}` }
      }
      const checkedGrant = async request => {
        const key = await resolve(request.view.scope)
        const grant = request.grant
        if (!key || grant?.sourceInstanceKey !== context.sourceInstanceKey || grant.schema !== SCHEMA || grant.value?.peerKey !== key) {
          throw new Error('QQ memory request is outside its pinned peer scope')
        }
        const block = grant.value.block
        if (!block || typeof block !== 'object') throw new Error('QQ memory snapshot is missing')
        return { key, block, peerRevision: grant.value.peerRevision }
      }
      const mutate = async (key, input, options) => {
        if (await canWrite() !== true) throw new Error('QQ memory writes are disabled')
        const value = object(input)
        return store.mutatePeer(key, async block => {
          if (await canWrite() !== true) throw new Error('QQ memory writes are disabled')
          switch (value.operation) {
            case 'add-fact': return addFact(block, text(value.text, 'fact'))
            case 'remove-fact': return removeFact(block, text(value.text, 'fact'))
            case 'set-member': return setMember(block, text(value.memberId, 'member id', 128), text(value.note, 'member note'))
            case 'remove-member': return removeMember(block, text(value.memberId, 'member id', 128))
            default: throw new Error('Unsupported QQ memory mutation operation')
          }
        }, options)
      }
      return {
        async facts(request) {
          const state = await read(request.scope)
          if (state) {
            snapshots.set(state.revision, clone(state.snapshot))
            while (snapshots.size > 128) snapshots.delete(snapshots.keys().next().value)
          }
          const writable = state && await canWrite() === true
          return {
            sourceInstanceKey: context.sourceInstanceKey, sourceTypeId: TYPE, role: 'working-context',
            availability: state ? 'ready' : 'unavailable', revision: state?.revision ?? 'not-qq',
            capabilities: state ? ['status', 'project', 'search', ...(writable ? ['write'] : [])] : ['status'],
            routeIds: state ? ['search'] : [], actionIds: writable ? ['manage-peer'] : [],
            hints: { qqPeerAvailable: Boolean(state) },
          }
        },
        async project(request) {
          const key = await resolve(request.scope)
          if (!key) return { fragments: [] }
          const snapshot = snapshots.get(request.expectedRevision)
          if (!snapshot || `${key}/${revision(snapshot)}` !== request.expectedRevision) throw new Error('QQ memory projection snapshot unavailable or scope changed')
          const budget = Math.min(6000, request.maxCharacters)
          const rendered = request.includeProjection && budget >= 300 ? renderPeerMemory(snapshot.block, { maxChars: budget }) : ''
          return {
            fragments: rendered ? [{ id: `${context.sourceInstanceKey}/peer`, sourceInstanceKey: context.sourceInstanceKey, mode: request.mode, text: rendered, revision: request.expectedRevision, provenance: { sourceTypeId: TYPE } }] : [],
            readGrant: {
              id: `${context.sourceInstanceKey}/grant/${request.expectedRevision}`,
              sourceInstanceKey: context.sourceInstanceKey, schema: SCHEMA,
              value: { peerKey: key, peerRevision: snapshot.peerRevision ?? snapshot.revision, block: clone(snapshot.block) },
              revision: request.expectedRevision, consistency: 'exact-snapshot',
            },
          }
        },
        async query(request) {
          const { block } = await checkedGrant(request)
          if (request.route.sourceRouteId !== 'search') throw new Error('Unsupported QQ memory route')
          const input = object(request.input)
          const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : ''
          if (query.length > 500) throw new Error('QQ memory search query too long')
          const limit = input.limit ?? 20
          if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error('Invalid QQ memory search limit')
          const all = [
            ...Object.entries(block.members ?? {}).map(([id, member]) => ({ id: `member:${id}`, text: JSON.stringify({ memberId: id, note: member.note }) })),
            ...(block.facts ?? []).map((fact, i) => ({ id: `fact:${i}`, text: JSON.stringify({ fact: fact.text }) })),
          ].filter(row => !query || row.text.toLowerCase().includes(query))
          const items = []
          let chars = 0
          for (const row of all) {
            if (items.length >= Math.min(limit, request.route.maxResults ?? 30) || chars + row.text.length > Math.min(6000, request.route.maxCharacters ?? 6000)) break
            items.push({ ...row, provenance: { sourceTypeId: TYPE }, revision: request.grant.revision })
            chars += row.text.length
          }
          return { id: `${request.view.id}/qq-evidence/${Date.now()}`, viewId: request.view.id, routeId: request.route.id, sourceInstanceKey: context.sourceInstanceKey, observedAt: new Date().toISOString(), items, truncated: items.length < all.length }
        },
        async mutate(request) {
          if (request.offer.sourceActionId !== 'manage-peer') throw new Error('Unsupported QQ memory action')
          const { key, peerRevision } = await checkedGrant(request)
          const result = await mutate(key, request.input, { expectedPeerRevision: peerRevision })
          const committed = result.receipt?.persisted === true
          return {
            id: `${request.view.id}/qq-write/${Date.now()}`, viewId: request.view.id, offerId: request.offer.id,
            sourceInstanceKey: context.sourceInstanceKey, status: 'succeeded', completion: committed ? 'committed' : 'accepted',
            ...(committed ? { committedAt: new Date().toISOString() } : {}),
            revision: `${key}/${revision(result)}`, details: { changed: Boolean(result.changed), result: result.result ?? null, receipt: result.receipt ?? null },
          }
        },
        async manage(request) {
          const state = await read(request.scope)
          if (!state || request.sourceInstanceKey !== context.sourceInstanceKey) throw new Error('QQ memory management scope unavailable')
          if (request.mode === 'read' && request.operation === 'snapshot') return { revision: state.revision, value: clone(state.snapshot.block) }
          if (request.mode !== 'mutate' || request.operation !== 'manage-peer' || request.confirmed !== true) throw new Error('Unsupported or unconfirmed QQ memory management operation')
          if (request.expectedRevision !== state.revision) throw new Error('QQ memory management revision conflict')
          const result = await mutate(state.key, request.input, { expectedPeerRevision: state.snapshot.peerRevision ?? state.snapshot.revision })
          return { revision: `${state.key}/${revision(result)}`, value: { changed: Boolean(result.changed), result: result.result ?? null, receipt: result.receipt ?? null } }
        },
        dispose() { snapshots.clear() },
      }
    },
  }]
  return {
    sources,
    strategyExtensions: [{
      manifest: { apiVersion: API, kind: 'strategy-extension', typeId: 'qq-peer-selection', packageName: PACKAGE, strategyTypeId: 'default-three-tier', slot: 'selection', deterministic: true },
      contribute(request, available) {
        const qq = available.filter(source => source.sourceTypeId === TYPE && source.hints?.qqPeerAvailable === true && source.availability === 'ready')
        if (qq.length > 1) throw new Error('Multiple QQ memory Sources claim this session; refusing ambiguous peer composition')
        if (!qq.length && knownQqScopes.has(scopeId(request.scope))) throw new Error('QQ memory Source unavailable for a known QQ scope; refusing global memory fallback')
        const chosen = qq.length ? qq : available.filter(source => source.sourceTypeId !== TYPE && ROLES.has(source.role) && source.availability !== 'unavailable')
        try { onStatus({ active: qq.length === 1, sourceInstanceKey: qq[0]?.sourceInstanceKey }) } catch { /* Observability must not change composition. */ }
        return { sourceKeys: chosen.map(source => source.sourceInstanceKey), writableSourceKeys: chosen.map(source => source.sourceInstanceKey) }
      },
    }],
  }
}
