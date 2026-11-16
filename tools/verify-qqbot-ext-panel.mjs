// 校验 dsh-qqbot-ext 的 Web 面板 + 配置接口（无需浏览器）。
// 跑法：node tools/verify-qqbot-ext-panel.mjs
//
// 这个脚本会读写真实的 ~/.dsh-qqbot-ext/config.json（配置读写本来就该测真的），
// 所以开头先原样备份、结尾无论如何都还原：断言失败也会走 finally，
// 崩溃时再由 process 的 exit/uncaughtException 钩子兜一层，绝不把用户配置留在测试值上。
import assert from 'node:assert/strict'
import { readFile, rm, mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 相对本脚本定位插件目录，clone 到哪都能跑（不写死盘符）。
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', 'dsh-qqbot-ext').replace(/\\/g, '/')
if (!existsSync(join(ROOT, 'package.json'))) {
  console.error(`找不到插件目录：${ROOT}\n这个脚本要放在插件仓库根目录的 tools/ 下运行。`)
  process.exit(1)
}
const CONFIG_PATH = join(homedir(), '.dsh-qqbot-ext', 'config.json')
const CONFIG_BACKUP = `${CONFIG_PATH}.verify-backup`
const hadConfig = existsSync(CONFIG_PATH)
const originalConfig = hadConfig ? await readFile(CONFIG_PATH, 'utf8') : undefined
if (hadConfig) await writeFile(CONFIG_BACKUP, originalConfig, 'utf8')

/** 还原测试前的用户配置（同步版，供 exit 钩子使用；幂等）。 */
let restored = false
function restoreConfigSync() {
  if (restored) return
  restored = true
  if (hadConfig) {
    writeFileSync(CONFIG_PATH, originalConfig, 'utf8')
    try { rmSync(CONFIG_BACKUP, { force: true }) } catch { /* ignore */ }
    return
  }
  try { rmSync(CONFIG_PATH, { force: true }) } catch { /* ignore */ }
}

/** 异步版，主流程末尾用。 */
async function restoreConfig() {
  if (restored) return
  restored = true
  if (hadConfig) {
    await writeFile(CONFIG_PATH, originalConfig, 'utf8')
    await rm(CONFIG_BACKUP, { force: true })
    return
  }
  await rm(CONFIG_PATH, { force: true })
}

// 崩了也要还原：断言失败会先走 finally，这里再兜底覆盖异常路径。
process.on('exit', () => { try { restoreConfigSync() } catch { /* ignore */ } })
process.on('uncaughtException', (error) => {
  try { restoreConfigSync() } catch { /* ignore */ }
  console.error('\n✗ 断言失败，已把 config.json 还原到测试前状态：')
  console.error(error)
  process.exit(1)
})

let passed = 0
const ok = (name) => { passed += 1; console.log(`  ✓ ${name}`) }

// ── 1. 客户端面板 ─────────────────────────────────────────────
const clientSrc = await readFile(`${ROOT}/client.js`, 'utf8')
const sample = {
  ok: true,
  version: '0.2.0',
  components: [
    { id: 'sticker-library', title: '表情包图库', summary: '自动收集别人发的表情包。', editable: true, toolInfo: [{ name: 'qq_list_stickers', description: '列出图库' }] },
    { id: 'ext-tools', title: '示例工具', summary: '调试工具。', editable: false, toolInfo: [{ name: 'ext_now', description: '报时间' }] },
  ],
  capabilities: { autoCollect: true, collectMode: 'auto', stickerCount: 4, stickerLimit: 300, pendingCount: 0, libraryExists: true },
  config: { enabled: true, collectMode: 'auto', libraryDir: 'D:/x', minBytes: 1, maxBytes: 2, minEdge: 1, maxEdge: 2, maxAspect: 2, maxLibrary: 3, pendingLimit: 50, judgeEnabled: false, judgeProvider: '', judgeModel: '', judgePrompt: '', judgeMaxTokens: 200, judgeTimeoutMs: 60000 },
  libraryDir: 'D:/x',
  libraryExists: true,
  count: 4,
  defaults: {
    enabled: true,
    collectMode: 'auto',
    libraryDir: 'D:/def',
    minBytes: 1024,
    maxBytes: 6291456,
    minEdge: 48,
    maxEdge: 2048,
    maxAspect: 2,
    maxLibrary: 300,
    pendingLimit: 50,
    judgeEnabled: false,
    judgeProvider: '',
    judgeModel: '',
    judgePrompt: '',
    judgeMaxTokens: 200,
    judgeTimeoutMs: 60000,
  },
}
globalThis.fetch = async () => ({ ok: true, json: async () => sample })
globalThis.document = undefined

const hookStore = new Map()
let path = []
let effects = []
const R = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  _i: 0,
  useState(init) {
    const key = path.join('>')
    let hooks = hookStore.get(key)
    if (hooks === undefined) { hooks = []; hookStore.set(key, hooks) }
    const index = this._i++
    if (!(index in hooks)) hooks[index] = typeof init === 'function' ? init() : init
    return [hooks[index], (v) => { hooks[index] = typeof v === 'function' ? v(hooks[index]) : v }]
  },
  useEffect(fn) { effects.push(fn); this._i += 1 },
  useCallback(fn) { this._i += 1; return fn },
}
const instantiate = (node) => {
  if (node === null || node === undefined) return null
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) }
  if (Array.isArray(node)) return node.map(instantiate)
  if (typeof node.type === 'function') {
    path.push(`${node.type.name}#${path.length}`)
    const saved = R._i
    R._i = 0
    const out = node.type(node.props)
    R._i = saved
    const inner = instantiate(out)
    path.pop()
    return inner
  }
  return { tag: node.type, props: node.props, children: (node.children ?? []).map(instantiate) }
}
const render = (root) => { R._i = 0; effects = []; return instantiate(root) }

globalThis.window = { __ModuleLoader__: { load: (reg) => { globalThis.__reg = reg } } }
await new Function(clientSrc)()
const clientModule = globalThis.__reg.factory(() => R)
assert.deepEqual(clientModule.inject, ['slots'])
ok('client bundle declares only slots (panel loads unconditionally)')

