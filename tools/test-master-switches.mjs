// 功能总开关实时生效隔离测试：表情图库「自动收集」与错误拦截「启用错误拦截」。
// 跑法：node tools/test-master-switches.mjs
// 切换即单独持久化（不带未保存草稿）、失败回滚；其余字段仍走统一保存。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { CONFIG_DEFAULTS } from '../dsh-qqbot-ext/lib/config.js'

const source = await readFile(new URL('../dsh-qqbot-ext/client.js', import.meta.url), 'utf8')
const exposed = source
  .replace('    /** 错误拦截组件：友好提示/管理员转发/熔断参数。独立读取，保存只提交本组件字段（服务端合并写入）。 */',
    '    globalThis.ErrorGuardSection = ErrorGuardSection\n    /** 错误拦截组件：友好提示/管理员转发/熔断参数。独立读取，保存只提交本组件字段（服务端合并写入）。 */')
  .replace('    /** 表情包图库组件：唯一可编辑的组件。 */',
    '    globalThis.StickerLibrarySection = StickerLibrarySection\n    /** 表情包图库组件：唯一可编辑的组件。 */')
assert.notEqual(exposed, source)

function harness() {
  const defaults = { ...CONFIG_DEFAULTS }
  let serverConfig = { ...CONFIG_DEFAULTS, libraryDir: 'D:/lib', enabled: true, errorGuardEnabled: true }
  const initialConfigRef = serverConfig
  let data = { config: serverConfig, defaults, capabilities: { autoCollect: true, stickerCount: 4, stickerLimit: 300 }, components: [] }
  const setData = (next) => { data = typeof next === 'function' ? next(data) : next }
  const state = [], effects = [], requests = []
  let cursor = 0, override = null
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((v) => v != null) }),
    Fragment: 'fragment',
    useState(value) {
      const i = cursor++
      if (!(i in state)) state[i] = typeof value === 'function' ? value() : value
      return [state[i], (next) => { state[i] = typeof next === 'function' ? next(state[i]) : next }]
    },
    useRef(value) { const i = cursor++; if (!(i in state)) state[i] = { current: value }; return state[i] },
    useEffect(fn, deps) {
      const i = cursor++
      if (!(i in state) || deps.some((dep, index) => dep !== state[i][index])) { state[i] = deps; effects.push(fn) }
    },
  }
  const ok = (body) => ({ ok: true, status: 200, json: async () => body })
  const context = vm.createContext({
    console, setTimeout,
    window: { __ModuleLoader__: { load: ({ factory }) => factory(() => react) },
      crypto: { randomUUID: () => 'test-id' }, confirm: () => true,
      addEventListener() {}, removeEventListener() {} },
    fetch: async (url, options) => {
      const payload = options?.body ? JSON.parse(options.body) : undefined
      requests.push({ url, payload })
      if (override) return override(payload)
      if (!payload) return ok({ ok: true, config: serverConfig, defaults, capabilities: data.capabilities, components: [] })
      serverConfig = { ...serverConfig, ...payload.config }
      return ok({ ok: true, config: serverConfig, message: '设置已保存', libraryDir: serverConfig.libraryDir, count: 4 })
    },
  })
  vm.runInContext(exposed, context)
  let tree
  const flush = () => { while (effects.length) effects.shift()() }
  const renderEG = () => { cursor = 0; tree = context.ErrorGuardSection(); flush(); return tree }
  const renderSticker = () => { cursor = 0; tree = context.StickerLibrarySection({ data, setData, getWorkspace: () => undefined }); flush(); return tree }
  const settle = async (render) => { await new Promise((resolve) => setImmediate(resolve)); return render() }
  const nodes = (root = tree) => typeof root !== 'object' || root === null ? [] : [root, ...root.children.flatMap((child) => nodes(child))]
  const text = (node) => typeof node === 'object' ? node.children.map(text).join('') : String(node)
  const find = (predicate) => { const result = nodes().find(predicate); assert.ok(result, 'Expected UI element'); return result }
  const switchByLabel = (label) => find((node) => typeof node.type === 'function' && node.type.name === 'Switch' && node.props.label === label)
  const button = (label) => find((node) => node.type === 'button' && text(node) === label)
  return {
    requests, renderEG, renderSticker, settle, nodes, text, find, switchByLabel, button,
    get data() { return data }, get serverConfig() { return serverConfig }, initialConfigRef,
    override(fn) { override = fn }, get tree() { return tree },
  }
}

