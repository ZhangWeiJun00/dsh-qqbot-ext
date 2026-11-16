import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../dsh-qqbot-ext/client.js', import.meta.url), 'utf8')
// Export the real component only inside this isolated VM; production code stays unchanged.
const exposed = source.replace('    /** 总页：概览 + 组件切换。设置页与主面板共用同一份。 */',
  '    globalThis.RoleplaySection = RoleplaySection\n    /** 总页：概览 + 组件切换。设置页与主面板共用同一份。 */')
assert.notEqual(exposed, source)
const initial = () => ({ enabled: false, defaultCardId: '', cards: [], bindings: [] })
function harness(config = initial()) {
  const state = [], effects = [], requests = []
  let cursor = 0, uid = 0, responseOverride = null
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
  const context = vm.createContext({
    console, setTimeout,
    window: { __ModuleLoader__: { load: ({ factory }) => factory(() => react) },
      crypto: { randomUUID: () => `test-${++uid}` }, confirm: () => true,
      addEventListener() {}, removeEventListener() {} },
    fetch: async (url, options) => {
      const payload = options.body ? JSON.parse(options.body) : undefined
      requests.push({ url, payload })
      if (responseOverride) return responseOverride(payload)
      const body = !payload ? { ok: true, config, revision: 'revision-1' }
        : payload.action === 'import' ? { ok: true, card: { id: 'imported', name: payload.name || 'Imported', content: payload.content } }
          : { ok: true, revision: 'revision-2', config: { ...payload.config, cards: payload.config.cards.map((card) => ({ ...card, name: card.name.trim() })) } }
      return { ok: true, status: 200, json: async () => body }
    },
  })
  vm.runInContext(exposed, context)
  let tree
  const render = () => { cursor = 0; tree = context.RoleplaySection(); while (effects.length) effects.shift()(); return tree }
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); return render() }
  const nodes = (root = tree) => typeof root !== 'object' || root === null ? [] : [root, ...root.children.flatMap((child) => nodes(child))]
  const text = (node) => typeof node === 'object' ? node.children.map(text).join('') : String(node)
  const find = (predicate) => { const result = nodes().find(predicate); assert.ok(result, 'Expected UI element'); return result }
  const button = (label) => find((node) => node.type === 'button' && text(node) === label)
  const field = (label, tag) => {
    const wrapper = find((node) => node.type === 'label' && text(node).startsWith(label))
    return nodes(wrapper).find((node) => node.type === tag)
  }
  const change = (node, value) => { node.props.onChange({ currentTarget: { value } }); render() }
  const click = (label) => { button(label).props.onClick(); render() }
  const save = async () => { await find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} }); render() }
  render()
  return { render, settle, nodes, text, find, button, field, change, click, save, requests,
    override(fn) { responseOverride = fn }, get tree() { return tree } }
}