const registered = []
const ctx = {
  slots: { inject: (_key, cb) => cb(), register: (options, component) => { registered.push([options, component]); return () => {} } },
  inject: (_names, cb) => cb({ slots: ctx.slots, layout: {} }),
}
clientModule.apply(ctx)
const slots = registered.map(([options]) => `${options.name}:${options.id ?? options.key}`)
assert.deepEqual(slots, ['settings.section:qqbot-ext', 'main:qqbot-ext', 'sidebar.panellist:qqbot-ext'])
ok('registers settings section + main panel + sidebar entry')

assert.equal(registered[0][0].label(), 'QQ 机器人扩展')
assert.equal(registered[2][0].label(), 'QQ 机器人扩展')
ok('panel is titled 「QQ 机器人扩展」, not the sticker library')

const Page = registered[1][1]
render(Page({}))
for (const effect of effects) { const cleanup = effect(); void cleanup }
await new Promise((resolve) => setTimeout(resolve, 20))
const tree = render(Page({}))
const tags = []
const texts = []
const walk = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(walk); return }
  if (node.tag) tags.push(node.tag)
  if (node.text !== undefined) texts.push(node.text)
  ;(node.children ?? []).forEach(walk)
}
walk(tree)
const all = texts.join('\n')
assert.ok(tags.includes('h1'), 'overview title rendered')
assert.ok(tags.includes('form'), 'sticker library form rendered')
assert.ok(all.includes('QQ 机器人扩展'), 'title text')
assert.ok(all.includes('表情包图库'), 'sticker component tab')
assert.ok(all.includes('示例工具'), 'second component tab')
assert.ok(!all.includes('小黄脸'), 'removed QQ face component is gone')
assert.ok(all.includes('图库保存位置'), 'library path field')
assert.ok(all.includes('图库张数'), 'overview stat')
ok('overview + component tabs + sticker form all render')

// 每个配置项都要有「恢复默认」按钮（7 个字段 + 1 个「全部恢复」）
const resetButtons = []
const collectResets = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectResets); return }
  const cls = node.props?.className
  if (typeof cls === 'string' && cls.split(/\s+/).includes('qbe-reset')) resetButtons.push(node.props)
  ;(node.children ?? []).forEach(collectResets)
}
collectResets(tree)
const resetLabels = resetButtons.map((props) => props['aria-label'] ?? '')
const expectedLabels = ['自动收集', '收集方式', '图库保存位置', '张数上限', '暂存上限', '开启后台自动判断', '视觉模型', '判定提示词', '判断输出 token 上限', '判断超时（毫秒）', '最小字节', '最大字节', '最小长边（像素）', '最大长边（像素）', '最大长宽比']
for (const label of expectedLabels) {
  assert.ok(resetLabels.includes(`恢复默认：${label}`), `missing reset button for ${label}`)
}
assert.equal(resetButtons.length, expectedLabels.length)
ok(`each config field has its own reset button (${expectedLabels.length})`)

// 当前值与默认值一致的项，按钮应禁用（用一份「全部等于默认」的配置验证）
const cleanSample = { ...sample, config: { ...sample.defaults } }
globalThis.fetch = async () => ({ ok: true, json: async () => cleanSample })
hookStore.clear()
render(Page({}))
for (const effect of effects) { const cleanup = effect(); void cleanup }
await new Promise((resolve) => setTimeout(resolve, 20))
const cleanTree = render(Page({}))
const cleanResets = []
const collectClean = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectClean); return }
  const cls = node.props?.className
  if (typeof cls === 'string' && cls.split(/\s+/).includes('qbe-reset')) cleanResets.push(node.props)
  ;(node.children ?? []).forEach(collectClean)
}
collectClean(cleanTree)
assert.equal(cleanResets.length, expectedLabels.length)
assert.ok(cleanResets.every((props) => props.disabled === true), 'reset disabled when already default')
ok('reset button disables when the field already equals its default')

// 收集方式是二选一分段控件，默认「全收」
const segments = []
const collectSegments = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectSegments); return }
  const cls = node.props?.className
  if (typeof cls === 'string' && cls.split(/\s+/).includes('qbe-segment')) segments.push(node)
  ;(node.children ?? []).forEach(collectSegments)
}
collectSegments(cleanTree)
assert.equal(segments.length, 2, 'two collect-mode segments')
const segmentLabels = segments.map((node) => JSON.stringify(node.children ?? []))
assert.ok(segmentLabels.some((text) => text.includes('全收')), '全收 option present')
assert.ok(segmentLabels.some((text) => text.includes('模型判断')), '模型判断 option present')
assert.equal(segments.filter((node) => node.props['aria-checked'] === true).length, 1, 'exactly one selected')
assert.ok(
  JSON.stringify(segments.find((node) => node.props['aria-checked'] === true).children).includes('全收'),
  'default mode is 全收 (auto)',
)
ok('collect mode is a two-way segmented control defaulting to 全收')

// 后台判断：开关 + provider/model + 提示词 都要在页面上可配
const judgeLabels = []
const collectJudgeLabels = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectJudgeLabels); return }
  if (node.props?.['aria-label']?.startsWith?.('恢复默认：')) judgeLabels.push(node.props['aria-label'])
  ;(node.children ?? []).forEach(collectJudgeLabels)
}
collectJudgeLabels(cleanTree)
for (const label of ['视觉模型', '判定提示词', '开启后台自动判断']) {
  assert.ok(judgeLabels.includes(`恢复默认：${label}`), `missing judge control: ${label}`)
}
const textareas = []
const collectTextareas = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectTextareas); return }
  if (node.tag === 'textarea') textareas.push(node)
  ;(node.children ?? []).forEach(collectTextareas)
}
collectTextareas(cleanTree)
assert.equal(textareas.length, 1, 'the judge prompt is a textarea')
ok('judge settings (provider/model/prompt) are configurable in the panel')