let cases = 0
const test = async (name, fn) => { await fn(); cases += 1; console.log(`ok ${cases} - ${name}`) }

await test('error-guard master switch persists immediately, single field', async () => {
  const ui = harness()
  ui.renderEG(); await ui.settle(ui.renderEG)
  ui.switchByLabel('启用错误拦截').props.onChange(false)
  await ui.settle(ui.renderEG)
  assert.deepEqual(ui.requests.at(-1).payload.config, { errorGuardEnabled: false })
  assert.equal(ui.switchByLabel('启用错误拦截').props.checked, false)
  assert.equal(ui.button('保存').props.disabled, true, 'no draft left to save')
  assert.match(ui.text(ui.tree), /实时生效/)
})

await test('error-guard toggle excludes unsaved drafts', async () => {
  const ui = harness()
  ui.renderEG(); await ui.settle(ui.renderEG)
  // harness 不实例化函数组件：直接调 TextAreaField 的 onChange（value 形态）。
  const noticeField = () => ui.find((node) => typeof node.type === 'function' && node.type.name === 'TextAreaField' && node.props.label === '友好提示正文')
  noticeField().props.onChange('draft notice')
  ui.renderEG()
  ui.switchByLabel('启用错误拦截').props.onChange(false)
  await ui.settle(ui.renderEG)
  assert.deepEqual(ui.requests.at(-1).payload.config, { errorGuardEnabled: false })
  assert.equal(noticeField().props.value, 'draft notice', 'draft preserved')
  assert.equal(ui.button('保存').props.disabled, false, 'draft still dirty')
})

await test('error-guard toggle failure reverts and reports not effective', async () => {
  const ui = harness()
  ui.renderEG(); await ui.settle(ui.renderEG)
  ui.override(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'boom' }) }))
  ui.switchByLabel('启用错误拦截').props.onChange(false)
  await ui.settle(ui.renderEG)
  assert.equal(ui.switchByLabel('启用错误拦截').props.checked, true, 'switch reverted')
  assert.match(ui.text(ui.tree), /开关保存失败（未生效）/)
})

await test('sticker master switch persists immediately and preserves drafts', async () => {
  const ui = harness()
  ui.renderSticker(); await ui.settle(ui.renderSticker)
  const dirInput = ui.find((node) => node.type === 'input' && node.props.placeholder === ui.data.defaults.libraryDir)
  dirInput.props.onChange({ currentTarget: { value: 'D:/draft-dir' } })
  ui.renderSticker()
  ui.switchByLabel('自动收集').props.onChange(false)
  await ui.settle(ui.renderSticker)
  assert.deepEqual(ui.requests.at(-1).payload.config, { enabled: false })
  assert.equal(ui.switchByLabel('自动收集').props.checked, false)
  assert.equal(ui.find((node) => node.type === 'input' && node.props.placeholder === ui.data.defaults.libraryDir).props.value, 'D:/draft-dir', 'draft preserved')
  assert.equal(ui.data.capabilities.autoCollect, false, 'overview stat synced')
  assert.equal(ui.data.config, ui.initialConfigRef, 'data.config identity untouched (no form-reset effect)')
  assert.equal(ui.button('保存').props.disabled, false, 'draft still dirty')
  assert.match(ui.text(ui.tree), /实时生效/)
})

await test('sticker toggle failure reverts and reports not effective', async () => {
  const ui = harness()
  ui.renderSticker(); await ui.settle(ui.renderSticker)
  ui.override(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'boom' }) }))
  ui.switchByLabel('自动收集').props.onChange(false)
  await ui.settle(ui.renderSticker)
  assert.equal(ui.switchByLabel('自动收集').props.checked, true, 'switch reverted')
  assert.match(ui.text(ui.tree), /开关保存失败（未生效）/)
})

console.log(`${cases} master-switch isolation tests passed; no real requests or configuration writes`)