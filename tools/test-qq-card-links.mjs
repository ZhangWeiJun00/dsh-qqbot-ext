import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { extractBilibiliCardLinks, preserveBilibiliCardLinks } from '../dsh-qqbot-ext/lib/qq-card-links.js'
const url = 'https://www.bilibili.com/video/BV1xx411c7mD?p=2'
let count = 0
function test(name, fn) { fn(); console.log(`PASS ${++count} ${name}`) }
const miniapp = { meta: { detail_1: { title: '标题', preview: 'https://qq.ugcimg.cn/cover', qqdocurl: url } } }
test('original structured miniapp target', () => assert.deepEqual(extractBilibiliCardLinks({ app: miniapp }), [url]))
test('JSON encoded card and escaped slashes', () => assert.deepEqual(extractBilibiliCardLinks({ content: JSON.stringify(miniapp).replaceAll('/', '\\/') }), [url]))
test('encoded miniapp page path', () => assert.deepEqual(extractBilibiliCardLinks({ card: { pagepath: 'pages/video?url=' + encodeURIComponent(url) } }), [url]))
test('short link in message_scene extension', () => assert.deepEqual(extractBilibiliCardLinks({ message_scene: { ext: ['url=https://b23.tv/AbC'] } }), ['https://b23.tv/AbC']))
test('miniapp BV path', () => assert.deepEqual(extractBilibiliCardLinks({ path: 'pages/video/video?bvid=BV1xx411c7mD' }), [url.split('?')[0]]))
test('covers and source logo never targets', () => assert.deepEqual(extractBilibiliCardLinks({ preview: url, source_logo: 'https://b23.tv/icon', attachments: [{ url }] }), []))
test('quote element is not the current card', () => assert.deepEqual(extractBilibiliCardLinks({ message_type: 103, msg_elements: [{ content: url }] }), []))
test('host spoof and credentials ignored', () => assert.deepEqual(extractBilibiliCardLinks({ url: 'https://bilibili.com.evil.test/video/BV1xx411c7mD', path: 'https://user@b23.tv/private' }), []))
test('preserve before history, no raw mutation, idempotent', () => {
  const raw = structuredClone(miniapp), original = JSON.stringify(raw), msg = { content: '[卡片消息]小程序', raw }
  preserveBilibiliCardLinks(msg); const once = msg.content
  preserveBilibiliCardLinks(msg)
  assert.equal(msg.content, once); assert.ok(msg.content.includes(url)); assert.equal(JSON.stringify(raw), original)
})
test('missing link stays missing, does not invent a target', () => {
  const msg = { content: 'title: 只有标题', raw: { title: '只有标题', preview: 'https://qq.ugcimg.cn/cover' } }
  assert.deepEqual(preserveBilibiliCardLinks(msg), []); assert.equal(msg.content, 'title: 只有标题')
})
test('cycles and oversized data are bounded', () => {
  const raw = { content: 'x'.repeat(100001) }; raw.self = raw
  assert.deepEqual(extractBilibiliCardLinks(raw), [])
})
// Replay actual patch script against a temporary fake profile, never live config.
const temp = await mkdtemp(join(tmpdir(), 'qbe-card-'))
const gateway = join(temp, 'node_modules/@tencent-connect/dsh-qqbot/lib/gateway')
const ext = join(temp, 'node_modules/dsh-qqbot-ext/lib')
await mkdir(gateway, { recursive: true }); await mkdir(ext, { recursive: true })
const setup = join(gateway, 'middleware-setup.js')
await writeFile(setup, 'export function setupMiddlewares(bot, config, manager, logger) {\n    // 4. 群历史缓冲\n    bot.use(async (ctx, next) => next());\n}\n')
const script = resolve('tools/apply-qqbot-card-links-patch.mjs')
for (let i = 0; i < 2; i++) {
  const result = spawnSync(process.execPath, [script, '--profile', temp], { stdio: 'inherit' })
  assert.equal(result.status, 0)
}
const patched = await readFile(setup, 'utf8')
test('patch is idempotent and before history', () => {
  assert.equal(patched.split('// qqbot-ext: on-demand card raw access').length, 2)
  assert.ok(patched.indexOf('cardInbox.capture(') < patched.indexOf('// 4. 群历史缓冲'))
  assert.ok(!patched.includes('preserveBilibiliCardLinks(mCtx.message)'))
})
test('relative helper import resolves to extension installation', () => assert.equal(resolve(gateway, '../../../../dsh-qqbot-ext/lib/qq-card-links.js'), resolve(ext, 'qq-card-links.js')))
console.log(`${count} checks passed`)