// 从「全默认」出发只改一项：只有那一项的按钮可用
const dirtySample = {
  ...sample,
  config: { ...sample.defaults, maxLibrary: 999 },
}
globalThis.fetch = async () => ({ ok: true, json: async () => dirtySample })
hookStore.clear()
render(Page({}))
for (const effect of effects) { const cleanup = effect(); void cleanup }
await new Promise((resolve) => setTimeout(resolve, 20))
const dirtyTree = render(Page({}))
const dirtyResets = []
const collectDirty = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectDirty); return }
  const cls = node.props?.className
  if (typeof cls === 'string' && cls.split(/\s+/).includes('qbe-reset')) dirtyResets.push(node.props)
  ;(node.children ?? []).forEach(collectDirty)
}
collectDirty(dirtyTree)
const enabled = dirtyResets.filter((props) => props.disabled !== true).map((props) => props['aria-label'])
assert.deepEqual(enabled.sort(), ['恢复默认：张数上限'].sort())
ok('only the changed field offers an enabled reset')
globalThis.fetch = async () => ({ ok: true, json: async () => sample })
hookStore.clear()

const SettingsSection = registered[0][1]
render(SettingsSection({}))
for (const effect of effects) { const cleanup = effect(); void cleanup }
await new Promise((resolve) => setTimeout(resolve, 20))
const settingsTree = render(SettingsSection({}))
const settingsTexts = []
const walk2 = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(walk2); return }
  if (node.text !== undefined) settingsTexts.push(node.text)
  ;(node.children ?? []).forEach(walk2)
}
walk2(settingsTree)
const settingsAll = settingsTexts.join('\n')
assert.ok(!settingsAll.includes('QQ 机器人扩展：表情包图库、QQ 表情检索'), 'embedded settings section skips the big subtitle')
assert.ok(settingsAll.includes('表情包图库'), 'settings section still shows components')
ok('settings section embeds without duplicating the page title')

// 「选择目录」按钮走宿主目录选择器：先 __DSH_DIRECTORY_PICKER__，再 uiWorkspace.pickDirectory()
const pickCalls = []
const fakeWorkspace = {
  async pickDirectory() { pickCalls.push(Date.now()); return 'D:/picked/library' },
}
hookStore.clear()
globalThis.fetch = async () => ({ ok: true, json: async () => sample })
const withPicker = []
const pickerCtx = {
  slots: { inject: (_k, cb) => cb(), register: (options, component) => { withPicker.push([options, component]); return () => {} } },
  inject: (_names, cb) => cb({ slots: pickerCtx.slots, layout: {} }),
  get: (name) => (name === 'uiWorkspace' ? fakeWorkspace : undefined),
}
clientModule.apply(pickerCtx)
assert.ok(!clientModule.inject.includes('uiWorkspace'), 'uiWorkspace must not be a hard dependency')
const injectedPicker = withPicker[0][0].inject()
assert.equal(typeof injectedPicker.getWorkspace, 'function')
assert.equal(injectedPicker.getWorkspace(), fakeWorkspace)
ok('uiWorkspace is resolved lazily, not declared as a hard dependency')

const PickerPage = withPicker[1][1]
const getWorkspace = () => fakeWorkspace
render(PickerPage({ getWorkspace }))
for (const effect of effects) { const cleanup = effect(); void cleanup }
await new Promise((resolve) => setTimeout(resolve, 20))
const pickerTree = render(PickerPage({ getWorkspace }))
const buttons = []
const collectButtons = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectButtons); return }
  if (node.tag === 'button') buttons.push(node)
  ;(node.children ?? []).forEach(collectButtons)
}
collectButtons(pickerTree)
const chooseButton = buttons.find((node) => JSON.stringify(node.children ?? []).includes('选择目录'))
assert.ok(chooseButton, 'a 「选择目录」 button is rendered')
assert.ok(!buttons.some((node) => JSON.stringify(node.children ?? []).includes('创建目录')), 'the old 「创建目录」 button is gone')
await chooseButton.props.onClick()
assert.equal(pickCalls.length, 1, 'clicking the button opens the host picker once')
ok('「选择目录」calls uiWorkspace.pickDirectory()')

// 「打开目录」：交给宿主在文件管理器里打开，浏览器自己做不到
const openCalls = []
globalThis.fetch = async (url, init) => {
  if (String(url).includes('open-folder')) {
    openCalls.push({ url: String(url), method: init?.method, body: init?.body })
    return { ok: true, status: 200, json: async () => ({ ok: true, dir: 'D:/临时文件/picture', target: 'library' }) }
  }
  return { ok: true, status: 200, json: async () => sample }
}
hookStore.clear()
render(PickerPage({ getWorkspace }))
for (const effect of effects) { const cleanup = effect(); void cleanup }
await new Promise((resolve) => setTimeout(resolve, 20))
const openTree = render(PickerPage({ getWorkspace }))
const openButtons = []
const collectOpen = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectOpen); return }
  if (node.tag === 'button') openButtons.push(node)
  ;(node.children ?? []).forEach(collectOpen)
}
collectOpen(openTree)
const openButton = openButtons.find((node) => JSON.stringify(node.children ?? []).includes('打开目录'))
assert.ok(openButton, 'a 「打开目录」 button is rendered next to 选择目录')
assert.equal(String(openButton.props.className).includes('qbe-mini'), true, 'styled like the sibling button')
await openButton.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 20))
assert.equal(openCalls.length, 1, 'clicking it calls the host route once')
assert.equal(openCalls[0].url, '/qqbot-ext/open-folder')
assert.equal(openCalls[0].method, 'POST', 'must be POST, not a GET that a stray link could trigger')
assert.deepEqual(JSON.parse(openCalls[0].body), { target: 'library' })
ok('「打开目录」posts to the host to reveal the library folder')