let cases = 0
async function test(name, run) { await run(); cases++; console.log(`ok ${cases} - ${name}`) }
await test('loads and renders QQ scope and binding formats', async () => {
  const ui = harness(); await ui.settle()
  assert.equal(ui.requests[0].url, '/qqbot-ext/roleplay')
  assert.match(ui.text(ui.tree), /仅对 QQ 会话生效/)
  assert.match(ui.text(ui.tree), /qqbot:appId:c2c:用户openid/)
  assert.match(ui.text(ui.tree), /group_openid/)
  assert.doesNotMatch(ui.text(ui.tree), /OneBot|NapCat|onebot:/)
})
await test('adds edits and saves normalized returned config', async () => {
  const ui = harness(); await ui.settle(); ui.click('新增')
  ui.change(ui.field('角色名称', 'input'), '  Whale  ')
  ui.change(ui.field('角色正文', 'textarea'), 'hello')
  assert.equal(ui.requests.length, 1)
  await ui.save()
  assert.equal(ui.requests.at(-1).payload.config.cards[0].content, 'hello')
  assert.equal(ui.field('角色名称', 'input').props.value, 'Whale')
  assert.equal(ui.button('保存全部配置').props.disabled, true)
  assert.equal(ui.requests.at(-1).payload.revision, 'revision-1')
  ui.change(ui.field('角色正文', 'textarea'), 'next edit')
  await ui.save()
  assert.equal(ui.requests.at(-1).payload.revision, 'revision-2')
})
await test('paste import only parses and appends to draft', async () => {
  const ui = harness(); await ui.settle()
  ui.change(ui.field('导入名称', 'input'), 'Whale')
  ui.change(ui.field('粘贴文本', 'textarea'), '{"description":"hi"}')
  await ui.button('解析并加入草稿').props.onClick(); ui.render()
  assert.equal(ui.requests.at(-1).payload.action, 'import')
  assert.equal(ui.requests.filter((request) => request.payload?.config).length, 0)
  assert.equal(ui.field('角色正文', 'textarea').props.value, '{"description":"hi"}')
})
await test('bindings preserve exact key and empty card disables default', async () => {
  const ui = harness(); await ui.settle(); ui.click('新增绑定')
  ui.change(ui.field('会话标识 1', 'input'), ' qqbot:app:c2c:user-openid ')
  await ui.save()
  const binding = ui.requests.at(-1).payload.config.bindings[0]
  assert.equal(binding.conversationKey, ' qqbot:app:c2c:user-openid ')
  assert.equal(binding.cardId, '')
})
await test('save failure preserves edited draft', async () => {
  const ui = harness(); await ui.settle(); ui.click('新增')
  ui.change(ui.field('角色正文', 'textarea'), 'unsaved')
  ui.override(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'test failure' }) }))
  await ui.save()
  assert.equal(ui.field('角色正文', 'textarea').props.value, 'unsaved')
  assert.match(ui.text(ui.tree), /保存失败，草稿已保留/)
  assert.equal(ui.button('保存全部配置').props.disabled, false)
})
await test('duplicate binding validation prevents network save', async () => {
  const ui = harness({ ...initial(), bindings: [{ conversationKey: 'same', cardId: '' }] }); await ui.settle()
  ui.click('新增绑定'); ui.change(ui.field('会话标识 2', 'input'), 'same'); await ui.save()
  assert.equal(ui.requests.length, 1)
  assert.match(ui.text(ui.tree), /会话绑定重复/)
})
await test('delete card clears default and binds explicit disable', async () => {
  const ui = harness({ enabled: true, defaultCardId: 'a', cards: [{ id: 'a', name: 'A', content: 'x' }], bindings: [{ conversationKey: 'qqbot:app:group:group-openid', cardId: 'a' }] })
  await ui.settle(); ui.click('删除当前角色'); await ui.save()
  const next = ui.requests.at(-1).payload.config
  assert.equal(next.defaultCardId, ''); assert.equal(next.cards.length, 0); assert.equal(next.bindings[0].cardId, '')
})
await test('oversized file rejected before reading', async () => {
  const ui = harness(); await ui.settle(); let read = false
  await ui.find((node) => node.type === 'input' && node.props.type === 'file').props.onChange({ currentTarget: { value: 'large.txt', files: [{ name: 'large.txt', size: 3 * 1024 * 1024 + 1, text() { read = true; throw new Error('must not read') } }] } })
  ui.render(); assert.equal(read, false); assert.equal(ui.requests.length, 1); assert.match(ui.text(ui.tree), /文件不能超过 3 MB/)
})
await test('file text parses into draft without save', async () => {
  const ui = harness(); await ui.settle()
  await ui.find((node) => node.type === 'input' && node.props.type === 'file').props.onChange({ currentTarget: { value: 'whale.md', files: [{ name: 'whale.md', size: 8, text: async () => 'role text' }] } })
  ui.render(); assert.equal(ui.requests.at(-1).payload.action, 'import'); assert.equal(ui.field('角色正文', 'textarea').props.value, 'role text')
})
await test('import failure preserves paste text', async () => {
  const ui = harness(); await ui.settle(); ui.change(ui.field('粘贴文本', 'textarea'), 'keep me')
  ui.override(async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: 'invalid card' }) }))
  await ui.button('解析并加入草稿').props.onClick(); ui.render()
  assert.equal(ui.field('粘贴文本', 'textarea').props.value, 'keep me'); assert.match(ui.text(ui.tree), /导入失败/)
})
await test('revision conflict preserves draft and asks to back up before reopening', async () => {
  const ui = harness(); await ui.settle(); ui.click('新增')
  ui.change(ui.field('角色正文', 'textarea'), 'local draft')
  ui.override(async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: 'conflict' }) }))
  await ui.save()
  assert.equal(ui.requests.at(-1).payload.revision, 'revision-1')
  assert.equal(ui.field('角色正文', 'textarea').props.value, 'local draft')
  assert.equal(ui.button('保存全部配置').props.disabled, false)
  assert.match(ui.text(ui.tree), /另一页面已更新角色配置，请先备份当前草稿并重新打开配置/)
  await ui.save()
  assert.equal(ui.requests.at(-1).payload.revision, 'revision-1')
})
console.log(`${cases} UI isolation tests passed; no real requests or configuration writes`)
