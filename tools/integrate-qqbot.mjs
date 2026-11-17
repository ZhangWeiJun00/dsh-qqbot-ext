// Build our local official QQ distribution. Run only on a clean upstream copy.
import { readFile, writeFile, cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mergeClient } from './merge-qqbot-client.mjs'
import { applyArchivedRotation } from './patch-archived-rotation.mjs'
import { applyErrorGuard } from './patch-error-guard.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const target = join(root, 'vendor/dsh-qqbot')
const read = p => readFile(join(target, p), 'utf8')
const write = (p, body) => writeFile(join(target, p), body)
const pkg = JSON.parse(await read('package.json'))
if (pkg.version.includes('local')) throw new Error('Use a fresh upstream package, not an already integrated copy')
const setup = await read('lib/gateway/middleware-setup.js')
const bootstrap = await read('lib/gateway/bootstrap.js')
const client = await read('lib/client.js')
const patch = await read('cordis.patch.yml')
if (!setup.includes('    // 4. 群历史缓冲') || !bootstrap.includes('    // 交付物投递：')) throw new Error('Upstream integration anchors changed')
await cp(join(root, 'dsh-qqbot-ext'), join(target, 'ext'), { recursive: true })
const presetFile = 'ext/lib/preset-plugins.js'
await write(presetFile, (await read(presetFile)).replace("name: 'dsh-qqbot-ext/agent'", "name: '@tencent-connect/dsh-qqbot/ext-agent'"))
pkg.version = `${pkg.version}-local.1`
pkg.description = 'QQ机器人本地维护版：官方收发、人设卡、表情图库与图片理解、B站按需卡片读取，一包装载。'
pkg.private = true
pkg.exports['./ext-agent'] = './ext/lib/agent.js'
pkg.exports['./ext-routes'] = './ext/lib/routes.js'
pkg.exports['./ext-preset'] = './ext/lib/preset.js'
// 独立功能组件（GUI 逐组件显示与开关，mnemon 同构）；子路径插件的 locale 走各自导出。
for (const comp of ['sticker', 'roleplay', 'bilibili', 'tools']) {
  pkg.exports[`./ext-${comp}`] = `./ext/lib/plugin-${comp}.js`
  pkg.exports[`./ext-${comp}/locale/*.json`] = `./ext/locale/${comp}/*.json`
}
pkg.exports['./ext-routes/locale/*.json'] = './ext/locale/routes/*.json'
pkg.exports['./ext-preset/locale/*.json'] = './ext/locale/preset/*.json'
pkg.files = ['lib', 'ext', 'assets', 'locale', 'cordis.patch.yml', 'LICENSE', 'README.md', 'LOCAL-MAINTENANCE.md']
await write('package.json', JSON.stringify(pkg, null, 2) + '\n')
// Local dependency layout: hoisted (isolated breaks ESM sibling resolution through
// Windows junctions, e.g. ws inside qqbot-nodejs); host peers resolve via DSH.
const wsYaml = await read('pnpm-workspace.yaml')
if (!wsYaml.includes('nodeLinker:')) {
  await write('pnpm-workspace.yaml', '# 本地维护（非上游）：依赖摊平到 node_modules 根，与 DSH profile 布局一致。\nnodeLinker: hoisted\n# 宿主包（@deepseek-ai/*）由 DSH 安装层拦截解析，不在本地重复安装。\nautoInstallPeers: false\n' + wsYaml)
}
// lib/index.js 保持上游原样：功能组件各自独立插件行加载，不再塞进 im-qqbot 的 apply。
// Same owning context as global tools: no cross-plugin service resolution needed.
const cardBlock = `    // Local QQ: bounded references; raw is accessed by explicit tool calls only.
    const cardInbox = createCardInbox();
    manager.ctx.provide('qqbotExtCardReader', {
        read(agent, messageId) {
            const record = manager.findByAgent(agent);
            if (!record?.sessionKey) throw new Error('无法确定当前QQ会话');
            return cardInbox.read(record.sessionKey, messageId);
        },
    });
    bot.use(async (mCtx, next) => {
        const msg = mCtx.message;
        const scope = msg.kind === 'group' ? 'group' : 'c2c';
        const peer = scope === 'group' ? msg.groupOpenid : msg.senderId;
        if (peer) cardInbox.capture('qqbot:' + config.appId + ':' + scope + ':' + peer, msg);
        await next();
    });
`
const sticker = await readFile(join(root, 'tools/patched-files/qqbot-sticker-hook-middleware-setup.js'), 'utf8')
// Original sticker snippet refers to an unavailable ctx variable in setupMiddlewares.
const stickerFixed = sticker.replace("void ctx.emit('qqbot/sticker-candidate'", "void manager.ctx.emit('qqbot/sticker-candidate'")
let setupNew = "import { createCardInbox } from '../../ext/lib/qq-card-inbox.js';\n" + setup.replace('    // 4. 群历史缓冲', cardBlock + '    // 4. 群历史缓冲')
setupNew = setupNew.replace('    // 9. 并发串行', stickerFixed + '\n    // 9. 并发串行')
await write('lib/gateway/middleware-setup.js', setupNew)
const sender = await readFile(join(root, 'tools/patched-files/qqbot-sticker-collector-hook.js'), 'utf8')
await write('lib/gateway/bootstrap.js', bootstrap.replace('    // 交付物投递：', sender + '\n    // 交付物投递：'))
// Local fix: archived sessions rotate to a fresh session (host archived-session-gate).
await write('lib/session/session-manager.js', applyArchivedRotation(await read('lib/session/session-manager.js')))
// Local fix: model-error interception + global breaker (outbound + middleware gate).
const guarded = applyErrorGuard({ outbound: await read('lib/transport/outbound.js'), middleware: await read('lib/gateway/middleware-setup.js') })
await write('lib/transport/outbound.js', guarded.outbound)
await write('lib/gateway/middleware-setup.js', guarded.middleware)
await write('lib/client.js', mergeClient(client, await read('ext/client.js')))
await write('cordis.patch.yml', patch + `\n# Local QQ integrated modules: independent feature components (GUI per-component toggles).\n- insert:\n    - id: dsh-qqbot-ext-sticker\n      name: '@tencent-connect/dsh-qqbot/ext-sticker'\n    - id: dsh-qqbot-ext-roleplay\n      name: '@tencent-connect/dsh-qqbot/ext-roleplay'\n    - id: dsh-qqbot-ext-bilibili\n      name: '@tencent-connect/dsh-qqbot/ext-bilibili'\n    - id: dsh-qqbot-ext-tools\n      name: '@tencent-connect/dsh-qqbot/ext-tools'\n    - id: dsh-qqbot-ext-routes\n      name: '@tencent-connect/dsh-qqbot/ext-routes'\n    - id: dsh-qqbot-ext-preset\n      name: '@tencent-connect/dsh-qqbot/ext-preset'\n`)
for (const lang of ['zh', 'en']) {
  const path = 'locale/' + lang + '.json'
  const locale = JSON.parse(await read(path))
  locale.meta.title = lang === 'zh' ? 'QQ 机器人 · 本地维护版' : 'QQ bot · locally maintained'
  locale.meta.description = lang === 'zh' ? pkg.description : 'Official QQ transport with integrated character cards, sticker library, image indexing and on-demand Bilibili card links.'
  await write(path, JSON.stringify(locale, null, 2) + '\n')
}
await write('LOCAL-MAINTENANCE.md', `# Local QQ distribution

Upstream: @tencent-connect/dsh-qqbot ${pkg.version.replace(/-local\.\d+$/, '')}, https://github.com/tencent-connect/dsh-qqbot (MIT).
Local build: ${pkg.version}. Original LICENSE retained. Integration generated by tools/integrate-qqbot.mjs in the maintenance workspace.

Integrated extension modules live in ext/ (generated from the repo's dsh-qqbot-ext/ feature source). Features are independent plugin components (ext-sticker / ext-roleplay / ext-bilibili / ext-tools, plus ext-routes / ext-preset), each with its own GUI row, toggle and locale — mnemon-style composition. lib/index.js stays pristine; components resolve gateway services lazily via ctx.get. Configuration remains in ~/.dsh-qqbot-ext; routes and qqbot-ext preset id are retained. The standalone dsh-qqbot-ext bundle must stay out of the profile to avoid duplicate tools/routes.

Raw card events are never expanded into message content; explicit qq_card_video_links calls read the selected card. Memory-only references expire in ten minutes.

## Local fixes

- Archived-session rotation (session/session-manager.js, replayed by tools/patch-archived-rotation.mjs): the host archived-session-gate rejects every model step of an archived session, so a QQ chat whose session was archived in the GUI went permanently silent. getOrCreate now silently retires an archived mapped session and rotates to a fresh one; openSession mints a fresh id instead of resuming an archived candidate. No QQ-side notification is sent. Isolation test: tools/test-archived-session-rotation.mjs (needs --experimental-vm-modules).
- Roleplay-change session rotation: toggling the roleplay master switch or switching the resolved character card (default/binding) auto-rotates the affected QQ sessions so old persona history cannot carry over. The roleplay save route consumes the qqbotExtSessionRotator service (bootstrap.js) and calls SessionManager.removeByKey per affected key (knownSessionKeys covers active + stored prefs mappings). Same-card content edits do not rotate. Isolation tests: tools/test-roleplay-rotation.mjs, tools/test-roleplay-ui.mjs.
- Model-error interception + breaker (transport/outbound.js + gateway/middleware-setup.js, replayed by tools/patch-error-guard.mjs; state machine in ext/lib/error-guard.js): turn errors send a configurable friendly notice to the original chat (empty text = silent) and forward full technical detail to the admin c2c (errorForwardOpenid, default first c2cAllow entry); consecutive error turns trip a global breaker (breakerThreshold, default 3) that stops dispatch indefinitely — no cooldown, no automatic recovery; only an admin /resume closes it. Per-chat throttled notices; trip events notify the admin. Slash commands and pending answers bypass the gate. Manual recovery: /resume closes the breaker immediately, /resume status shows status (admin-only via adminOnlyAuth — errorForwardOpenid or the first c2cAllow entry, synchronous check, fail-closed; registered into the same command array so /bot-help lists it; /breaker kept as an alias). Isolation test: tools/test-error-guard.mjs.

## Dependencies (local maintenance)

The profile installs this directory with the link: protocol (plugin_manager install_bundle <dir>). link: does not install the package's dependencies, so this directory carries its own node_modules, provisioned with the DSH-bundled pnpm 11 and a workspace-local store:

    node <dsh-runtimes>/dependencies/pnpm/bin/pnpm.cjs install --prod --ignore-scripts --store-dir <repo>/.pnpm-store

pnpm-workspace.yaml sets nodeLinker: hoisted (isolated layout breaks ESM sibling resolution through Windows junctions, e.g. ws inside qqbot-nodejs) and autoInstallPeers: false (@deepseek-ai/* host packages resolve through the DSH installation layer). silk-wasm / mpg123-decoder are optional voice-codec peers, lazy-loaded by the SDK; install them only if voice encoding is needed.

## Upstream merge

1. Fetch the new upstream release into a fresh directory (npm pack @tencent-connect/dsh-qqbot@<version>); keep the current vendor copy until the new one passes. Pristine 0.5.5 reference: vendor/upstream/.
2. Run tools/integrate-qqbot.mjs against the fresh copy (it refuses already-integrated copies and checks upstream anchors; resolve anchor diffs in the script first). It copies ext/, adds the independent feature-component plugin rows and exports (lib/index.js stays pristine), rewires the gateway seams, the client bundle (single package-id .load merging both factories via tools/merge-qqbot-client.mjs — a second .load id has no boot-graph entry and never activates), the archived-session rotation fix (tools/patch-archived-rotation.mjs), the error-interception/breaker fix (tools/patch-error-guard.mjs), cordis.patch.yml, locale meta, the local pnpm-workspace.yaml settings, and version <upstream>-local.N.
3. Provision dependencies as above; run the isolated tests: tools/test-integrated-qqbot.mjs (needs --experimental-vm-modules), tools/verify-qqbot-ext-panel.mjs, and the sticker/card/roleplay/error-guard/rotation suites.
4. Diff lib/ against pristine upstream: only client.js, gateway/bootstrap.js, gateway/middleware-setup.js, session/session-manager.js, transport/outbound.js may differ.
5. Install with plugin_manager install_bundle <vendor dir> (link:). To replace an existing installation, remove_bundle first (HMR refuses already-installed). Do NOT use the file: protocol: pnpm 11 hoisted moves the source directory into node_modules and empties vendor.
6. Verify: im-qqbot fiber active, /qqbot/im-qqbot/bind bound, /qqbot-ext/config returns the existing ~/.dsh-qqbot-ext config; follow the install receipt for restart or other next steps.
`)
console.log('Integrated local QQ distribution:', target)