// 宿主报错时提示要就近显示，不能静默
globalThis.fetch = async (url) => {
  if (String(url).includes('open-folder')) {
    return { ok: false, status: 500, json: async () => ({ ok: false, error: '打不开文件管理器：spawn failed' }) }
  }
  return { ok: true, status: 200, json: async () => sample }
}
hookStore.clear()
render(PickerPage({ getWorkspace }))
for (const effect of effects) { const cleanup = effect(); void cleanup }
await new Promise((resolve) => setTimeout(resolve, 20))
const failTree = render(PickerPage({ getWorkspace }))
const failButtons = []
const collectFail = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectFail); return }
  if (node.tag === 'button') failButtons.push(node)
  ;(node.children ?? []).forEach(collectFail)
}
collectFail(failTree)
const failButton = failButtons.find((node) => JSON.stringify(node.children ?? []).includes('打开目录'))
await failButton.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 20))
const failTexts = []
const collectFailText = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectFailText); return }
  if (node.text !== undefined) failTexts.push(node.text)
  ;(node.children ?? []).forEach(collectFailText)
}
collectFailText(render(PickerPage({ getWorkspace })))
assert.ok(failTexts.join('\n').includes('spawn failed'), 'surfaces the host error inline')
globalThis.fetch = async () => ({ ok: true, json: async () => sample })
ok('「打开目录」surfaces host errors inline')

// Desktop preload 注入的全局优先于 uiWorkspace
const desktopCalls = []
globalThis.__DSH_DIRECTORY_PICKER__ = { async pick() { desktopCalls.push(Date.now()); return 'D:/from-preload' } }
hookStore.clear()
render(PickerPage({ getWorkspace: () => fakeWorkspace }))
for (const effect of effects) { const cleanup = effect(); void cleanup }
await new Promise((resolve) => setTimeout(resolve, 20))
const preloadTree = render(PickerPage({ getWorkspace: () => fakeWorkspace }))
const preloadButtons = []
const collectPreload = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectPreload); return }
  if (node.tag === 'button') preloadButtons.push(node)
  ;(node.children ?? []).forEach(collectPreload)
}
collectPreload(preloadTree)
const preloadButton = preloadButtons.find((node) => JSON.stringify(node.children ?? []).includes('选择目录'))
await preloadButton.props.onClick()
assert.equal(desktopCalls.length, 1, 'preload bridge takes priority')
assert.equal(pickCalls.length, 1, 'uiWorkspace not used when preload exists')
delete globalThis.__DSH_DIRECTORY_PICKER__
ok('__DSH_DIRECTORY_PICKER__ takes priority over uiWorkspace')

// 两条路都不可用时，提示要就近显示并带诊断信息
const NoPickerPage = withPicker[1][1]
const noWorkspace = () => undefined
hookStore.clear()
render(NoPickerPage({ getWorkspace: noWorkspace }))
for (const effect of effects) { const cleanup = effect(); void cleanup }
await new Promise((resolve) => setTimeout(resolve, 20))
const noPickerTree = render(NoPickerPage({ getWorkspace: noWorkspace }))
const noPickerButtons = []
const collectNoPicker = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectNoPicker); return }
  if (node.tag === 'button') noPickerButtons.push(node)
  ;(node.children ?? []).forEach(collectNoPicker)
}
collectNoPicker(noPickerTree)
const fallback = noPickerButtons.find((node) => JSON.stringify(node.children ?? []).includes('选择目录'))
await fallback.props.onClick()
const afterFallback = render(NoPickerPage({ getWorkspace: noWorkspace }))
const fallbackTexts = []
const collectText = (node) => {
  if (!node) return
  if (Array.isArray(node)) { node.forEach(collectText); return }
  if (node.text !== undefined) fallbackTexts.push(node.text)
  ;(node.children ?? []).forEach(collectText)
}
collectText(afterFallback)
const fallbackText = fallbackTexts.join('\n')
assert.ok(fallbackText.includes('没能连上'), 'shows a readable fallback message')
assert.ok(fallbackText.includes('诊断'), 'includes diagnostics')
ok('unavailable picker degrades to a readable hint with diagnostics')

globalThis.fetch = async () => ({ ok: true, json: async () => sample })
hookStore.clear()

// ── 2. 配置接口 ───────────────────────────────────────────────
const makeReq = (body, method = 'GET', origin) => {
  const chunks = body === undefined ? [] : [Buffer.from(body)]
  return { method, headers: { host: '127.0.0.1:1', ...(origin ? { origin } : {}) }, async *[Symbol.asyncIterator]() { yield* chunks } }
}
const makeRes = () => { const out = { status: 0, body: '' }; return { out, writeHead(s) { out.status = s }, end(b) { out.body = b } } }

const { register } = await import(`file:///${ROOT}/features/routes/01-sticker-config.js`)
const routes = {}
register({ webServer: { register: (route) => { routes[route.path] = route.handler } } })
assert.deepEqual(Object.keys(routes).sort(), ['/qqbot-ext/config', '/qqbot-ext/sticker-config'])
ok('config route served at /qqbot-ext/config (+ legacy alias)')

// ── 2.5 视觉模型自动探测 ──────────────────────────────────────
const { register: registerVision } = await import(`file:///${ROOT}/features/routes/02-vision-models.js`)
const visionRoutes = {}
const fakeLlm = {
  async listProviders() {
    return ['easy-cliproxyapi', { id: 'broken-provider' }]
  },
  async listModels(provider) {
    if (provider === 'broken-provider') throw new Error('adapter exploded')
    return [
      { provider, id: 'mimo-v2.6-pro', name: 'Mimo 2.6 Pro', inputModalities: ['text', 'image'] },
      { provider, id: 'deepseek-v4.1-flash', name: 'DS Flash', inputModalities: ['text'] },
      { provider, id: 'no-modality-info', name: 'No Info' },
    ]
  },
}
registerVision({
  webServer: { register: (route) => { visionRoutes[route.path] = route.handler } },
  get: (name) => (name === 'llm' ? fakeLlm : undefined),
})
assert.deepEqual(Object.keys(visionRoutes), ['/qqbot-ext/vision-models'])

