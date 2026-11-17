import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createCardInbox } from '../vendor/dsh-qqbot/ext/lib/qq-card-inbox.js'
import { register } from '../vendor/dsh-qqbot/ext/features/host/06-bilibili-video.js'
const base = new URL('../vendor/dsh-qqbot/', import.meta.url)
const text = path => readFile(new URL(path, base), 'utf8')
const pkg = JSON.parse(await text('package.json'))
assert.equal(pkg.name, '@tencent-connect/dsh-qqbot')
assert.equal(pkg.version, '0.5.5-local.1')
assert.ok(pkg.exports['./ext-agent'])
const preset = await text('ext/lib/preset-plugins.js')
assert.ok(preset.includes("name: '@tencent-connect/dsh-qqbot/ext-agent'"))
const index = await text('lib/index.js')
assert.ok(index.includes('await applyExtensions(ctx)'))
const patch = await text('cordis.patch.yml')
assert.ok(!patch.includes("name: 'dsh-qqbot-ext'"))
assert.ok(patch.includes("name: '@tencent-connect/dsh-qqbot/ext-routes'"))
const client = await text('lib/client.js')
assert.ok(client.includes("id: 'dsh-qqbot-ext'"))
const setup = await text('lib/gateway/middleware-setup.js')
const services = new Map(), tools = new Map(), middleware = [], events = []
const agent = { id: 'test-agent' }
const ctx = {
  provide: (name, value) => services.set(name, value),
  get: name => services.get(name),
  emit: async (name, value) => events.push({ name, value }),
  tools: { register: tool => tools.set(tool.name, tool) },
  systemPrompt: { section() {} },
}
const manager = { ctx, findByAgent: a => a === agent ? { sessionKey: 'qqbot:app:group:peer' } : undefined }
const context = vm.createContext({ console })
function synthetic(names) {
  return new vm.SyntheticModule(Object.keys(names), function () { for (const [key, value] of Object.entries(names)) this.setExport(key, value) }, { context })
}
const pass = () => async (_ctx, next) => next()
const sdk = Object.fromEntries(['errorHandler','messageFilter','accessPolicy','mentionGate','contentSanitizer','rateLimiter','concurrencyGuard','typingIndicator','quoteRef','historyBuffer','envelopeFormatter'].map(name => [name, pass]))
let slashCommands
sdk.slashCommand = (options) => { slashCommands = options.commands; return { middleware: pass() } }
const root = new vm.SourceTextModule(setup, { context })
await root.link(spec => {
  if (spec === '@tencent-connect/qqbot-nodejs') return synthetic(sdk)
  if (spec.endsWith('qq-card-inbox.js')) return synthetic({ createCardInbox })
  if (spec.endsWith('commands/index.js')) return synthetic({ buildCommandList: () => [] })
  if (spec.endsWith('middleware/attachment.js')) return synthetic({ attachmentProcessor: pass })
  if (spec.endsWith('middleware/question-answer.js')) return synthetic({ questionAnswer: pass })
  if (spec.endsWith('features/history-store.js')) return synthetic({ getHistoryStore: () => ({}), historyGroupKey: (app, gid) => app + gid })
  if (spec.endsWith('error-guard.js')) return synthetic({ breakerGate: async () => false, breakerCommand: () => ({ name: ['resume', 'breaker'], handler: async () => '' }), adminOnlyAuth: () => () => true, interceptTurnError: async () => ({ guarded: false, justTripped: false }), noteTurnSuccess: async () => {} })
  throw new Error('Unexpected import ' + spec)
})
await root.evaluate()
root.namespace.setupMiddlewares({ use: item => middleware.push(item) }, { appId: 'app', access: {} }, manager, { warn: console.warn })
register(ctx)
assert.ok(services.has('qqbotExtCardReader'))
let rawReads = 0
const message = { content: '[卡片消息] 小程序\ntitle: video', kind: 'group', groupOpenid: 'peer', messageId: 'card', senderId: 'sender', get raw() { rawReads++; return { meta: { detail_1: { qqdocurl: 'https://b23.tv/example' } } } } }
async function invoke(i) { if (i < middleware.length) await middleware[i]({ message }, () => invoke(i + 1)) }
await invoke(0)
assert.equal(rawReads, 0)
assert.equal(message.content, '[卡片消息] 小程序\ntitle: video')
const result = tools.get('qq_card_video_links').execute({}, { agent })
assert.equal(result.status, 'found')
assert.deepEqual(result.links, ['https://b23.tv/example'])
assert.equal(rawReads, 1)
assert.throws(() => tools.get('qq_card_video_links').execute({}, { agent: {} }), /无法确定当前QQ会话/)
// Ensure sticker event uses the real context, rather than an undeclared ctx.
await middleware.find(fn => fn.toString().includes('sticker-candidate'))({ message: { content: '【表情:测试】', attachments: [{ content_type: 'image/png', url: 'https://example.test/image' }] } }, async () => {})
assert.equal(events[0].name, 'qqbot/sticker-candidate')
assert.ok((await text('lib/gateway/bootstrap.js')).includes("ctx.provide('qqbotExtStickerSender'"))
assert.ok((await text('lib/gateway/bootstrap.js')).includes("ctx.provide('qqbotExtSessionRotator'"))
// 错误拦截：outbound 接线 + 熔断闸门在表情钩子之后、并发守卫之前。
assert.ok((await text('lib/transport/outbound.js')).includes('interceptTurnError'))
const gateIndex = middleware.findIndex(fn => fn.toString().includes('breakerGate'))
const stickerIndex = middleware.findIndex(fn => fn.toString().includes('sticker-candidate'))
assert.ok(gateIndex > stickerIndex, 'breaker gate sits after the sticker hook (before concurrency guard)')
assert.ok(slashCommands.some(cmd => (Array.isArray(cmd.name) ? cmd.name : [cmd.name]).includes('resume')), '/resume command registered in the slash list (help-visible)')
assert.ok((await text('LICENSE')).includes('MIT'))
// Merged client bundle: the boot graph has one entry per package, so both factories
// must register under the package id in a single .load; verify slots from both land.
const registrations = []
const fakeWindow = { __ModuleLoader__: { load: (reg) => registrations.push(reg) } }
const fakeDocument = { getElementById: () => null, createElement: () => ({ textContent: '' }), head: { appendChild() {} }, visibilityState: 'visible' }
new Function('window', 'document', 'fetch', 'console', client)(fakeWindow, fakeDocument, async () => ({ ok: true, json: async () => ({}) }), console)
assert.equal(registrations.length, 1, 'single client registration under the package id')
assert.equal(registrations[0].id, '@tencent-connect/dsh-qqbot')
const clientModule = registrations[0].factory((name) => { if (name === 'react') return { createElement: () => null }; throw new Error('unexpected require ' + name) })
assert.equal(clientModule.name, 'im-qqbot-client')
assert.ok(clientModule.inject.includes('slots') && clientModule.inject.includes('sidebarRightTabs'), 'inject union keeps upstream services')
const slotRegs = []
const pageRegs = []
const effectCleanups = []
const makeSlots = (sink) => ({ inject: (_n, cb) => cb(), register: (opts) => { sink.push(opts); return () => {} } })
const clientCtx = {
  slots: makeSlots(slotRegs),
  inject: (_names, cb) => cb({ slots: makeSlots(pageRegs), layout: { selectPanel() {} } }),
  effect: (fn) => { effectCleanups.push(fn) },
}
const clientCleanup = clientModule.apply(clientCtx)
const slotIds = [...slotRegs, ...pageRegs].map((o) => `${o.name}:${o.id ?? o.key}`)
for (const expected of ['settings.section:qqbot', 'settings.section:qqbot-ext', 'main:im-qqbot', 'main:qqbot-ext', 'sidebar.panellist:im-qqbot', 'sidebar.panellist:qqbot-ext', 'plugins.detail.actions:im-qqbot-open']) {
  assert.ok(slotIds.includes(expected), 'missing client slot ' + expected)
}
assert.equal(typeof clientCleanup, 'function')
clientCleanup()
for (const fn of effectCleanups) fn()
console.log('PASS integrated manifest, host/client/preset/route wiring; actual middleware + tool read; zero raw access before call; peer isolation; sticker context; sender registration and license; merged client registers both panels')
