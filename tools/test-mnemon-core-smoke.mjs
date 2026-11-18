import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createQqMemoryContribution } from '../dsh-qqbot-ext/lib/mnemon-qq-source.js'

// Requires installed public peers (notably @deepseek-ai/cordis) resolvable from
// the selected Mnemon package. Desktop's private loader may supply those only
// inside DSH; this script intentionally does not patch the profile or resolver.
const modules = process.env.DSH_MNEMON_NODE_MODULES ?? 'C:/Users/10340/.dsh/profiles/desktop/node_modules'
const installed = async path => import(pathToFileURL(resolve(modules, path)).href)
const { MemoryCompositionRunner } = await installed('dsh-mnemon/lib/testing.js')
const strategy = await installed('dsh-mnemon-strategy-default-three-tier/lib/index.js')
const { installMemory } = await installed('dsh-mnemon/lib/extension-sdk.js')
const state = { revision: 0, peerRevision: 0, block: { revision: 0, members: {}, facts: [{ text: 'QQ-only fact', updated: 1 }] } }
let writable = true
const store = {
  readPeer: async () => structuredClone(state),
  async mutatePeer(_key, callback, options) {
    assert.equal(options.expectedPeerRevision, state.peerRevision, 'CAS checks pinned revision')
    const next = structuredClone(state.block)
    const result = await callback(next)
    state.block = next; state.peerRevision++; state.revision++
    return { ...structuredClone(state), result, changed: true, receipt: { persisted: true } }
  },
}
const contribution = createQqMemoryContribution({ store, resolveScope: async scope => scope.sessionId === 'qq' ? 'qqbot:app:group:one' : undefined, canWrite: () => writable })
const qqPlugin = { name: 'qq-core-smoke', inject: ['mnemonMemory'], apply(ctx) { installMemory(ctx, contribution) } }
const globalPlugin = {
  name: 'global-core-smoke', inject: ['mnemonMemory'], apply(ctx) {
    installMemory(ctx, { sources: [{
      manifest: { apiVersion: 'dsh-mnemon/v1', kind: 'source', typeId: 'global-smoke', packageName: 'global-core-smoke', role: 'working-context', capabilities: ['project'], consistency: 'exact-snapshot' },
      create(context) { return {
        facts() { return { sourceInstanceKey: context.sourceInstanceKey, sourceTypeId: 'global-smoke', role: 'working-context', availability: 'ready', revision: '1', capabilities: ['project'], routeIds: [], actionIds: [] } },
        project(request) { return { fragments: request.includeProjection ? [{ id: 'global-fragment', sourceInstanceKey: context.sourceInstanceKey, mode: request.mode, text: 'GLOBAL-SECRET', revision: '1' }] : [] } },
      } },
    }] })
  },
}
const runner = new MemoryCompositionRunner({ strategyTypeId: 'default-three-tier' })
const turns = []
try {
  await runner.mount(strategy, { instanceId: 'strategy-smoke' })
  await runner.mount(globalPlugin, { instanceId: 'global-smoke' })
  await runner.mount(qqPlugin, { instanceId: 'qq-smoke' })
  const qq = await runner.beginTurn({ scope: { storage: 'global', sessionId: 'qq', agentId: 'qq' } }); turns.push(qq)
  assert.equal(qq.view.consistency.sourceRevisions && Object.keys(qq.view.consistency.sourceRevisions).length, 1)
  assert.match(qq.view.projection.map(fragment => fragment.text).join('\n'), /QQ-only fact/)
  assert.doesNotMatch(JSON.stringify(qq.view), /GLOBAL-SECRET/)
  assert.equal(qq.view.routes.length, 1)
  assert.equal(qq.view.actionOffers.length, 1)
  const evidence = await qq.executeRoute(qq.view.routes[0].id, { query: 'QQ-only' })
  assert.equal(evidence.items.length, 1)
  const receipt = await qq.executeAction(qq.view.actionOffers[0].id, { operation: 'add-fact', text: 'saved through actual Core' }, () => true)
  assert.equal(receipt.completion, 'committed')
  assert.equal(receipt.status, 'succeeded')
  assert.ok(receipt.committedAt)
  const web = await runner.beginTurn({ scope: { storage: 'global', sessionId: 'web', agentId: 'web' } }); turns.push(web)
  assert.match(web.view.projection.map(fragment => fragment.text).join('\n'), /GLOBAL-SECRET/)
  assert.doesNotMatch(JSON.stringify(web.view), /QQ-only fact/)
  writable = false
  const readonly = await runner.beginTurn({ scope: { storage: 'global', sessionId: 'qq', agentId: 'qq' } }); turns.push(readonly)
  assert.equal(readonly.view.actionOffers.length, 0)
  assert.equal(readonly.view.routes.length, 1)
  console.log('PASS installed Mnemon Core: real Fiber mounts, QQ-only View, non-QQ projection, Route Evidence, committed Action Receipt, readonly offer removal')
} finally {
  for (const turn of turns) turn.release()
  await runner.dispose()
}