const vres = makeRes()
await visionRoutes['/qqbot-ext/vision-models'](makeReq(), vres)
const catalog = JSON.parse(vres.out.body)
assert.equal(catalog.ok, true)
assert.equal(catalog.providers.length, 2, 'every registered provider is listed')
const cliproxy = catalog.providers.find((p) => p.id === 'easy-cliproxyapi')
assert.equal(cliproxy.models.length, 3)
assert.deepEqual(
  cliproxy.models.filter((m) => m.vision).map((m) => m.id),
  ['mimo-v2.6-pro'],
  'only models advertising image input count as vision',
)
assert.equal(cliproxy.models.find((m) => m.id === 'no-modality-info').vision, false, 'no modality info = not assumed')
assert.equal(catalog.visionCount, 1)
const broken = catalog.providers.find((p) => p.id === 'broken-provider')
assert.deepEqual(broken.models, [], 'a provider whose adapter throws does not break the response')
ok('vision models are detected from the host llm service and filtered by image input')

// 没提供 llm 服务时不能崩，要给出可读原因让人手填
const noLlm = {}
registerVision({
  webServer: { register: (route) => { noLlm[route.path] = route.handler } },
  get: () => undefined,
})
const nres = makeRes()
await noLlm['/qqbot-ext/vision-models'](makeReq(), nres)
const noLlmBody = JSON.parse(nres.out.body)
assert.equal(noLlmBody.ok, false)
assert.deepEqual(noLlmBody.providers, [])
assert.ok(noLlmBody.error.includes('手动填') || noLlmBody.error.includes('手填'), 'explains the manual fallback')
ok('missing llm service degrades to a readable hint instead of crashing')

// 只允许 GET
const mres = makeRes()
await visionRoutes['/qqbot-ext/vision-models'](makeReq(undefined, 'POST'), mres)
assert.equal(mres.out.status, 405)
ok('vision model probe rejects non-GET methods')

// ── 2.6 打开目录 ──────────────────────────────────────────────
// 测试期间不真的弹窗：这条开关让路由只做路径解析，不调 explorer。
process.env.QBE_NO_SHELL_OPEN = '1'
const { writeConfig: writeCfg } = await import(`file:///${ROOT}/lib/config.js`)
const { register: registerOpen } = await import(`file:///${ROOT}/features/routes/03-open-folder.js`)
const openRoutes = {}
registerOpen({ webServer: { register: (route) => { openRoutes[route.path] = route.handler } } })
assert.deepEqual(Object.keys(openRoutes), ['/qqbot-ext/open-folder'])

// 只收 POST：GET 不能被顺手点开（防跨站诱导）
let ores = makeRes()
await openRoutes['/qqbot-ext/open-folder'](makeReq(undefined, 'GET'), ores)
assert.equal(ores.out.status, 405)
ok('open-folder rejects GET')

// 跨源必须拒绝
ores = makeRes()
await openRoutes['/qqbot-ext/open-folder'](makeReq('{"target":"library"}', 'POST', 'https://evil.example'), ores)
assert.equal(ores.out.status, 403)
ok('open-folder rejects cross-origin requests')

// 打开的是配置里的图库目录（不存在的目录会被建出来）
const openDir = await mkdtemp(join(tmpdir(), 'qbe-open-'))
await writeCfg({ libraryDir: openDir })
ores = makeRes()
await openRoutes['/qqbot-ext/open-folder'](makeReq('{"target":"library"}', 'POST'), ores)
const opened = JSON.parse(ores.out.body)
assert.equal(opened.dir, openDir, 'opens the configured library dir')
assert.equal(opened.ok, true, `unexpected error: ${opened.error}`)
ok('open-folder targets the configured library directory')

// pending 目标指向暂存区，而不是图库
ores = makeRes()
await openRoutes['/qqbot-ext/open-folder'](makeReq('{"target":"pending"}', 'POST'), ores)
const openedPending = JSON.parse(ores.out.body)
assert.ok(openedPending.dir.includes('.pending'), 'pending target resolves to the staging dir')
assert.notEqual(openedPending.dir, openDir)
ok('open-folder can reveal the pending area separately')

// 坏 body 不能让按钮失效：退回默认图库
ores = makeRes()
await openRoutes['/qqbot-ext/open-folder'](makeReq('not json at all', 'POST'), ores)
const fallbackBody = JSON.parse(ores.out.body)
assert.equal(fallbackBody.dir, openDir, 'malformed body falls back to the library target')
ok('open-folder tolerates a malformed body')

await rm(openDir, { recursive: true, force: true })
await rm(`${openDir}.pending`, { recursive: true, force: true })

let res = makeRes()
await routes['/qqbot-ext/config'](makeReq(), res)
const overview = JSON.parse(res.out.body)
assert.equal(overview.ok, true)
assert.equal(overview.version, '0.2.0')
assert.equal(overview.components.length, 2)
assert.equal(overview.components[0].id, 'sticker-library')
assert.equal(overview.components[0].editable, true)
assert.ok(!overview.components.some((component) => component.id === 'qq-faces' || component.tools.includes('qq_list_faces')))
assert.ok(overview.capabilities && typeof overview.capabilities.stickerCount === 'number')
ok('GET returns overview + component list + capabilities')

// defaults 必须是完整的一份，页面每个「恢复默认」按钮才都有值可用
const defaultKeys = ['enabled', 'libraryDir', 'minBytes', 'maxBytes', 'minEdge', 'maxEdge', 'maxAspect', 'maxLibrary']
for (const key of defaultKeys) {
  assert.ok(overview.defaults && overview.defaults[key] !== undefined, `defaults.${key} missing`)
}
assert.equal(overview.defaults.maxBytes, 6291456)
assert.equal(overview.defaults.maxLibrary, 300)
assert.equal(overview.defaults.enabled, true)
ok('GET ships a complete defaults object for every field')

res = makeRes()
await routes['/qqbot-ext/config'](makeReq('{}', 'POST', 'http://evil.test'), res)
assert.equal(res.out.status, 403)
ok('rejects cross-origin writes')

res = makeRes()
await routes['/qqbot-ext/config'](makeReq(JSON.stringify({ config: { libraryDir: 'relative/dir' } }), 'POST'), res)
assert.equal(res.out.status, 400)
ok('rejects a relative library path')

const tempDir = await mkdtemp(join(tmpdir(), 'qbe-verify-'))
res = makeRes()
await routes['/qqbot-ext/config'](makeReq(JSON.stringify({ config: { libraryDir: tempDir, maxLibrary: 42 } }), 'POST'), res)
const saved = JSON.parse(res.out.body)
assert.equal(saved.ok, true)
assert.equal(saved.libraryDir, tempDir)
assert.equal(saved.config.maxLibrary, 42)
ok('saves libraryDir + thresholds')

res = makeRes()
await routes['/qqbot-ext/config'](makeReq(), res)
assert.equal(JSON.parse(res.out.body).libraryDir, tempDir)
ok('GET reflects the saved location')

// 手填一个还不存在的目录时，保存过程应把它建出来
const freshDir = join(tempDir, 'auto-created', 'nested')
res = makeRes()
await routes['/qqbot-ext/config'](makeReq(JSON.stringify({ config: { libraryDir: freshDir } }), 'POST'), res)
const created = JSON.parse(res.out.body)
assert.equal(created.ok, true)
assert.equal(created.libraryDir, freshDir)
const stat = await import('node:fs/promises').then((m) => m.stat(freshDir)).catch(() => null)
assert.ok(stat?.isDirectory(), 'saving a new path creates the directory')
ok('saving a hand-typed path creates the library directory')

res = makeRes()
await routes['/qqbot-ext/config'](makeReq(undefined, 'DELETE'), res)
assert.equal(res.out.status, 405)
ok('rejects unsupported methods')

await rm(tempDir, { recursive: true, force: true })
ok('temporary library path cleaned up')

// ── 3. 宿主侧：收集器读配置 ────────────────────────────────────
const { writeConfig, readConfig, libraryDirOf } = await import(`file:///${ROOT}/lib/config.js`)
const collectDir = await mkdtemp(join(tmpdir(), 'qbe-collect-'))
// 显式钉住 auto 模式：不依赖上一次运行残留的配置。
await writeConfig({ libraryDir: collectDir, maxLibrary: 5, collectMode: 'auto', pendingLimit: 50 })
const { register: registerCollector } = await import(`file:///${ROOT}/features/host/01-sticker-auto-collect.js`)
const listeners = {}
let provided
registerCollector({ logger: { info() {}, warn() {} }, on: (n, f) => { listeners[n] = f }, provide: (_n, v) => { provided = v }, effect: () => {} })
const png = Buffer.alloc(1200)
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
png.write('IHDR', 12, 'ascii')
png.writeUInt32BE(120, 16)
png.writeUInt32BE(120, 20)
const { readdir, mkdir } = await import('node:fs/promises')
// 源文件放在图库之外，避免它自己也被当成图库内容。
const scratchDir = await mkdtemp(join(tmpdir(), 'qbe-scratch-'))
await mkdir(scratchDir, { recursive: true })
const srcPath = join(scratchDir, 'src.png')
await writeFile(srcPath, png)

listeners['qqbot/sticker-candidate']({ contentType: 'image/png', localPath: srcPath, stickerName: '普通图片' })
await new Promise((resolve) => setTimeout(resolve, 80))
assert.equal((await readdir(collectDir)).filter((n) => n.endsWith('.png')).length, 0)
ok('ordinary images (no sticker tag) are not collected')

listeners['qqbot/sticker-candidate']({ stickerTag: true, contentType: 'image/png', localPath: srcPath, stickerName: '未知表情' })
await new Promise((resolve) => setTimeout(resolve, 120))
const collected = (await readdir(collectDir)).filter((n) => n.length === 44 && n.endsWith('.png'))
assert.equal(collected.length, 1)
ok('tagged sticker lands in the configured directory')

listeners['qqbot/sticker-candidate']({ stickerTag: true, contentType: 'image/png', localPath: srcPath, stickerName: '未知表情' })
await new Promise((resolve) => setTimeout(resolve, 120))
assert.equal((await readdir(collectDir)).filter((n) => n.length === 44 && n.endsWith('.png')).length, 1)
ok('re-collecting the same bytes is deduplicated')

assert.equal(provided.status.library, collectDir)
assert.equal(provided.status.collected, 1)
assert.equal(provided.status.duplicates, 1)
ok('collector status exposes the configured location and counters')

// 新接缝不再给 localPath，而是给 CDN url：收集器必须自己抓字节
const realFetch = globalThis.fetch
const fetchedUrls = []
globalThis.fetch = async (url) => {
  fetchedUrls.push(String(url))
  return { ok: true, headers: new Map([['content-length', String(png.length)]]), arrayBuffer: async () => png }
}
listeners['qqbot/sticker-candidate']({ stickerTag: true, contentType: 'image/png', url: 'https://multimedia.nt.qq.com.cn/sticker.png', stickerName: '抓来的' })
await new Promise((resolve) => setTimeout(resolve, 150))
assert.equal(fetchedUrls.length, 1)
assert.equal((await readdir(collectDir)).filter((n) => n.length === 44 && n.endsWith('.png')).length, 1, 'same bytes stay deduplicated via url')
assert.equal(provided.status.duplicates, 2, 'url-sourced duplicate counted, not re-saved')
ok('sticker url is downloaded and deduplicated against existing bytes')

// 下载失败不能崩，只记 skipped
globalThis.fetch = async () => ({ ok: false, status: 404, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) })
const skippedBefore = provided.status.skipped
listeners['qqbot/sticker-candidate']({ stickerTag: true, contentType: 'image/png', url: 'https://multimedia.nt.qq.com.cn/missing.png', stickerName: '没了' })
await new Promise((resolve) => setTimeout(resolve, 150))
assert.equal(provided.status.skipped, skippedBefore + 1, 'failed download is recorded as skipped')
ok('failed download degrades to a skipped counter')

// 超大响应必须拒绝，不写盘
globalThis.fetch = async () => ({ ok: true, headers: new Map([['content-length', '99999999']]), arrayBuffer: async () => png })
const skippedBeforeBig = provided.status.skipped
listeners['qqbot/sticker-candidate']({ stickerTag: true, contentType: 'image/png', url: 'https://multimedia.nt.qq.com.cn/huge.png', stickerName: '太大' })
await new Promise((resolve) => setTimeout(resolve, 150))
assert.equal(provided.status.skipped, skippedBeforeBig + 1, 'oversized body rejected by content-length')
ok('oversized download is rejected before writing')

// ── curated 模式：先暂存，由模型判断后再决定收不收 ──
const { readConfig: readCfg } = await import(`file:///${ROOT}/lib/config.js`)
const { pendingDirOf } = await import(`file:///${ROOT}/lib/config.js`)
const curatedDir = await mkdtemp(join(tmpdir(), 'qbe-curated-'))
const curatedPending = pendingDirOf({ libraryDir: curatedDir })
await writeCfg({ libraryDir: curatedDir, collectMode: 'curated', pendingLimit: 3 })
provided.invalidate()

// 两张不同内容的图，另一张用 gif 头骗过格式嗅探但内容不同
const png2 = Buffer.alloc(1200)
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png2)
png2.write('IHDR', 12, 'ascii')
png2.writeUInt32BE(121, 16)
png2.writeUInt32BE(121, 20)
globalThis.fetch = async () => ({ ok: true, headers: new Map([['content-length', String(png2.length)]]), arrayBuffer: async () => png2 })

listeners['qqbot/sticker-candidate']({ stickerTag: true, contentType: 'image/png', url: 'https://multimedia.nt.qq.com.cn/c1.png', stickerName: '候选一' })
await new Promise((resolve) => setTimeout(resolve, 150))
const pendingRows = await provided.listPending()
assert.equal(pendingRows.length, 1, 'curated mode parks the sticker in the pending area')
assert.equal((await readdir(curatedDir)).filter((n) => n.length === 44).length, 0, 'nothing lands in the library yet')
assert.ok(pendingRows[0].path.startsWith(curatedPending), 'pending path points at the staging dir')
assert.equal(pendingRows[0].stickerName, '候选一', 'original sticker name is kept for the model')
assert.equal(provided.status.pending, 1)
ok('curated mode stages stickers instead of collecting them')

// 模型看过图后说"要" → 进图库
const keptName = pendingRows[0].filename
const keepResult = await provided.approve(keptName)
assert.equal(keepResult.duplicate, false)
assert.equal((await readdir(curatedDir)).filter((n) => n === keptName).length, 1, 'approved sticker is in the library')
assert.equal((await readdir(curatedPending)).filter((n) => n === keptName).length, 0, 'staged copy is gone after approval')
assert.equal((await provided.listPending()).length, 0)
assert.equal(provided.status.approved, 1)
ok('approving a staged sticker moves it into the library')

// 再来一张，这次模型说"不要" → 丢掉
globalThis.fetch = async () => ({ ok: true, headers: new Map([['content-length', String(png.length)]]), arrayBuffer: async () => png })
listeners['qqbot/sticker-candidate']({ stickerTag: true, contentType: 'image/png', url: 'https://multimedia.nt.qq.com.cn/c2.png', stickerName: '候选二' })
await new Promise((resolve) => setTimeout(resolve, 150))
const rows2 = await provided.listPending()
assert.equal(rows2.length, 1)
await provided.reject(rows2[0].filename)
assert.equal((await provided.listPending()).length, 0)
assert.equal((await readdir(curatedDir)).filter((n) => n.length === 44).length, 1, 'rejected sticker never reaches the library')
assert.equal(provided.status.rejected, 1)
ok('rejecting a staged sticker drops it without touching the library')

// 暂存上限：超过 pendingLimit 丢最旧的
const png3 = Buffer.alloc(1200)
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png3)
png3.write('IHDR', 12, 'ascii')
png3.writeUInt32BE(130, 16)
png3.writeUInt32BE(130, 20)
const png4 = Buffer.alloc(1200)
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png4)
png4.write('IHDR', 12, 'ascii')
png4.writeUInt32BE(131, 16)
png4.writeUInt32BE(131, 20)
const png5 = Buffer.alloc(1200)
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png5)
png5.write('IHDR', 12, 'ascii')
png5.writeUInt32BE(132, 16)
png5.writeUInt32BE(132, 20)
const png6 = Buffer.alloc(1200)
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png6)
png6.write('IHDR', 12, 'ascii')
png6.writeUInt32BE(133, 16)
png6.writeUInt32BE(133, 20)

// pendingLimit=3，故意放 4 张，才能验证"丢最旧的"
let body = png3
globalThis.fetch = async () => ({ ok: true, headers: new Map([['content-length', String(body.length)]]), arrayBuffer: async () => body })
for (const [value, name] of [[png3, '三'], [png4, '四'], [png5, '五'], [png6, '六']]) {
  body = value
  listeners['qqbot/sticker-candidate']({ stickerTag: true, contentType: 'image/png', url: `https://multimedia.nt.qq.com.cn/${name}.png`, stickerName: name })
  await new Promise((resolve) => setTimeout(resolve, 150))
}
const capped = await provided.listPending()
assert.equal(capped.length, 3, 'pending area never exceeds pendingLimit')
assert.deepEqual(capped.map((row) => row.stickerName), ['四', '五', '六'], 'oldest staged sticker was dropped first')
assert.equal(provided.status.dropped, 1)
ok('pending area applies pendingLimit by dropping the oldest')

// 切回 auto 模式：直接进图库，不再暂存
await writeCfg({ collectMode: 'auto' })
provided.invalidate()
const autoDir = await mkdtemp(join(tmpdir(), 'qbe-auto2-'))
await writeCfg({ libraryDir: autoDir })
provided.invalidate()
body = png
listeners['qqbot/sticker-candidate']({ stickerTag: true, contentType: 'image/png', url: 'https://multimedia.nt.qq.com.cn/auto.png', stickerName: '直接收' })
await new Promise((resolve) => setTimeout(resolve, 150))
assert.equal((await readdir(autoDir)).filter((n) => n.length === 44).length, 1, 'auto mode writes straight to the library')
assert.equal((await provided.listPending()).length, 0, 'auto mode leaves the pending area empty')
ok('switching back to auto collects immediately without staging')

globalThis.fetch = realFetch
await rm(curatedDir, { recursive: true, force: true })
await rm(curatedPending, { recursive: true, force: true })
await rm(autoDir, { recursive: true, force: true })

// ── 后台自动判断 ──────────────────────────────────────────────
const { parseVerdict, createJudge } = await import(`file:///${ROOT}/features/host/_sticker-judge.js`)
assert.equal(parseVerdict('KEEP\n这张很搞笑'), 'keep')
assert.equal(parseVerdict('DROP\n太糊了'), 'drop')
assert.equal(parseVerdict('   drop  因为重复  '), 'drop')
assert.equal(parseVerdict('KEEP'), 'keep')
assert.equal(parseVerdict('嗯……说不好'), undefined, 'unparseable stays undecided')
assert.equal(parseVerdict(''), undefined)
ok('verdict parsing accepts KEEP/DROP and refuses to guess')

const { judgeReady, assertWritable, normalizeConfig, CONFIG_DEFAULTS } = await import(`file:///${ROOT}/lib/config.js`)
assert.equal(judgeReady({ ...CONFIG_DEFAULTS }), false, 'off by default')
assert.equal(judgeReady({ ...CONFIG_DEFAULTS, judgeEnabled: true, judgeProvider: 'p', judgeModel: 'm' }), false, 'mode must be curated')
assert.equal(judgeReady({ ...CONFIG_DEFAULTS, collectMode: 'curated', judgeEnabled: true }), false, 'needs provider+model')
assert.equal(
  judgeReady({ ...CONFIG_DEFAULTS, collectMode: 'curated', judgeEnabled: true, judgeProvider: 'p', judgeModel: 'm' }),
  true,
)
ok('judgeReady requires curated mode plus provider and model')

// 开自动判断却不填模型：写入必须报错，而不是静默跑一堆失败调用
assert.throws(
  () => assertWritable(normalizeConfig({ collectMode: 'curated', judgeEnabled: true }, CONFIG_DEFAULTS)),
  /provider 和 model/,
)
// 读取侧不能因为这条校验而整份配置退回默认
const stored = normalizeConfig({ collectMode: 'curated', judgeEnabled: true }, CONFIG_DEFAULTS)
assert.equal(stored.collectMode, 'curated', 'reading such a config still keeps user fields')
ok('enabling the judge without a model is rejected on write, not on read')

// 判断器：没配模型时一次模型调用都不该发生
let llmCalls = 0
const judgeCtx = {
  get: (name) => (name === 'llm'
    ? { stream() { llmCalls += 1; return (async function* () { yield { type: 'text', text: 'KEEP' } })() } }
    : name === 'attachments'
      ? { async saveImage() { return { id: 'fake' } } }
      : undefined),
}
const judge = createJudge({
  ctx: judgeCtx,
  collector: {
    listPending: async () => [{ filename: 'a.png', path: srcPath, bytes: 1, ext: 'png', stickerName: 'x' }],
    approve: async () => ({}),
    reject: async () => ({}),
  },
  getConfig: async () => ({ ...CONFIG_DEFAULTS }),
  logger: { warn() {} },
})
const idle = await judge.runOnce()
assert.equal(idle.skipped, true)
assert.equal(llmCalls, 0, 'no model call when the judge is off')
ok('judge makes zero model calls when disabled')

// 配好模型后：KEEP 走 approve，DROP 走 reject
const decisions = []
let llmReply = 'KEEP\n想要'
const judge2 = createJudge({
  ctx: judgeCtx,
  collector: {
    listPending: async () => [{ filename: 'a.png', path: srcPath, bytes: 1, ext: 'png', stickerName: 'x' }],
    approve: async (name) => { decisions.push(['keep', name]); return {} },
    reject: async (name) => { decisions.push(['drop', name]); return {} },
  },
  getConfig: async () => ({
    ...CONFIG_DEFAULTS, collectMode: 'curated', judgeEnabled: true,
    judgeProvider: 'p', judgeModel: 'm', judgePrompt: '按人设判断',
  }),
  logger: { warn() {} },
})
judgeCtx.get = (name) => (name === 'llm'
  ? { stream() { llmCalls += 1; return (async function* () { yield { type: 'text', text: llmReply } })() } }
  : name === 'attachments'
    ? { async saveImage() { return { id: 'fake' } } }
    : undefined)
const kept = await judge2.runOnce()
assert.equal(kept.judged, 1)
assert.deepEqual(decisions, [['keep', 'a.png']])
llmReply = 'DROP\n没意思'
await judge2.runOnce()
assert.deepEqual(decisions, [['keep', 'a.png'], ['drop', 'a.png']])
assert.ok(llmCalls >= 2)
ok('judge applies KEEP to the library and DROP to the bin')

// 模型调用失败：留在暂存区，不误删
const judge3 = createJudge({
  ctx: { get: (name) => (name === 'llm'
    ? { stream() { throw new Error('boom') } }
    : name === 'attachments' ? { async saveImage() { return { id: 'f' } } } : undefined) },
  collector: {
    listPending: async () => [{ filename: 'b.png', path: srcPath, bytes: 1, ext: 'png', stickerName: 'y' }],
    approve: async () => { throw new Error('should not approve') },
    reject: async () => { throw new Error('should not reject') },
  },
  getConfig: async () => ({
    ...CONFIG_DEFAULTS, collectMode: 'curated', judgeEnabled: true, judgeProvider: 'p', judgeModel: 'm',
  }),
  logger: { warn() {} },
})
const failed = await judge3.runOnce()
assert.equal(failed.judged, 0, 'nothing applied when the model errors')
assert.equal(judge3.status.judgeFailed, 1)
ok('judge leaves the sticker staged when the model call fails')


await rm(collectDir, { recursive: true, force: true })
await rm(scratchDir, { recursive: true, force: true })

// 用户原配置原样还原（不写默认值，之前就是这里把用户图库路径覆盖掉的）
await restoreConfig()
if (hadConfig) {
  assert.equal(await readFile(CONFIG_PATH, 'utf8'), originalConfig, 'user config restored byte-for-byte')
  ok('user config.json restored byte-for-byte')
} else {
  assert.ok(!existsSync(CONFIG_PATH), 'config removed again because it did not exist before')
  ok('config removed again (it did not exist before the run)')
}

console.log(`\n${passed} checks passed.`)
